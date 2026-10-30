import type { SchoolConfig } from 'librechat-data-provider';
import type { DocumentTransport } from '../documents/download';

export type WebErrorCode =
  | 'web_disabled'
  | 'web_invalid_url'
  | 'web_forbidden'
  | 'web_unavailable'
  | 'web_too_large'
  | 'web_timeout'
  | 'web_search_unconfigured'
  | 'web_search_unauthorized'
  | 'web_rate_limited'
  | 'web_invalid_response';
export class SchoolWebError extends Error {
  constructor(public readonly code: WebErrorCode) {
    super(code);
  }
}

/** DNS is also checked by the transport at connection time, including every redirect. */
export function publicWebUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SchoolWebError('web_invalid_url');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !/^[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}$/i.test(url.hostname) ||
    /\.(local|localhost|internal)$/i.test(url.hostname)
  )
    throw new SchoolWebError('web_invalid_url');
  url.hash = '';
  return url;
}

export async function boundedWebBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new SchoolWebError('web_invalid_response');
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel();
    throw new SchoolWebError('web_too_large');
  }
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new SchoolWebError('web_too_large');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function downloadPublicSource(input: {
  url: string;
  settings: SchoolConfig['externalLinks'];
  createTransport: () => DocumentTransport;
  signal?: AbortSignal;
}): Promise<{ buffer: Buffer; source: string; mimeType: string; filename: string }> {
  const { settings, signal } = input;
  let url = publicWebUrl(input.url);
  signal?.throwIfAborted();
  const transport = input.createTransport();
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, settings.timeoutMs);
  try {
    for (let hop = 0; hop <= settings.maxRedirects; hop++) {
      url = publicWebUrl(url.href);
      const response = await transport.fetchFn(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept:
            'text/html,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document;q=0.9,*/*;q=0.5',
          'User-Agent': 'SchoolAgent/0.1 (public source reader)',
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || hop === settings.maxRedirects)
          throw new SchoolWebError('web_invalid_response');
        url = publicWebUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403, 404].includes(response.status)) throw new SchoolWebError('web_forbidden');
        if (response.status === 429) throw new SchoolWebError('web_rate_limited');
        throw new SchoolWebError('web_unavailable');
      }
      const mimeType = (response.headers.get('content-type') ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const buffer = await boundedWebBody(response, settings.maxBytes);
      let filename = decodeURIComponent(url.pathname.split('/').pop() || 'webpage');
      if (buffer.subarray(0, 5).toString() === '%PDF-') filename = 'document.pdf';
      return { buffer, mimeType, filename, source: url.href };
    }
    throw new SchoolWebError('web_invalid_response');
  } catch (error) {
    signal?.throwIfAborted();
    if (controller.signal.aborted) throw new SchoolWebError('web_timeout');
    if (error instanceof SchoolWebError) throw error;
    throw new SchoolWebError('web_unavailable');
  } finally {
    controller.abort();
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await transport.close();
  }
}
