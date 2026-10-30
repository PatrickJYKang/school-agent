import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import type { SchoolDocumentSettings } from 'librechat-data-provider';
import type { Readable } from 'node:stream';
import type { DocumentJob, DocumentReply, DocumentReadOptions, DocumentReadResult } from './types';
import { DocumentReadError } from './types';

let active = 0;

export async function readSchoolDocumentStream(
  load: () => Promise<Readable>,
  settings: SchoolDocumentSettings,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted();
  let stream: Readable | undefined;
  let stopped = false;
  let rejectAbort: (error: Error) => void = () => undefined;
  const abort = (): void => {
    stopped = true;
    stream?.destroy();
    rejectAbort(
      signal?.aborted
        ? new DOMException('Document reading cancelled', 'AbortError')
        : new DocumentReadError('document_timeout'),
    );
  };
  const pendingAbort = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const timer = setTimeout(abort, settings.timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    stream = await Promise.race([
      load().then((value) => {
        if (stopped) value.destroy();
        return value;
      }),
      pendingAbort,
    ]);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const value of stream) {
      signal?.throwIfAborted();
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > settings.maxBytes) throw new DocumentReadError('document_too_large');
      chunks.push(chunk);
    }
    if (stopped) throw new DocumentReadError('document_timeout');
    return Buffer.concat(chunks);
  } catch (error) {
    signal?.throwIfAborted();
    if (stopped) throw new DocumentReadError('document_timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    stream?.destroy();
  }
}

/** Isolated parsing keeps malformed or slow files out of the chat server's event loop. */
export async function readSchoolDocument(input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  settings: SchoolDocumentSettings;
  options?: DocumentReadOptions;
  sourceUrl?: string;
  signal?: AbortSignal;
}): Promise<DocumentReadResult> {
  const { settings, signal } = input;
  signal?.throwIfAborted();
  if ((input.options?.offset ?? 0) > settings.maxExtractedChars)
    throw new DocumentReadError('canvas_invalid_request');
  if (input.buffer.length > settings.maxBytes) throw new DocumentReadError('document_too_large');
  if (active >= settings.maxConcurrent) throw new DocumentReadError('document_busy');
  active++;
  let folder: string | undefined;
  try {
    folder = await mkdtemp(path.join(os.tmpdir(), 'school-document-'));
    const tempPath = path.join(folder, 'source');
    await writeFile(tempPath, input.buffer, { mode: 0o600 });
    return await new Promise<DocumentReadResult>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(
          path.join(path.dirname(require.resolve('@librechat/api')), 'school/documents/worker.cjs'),
          {
            execArgv: [],
            stdout: true,
            stderr: true,
            resourceLimits: { maxOldGenerationSizeMb: settings.workerMemoryMb },
          },
        );
      } catch {
        reject(new DocumentReadError('document_unreadable'));
        return;
      }
      worker.stdout?.resume();
      worker.stderr?.resume();
      let settled = false;
      const finish = (reply?: DocumentReply, error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        void worker.terminate().then(
          () => {
            if (error) reject(error);
            else if (reply?.ok) resolve(reply.value);
            else reject(new DocumentReadError(reply?.code ?? 'document_unreadable'));
          },
          () => reject(new DocumentReadError('document_unreadable')),
        );
      };
      const abort = (): void =>
        finish(undefined, new DOMException('Document reading cancelled', 'AbortError'));
      const timer = setTimeout(
        () => finish(undefined, new DocumentReadError('document_timeout')),
        settings.timeoutMs,
      );
      worker.once('error', () => finish(undefined, new DocumentReadError('document_unreadable')));
      worker.once('exit', () => {
        if (!settled) finish(undefined, new DocumentReadError('document_unreadable'));
      });
      worker.once('message', (reply: DocumentReply) => finish(reply));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        worker.postMessage({
          buffer: input.buffer,
          filename: input.filename,
          mimeType: input.mimeType,
          sourceUrl: input.sourceUrl,
          settings,
          options: input.options ?? {},
          tempPath,
        } satisfies DocumentJob);
      } catch {
        finish(undefined, new DocumentReadError('document_unreadable'));
      }
    });
  } finally {
    active--;
    if (folder) await rm(folder, { recursive: true, force: true });
  }
}
