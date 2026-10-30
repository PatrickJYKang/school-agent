import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { readFile, readdir } from 'node:fs/promises';
import { resolveSchoolConfig } from 'librechat-data-provider';
import { readSchoolDocument, readSchoolDocumentStream } from './read';
import { makePdf } from './__fixtures__/pdf';

const settings = resolveSchoolConfig({ documents: { enabled: true } })!.documents;
const input = { filename: 'worksheet.pdf', mimeType: 'application/pdf', settings };

it('reads real PDF pages with page labels and a continuation page', async () => {
  const buffer = makePdf(['First page algebra.', 'Second page: explain your reasoning.']);
  const result = await readSchoolDocument({
    ...input,
    buffer,
    settings: { ...settings, pagesPerRead: 1 },
  });
  expect(result).toMatchObject({
    format: 'pdf',
    pageCount: 2,
    startPage: 1,
    endPage: 1,
    nextPage: 2,
    truncated: true,
  });
  expect(result.text).toContain('[Page 1]\nFirst page algebra.');
  expect(result.text).not.toContain('Second page');
  const second = await readSchoolDocument({
    ...input,
    buffer,
    options: { start_page: 2, end_page: 2 },
  });
  expect(second.text).toContain('[Page 2]\nSecond page: explain your reasoning.');
  expect(second.nextPage).toBeUndefined();
});
it('reuses the real Word parser without pretending DOCX paragraphs have fixed page numbers', async () => {
  const buffer = await readFile(path.join(__dirname, '../../files/documents/sample.docx'));
  const result = await readSchoolDocument({
    ...input,
    buffer,
    filename: 'sample.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  expect(result.format).toBe('docx');
  expect(result.text).toContain('This is a sample DOCX file.');
  expect(result.pageCount).toBeUndefined();
});
it('returns explicit character continuation for longer text', async () => {
  const buffer = Buffer.from('A'.repeat(1200) + 'END');
  const args = {
    ...input,
    buffer,
    filename: 'notes.md',
    mimeType: 'text/markdown',
    settings: { ...settings, maxChars: 1000 },
  };
  const first = await readSchoolDocument(args);
  expect(first.nextOffset).toBe(1000);
  expect(first.truncated).toBe(true);
  const second = await readSchoolDocument({ ...args, options: { offset: first.nextOffset } });
  expect(first.text + second.text).toBe(buffer.toString());
  expect(second.truncated).toBe(false);
});
it('identifies scanned/empty pages, corrupt PDFs, unsupported files, and invalid ranges safely', async () => {
  await expect(readSchoolDocument({ ...input, buffer: makePdf(['']) })).rejects.toMatchObject({
    code: 'document_no_text',
  });
  await expect(
    readSchoolDocument({ ...input, buffer: Buffer.from('private broken content') }),
  ).rejects.toMatchObject({ code: 'document_unreadable' });
  await expect(
    readSchoolDocument({
      ...input,
      buffer: Buffer.from('binary'),
      filename: 'program.exe',
      mimeType: 'application/octet-stream',
    }),
  ).rejects.toMatchObject({ code: 'document_unsupported' });
  await expect(
    readSchoolDocument({ ...input, buffer: makePdf(['Only page']), options: { start_page: 3 } }),
  ).rejects.toMatchObject({ code: 'canvas_invalid_request' });
});
it('bounds input, worker admission, cancellation, timeout, and temporary-file cleanup', async () => {
  const before = new Set(
    (await readdir(os.tmpdir())).filter((name) => name.startsWith('school-document-')),
  );
  await expect(
    readSchoolDocument({
      ...input,
      buffer: Buffer.alloc(1001),
      settings: { ...settings, maxBytes: 1000 },
    }),
  ).rejects.toMatchObject({ code: 'document_too_large' });
  const pending = readSchoolDocument({
    ...input,
    buffer: makePdf(['A page']),
    settings: { ...settings, maxConcurrent: 1 },
  });
  await expect(
    readSchoolDocument({
      ...input,
      buffer: makePdf(['Another page']),
      settings: { ...settings, maxConcurrent: 1 },
    }),
  ).rejects.toMatchObject({ code: 'document_busy' });
  await pending;
  const controller = new AbortController();
  const cancelled = readSchoolDocument({
    ...input,
    buffer: makePdf(['A page']),
    signal: controller.signal,
  });
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  await expect(
    readSchoolDocument({
      ...input,
      buffer: makePdf(['A page']),
      settings: { ...settings, timeoutMs: 1 },
    }),
  ).rejects.toMatchObject({ code: 'document_timeout' });
  const after = (await readdir(os.tmpdir())).filter(
    (name) => name.startsWith('school-document-') && !before.has(name),
  );
  expect(after).toEqual([]);
});
it('bounds storage streams and cleans up a stream that arrives after its deadline', async () => {
  await expect(
    readSchoolDocumentStream(async () => Readable.from([Buffer.alloc(1001)]), {
      ...settings,
      maxBytes: 1000,
    }),
  ).rejects.toMatchObject({ code: 'document_too_large' });
  let release: (stream: Readable) => void = () => undefined;
  const pending = new Promise<Readable>((resolve) => {
    release = resolve;
  });
  await expect(
    readSchoolDocumentStream(() => pending, { ...settings, timeoutMs: 1 }),
  ).rejects.toMatchObject({ code: 'document_timeout' });
  const late = Readable.from(['late']);
  release(late);
  await new Promise((resolve) => setImmediate(resolve));
  expect(late.destroyed).toBe(true);
});
