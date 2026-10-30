import path from 'node:path';
import { JSDOM } from 'jsdom';
import { parentPort } from 'node:worker_threads';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { DocumentJob, DocumentReply, DocumentReadResult } from './types';
import { DocumentReadError, sliceDocumentText } from './types';
import { parseDocument } from '~/files/documents/crud';
import { isBinaryBuffer } from '~/skills/binary';

async function extract(job: DocumentJob): Promise<DocumentReadResult> {
  const { filename, mimeType, settings, options } = job;
  const buffer = Buffer.from(job.buffer);
  if (buffer.length > settings.maxBytes) throw new DocumentReadError('document_too_large');
  const extension = path.extname(filename).toLowerCase();
  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
    if (options.start_page != null || options.end_page != null)
      throw new DocumentReadError('canvas_invalid_request');
    // No script execution or resource loading. Run in the same bounded worker as document parsing.
    const dom = new JSDOM(buffer.toString('utf8'), { url: job.sourceUrl });
    try {
      const document = dom.window.document;
      const root =
        document.querySelector('article') ?? document.querySelector('main') ?? document.body;
      root
        .querySelectorAll('script,style,noscript,iframe,form,nav,header,footer,svg')
        .forEach((node) => node.remove());
      root.querySelectorAll('a[href]').forEach((anchor) => {
        try {
          const href = new URL(anchor.getAttribute('href')!, job.sourceUrl);
          if (['http:', 'https:'].includes(href.protocol) && !href.username && !href.password)
            anchor.append(` (${href.href})`);
        } catch {
          /* Ignore invalid anchor destinations. */
        }
      });
      root
        .querySelectorAll('br,p,div,li,h1,h2,h3,h4,h5,h6,tr,section')
        .forEach((node) => node.append('\n'));
      const text = `${document.title}\n\n${root.textContent ?? ''}`
        .replace(/[\t ]+\n/g, '\n')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
      if (!text) throw new DocumentReadError('document_no_text');
      if (text.length > settings.maxExtractedChars)
        throw new DocumentReadError('document_too_large');
      return { format: 'html', ...sliceDocumentText(text, options, settings.maxChars) };
    } finally {
      dom.window.close();
    }
  }
  if (extension === '.pdf' || mimeType === 'application/pdf') {
    if (buffer.subarray(0, 5).toString() !== '%PDF-')
      throw new DocumentReadError('document_unreadable');
    // PDF.js is ESM-only; the parser stays inside this terminable worker.
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const assets = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const task = getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      standardFontDataUrl: path.join(assets, 'standard_fonts/'),
      cMapUrl: path.join(assets, 'cmaps/'),
      cMapPacked: true,
    });
    try {
      const pdf = await task.promise;
      const start = options.start_page ?? 1;
      const end = options.end_page ?? Math.min(pdf.numPages, start + settings.pagesPerRead - 1);
      if (
        start > pdf.numPages ||
        end < start ||
        end > pdf.numPages ||
        end - start + 1 > settings.pagesPerRead
      )
        throw new DocumentReadError('canvas_invalid_request');
      let text = '';
      let hasText = false;
      for (let pageNumber = start; pageNumber <= end; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const words: string[] = [];
        for (const item of content.items) {
          if ('str' in item) {
            const word = item as TextItem;
            words.push(word.str, word.hasEOL ? '\n' : ' ');
          }
        }
        const pageText = words.join('').trim();
        hasText ||= pageText.length > 0;
        text += `[Page ${pageNumber}]\n${pageText || '[No extractable text on this page; visual/OCR reading is needed.]'}\n\n`;
        page.cleanup();
        if (text.length > settings.maxExtractedChars)
          throw new DocumentReadError('document_too_large');
      }
      if (!hasText) throw new DocumentReadError('document_no_text');
      const slice = sliceDocumentText(text, options, settings.maxChars);
      return {
        format: 'pdf',
        pageCount: pdf.numPages,
        startPage: start,
        endPage: end,
        nextPage: end < pdf.numPages ? end + 1 : undefined,
        ...slice,
        truncated: slice.truncated || end < pdf.numPages,
      };
    } finally {
      await task.destroy();
    }
  }
  const office =
    extension === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const odt = extension === '.odt' || mimeType === 'application/vnd.oasis.opendocument.text';
  if (
    !office &&
    !odt &&
    !['.txt', '.md', '.markdown', '.csv'].includes(extension) &&
    !['text/plain', 'text/markdown', 'text/csv'].includes(mimeType)
  )
    throw new DocumentReadError('document_unsupported');
  if (options.start_page != null || options.end_page != null)
    throw new DocumentReadError('canvas_invalid_request');
  let text: string;
  if (office || odt) {
    if (buffer.subarray(0, 2).toString() !== 'PK')
      throw new DocumentReadError('document_unreadable');
    const result = await parseDocument({
      file: {
        path: job.tempPath,
        originalname: path.basename(filename),
        size: buffer.length,
        mimetype: office
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/vnd.oasis.opendocument.text',
      } as Express.Multer.File,
    });
    text = result.text;
  } else {
    if (isBinaryBuffer(buffer)) throw new DocumentReadError('document_unreadable');
    text = buffer.toString('utf8');
  }
  if (!text.trim()) throw new DocumentReadError('document_no_text');
  if (text.length > settings.maxExtractedChars) throw new DocumentReadError('document_too_large');
  let format: DocumentReadResult['format'] = 'text';
  if (office) format = 'docx';
  else if (odt) format = 'odt';
  return {
    format,
    ...sliceDocumentText(text, options, settings.maxChars),
  };
}

parentPort?.once('message', (job: DocumentJob) => {
  void extract(job)
    .then((value) => parentPort?.postMessage({ ok: true, value } satisfies DocumentReply))
    .catch((error) => {
      let code: DocumentReply & { ok: false } = { ok: false, code: 'document_unreadable' };
      if (error instanceof DocumentReadError) code = { ok: false, code: error.code };
      else if (error instanceof Error && error.message === 'No text found in document')
        code = { ok: false, code: 'document_no_text' };
      parentPort?.postMessage(code);
    });
});
