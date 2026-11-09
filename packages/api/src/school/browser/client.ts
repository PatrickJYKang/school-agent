import { createHmac } from 'node:crypto';
import { schoolBrowserResultSchema } from 'librechat-data-provider';
import type {
  SchoolBrowserSettings,
  SchoolBrowserInput,
  SchoolBrowserResult,
} from 'librechat-data-provider';

export type BrowserTransport = {
  request: (
    input?: SchoolBrowserInput,
    control?: 'stop' | 'restart',
  ) => Promise<SchoolBrowserResult>;
};
export type BrowserFetch = (url: string, options: RequestInit) => Promise<Response>;

export function createSchoolBrowserClient({
  settings,
  token,
  user,
  conversationId,
  fetchFn,
  signal,
}: {
  settings: SchoolBrowserSettings;
  token?: string;
  user: { id: string; tenantId?: string };
  conversationId: string;
  fetchFn: BrowserFetch;
  signal?: AbortSignal;
}): BrowserTransport {
  return {
    request: async (input, control) => {
      const timeout = AbortSignal.timeout(settings.timeoutMs);
      if (!token || token.length < 32)
        return { ok: false, error: { code: 'browser_unconfigured' } };
      if (!user.id || !/^[a-zA-Z0-9_-]{8,128}$/.test(conversationId))
        return { ok: false, error: { code: 'browser_invalid_request' } };
      const scope = createHmac('sha256', token)
        .update(JSON.stringify([user.tenantId ?? 'legacy', user.id, conversationId]))
        .digest('hex');
      const { serviceUrl, tokenEnv: _tokenEnv, ...policy } = settings;
      try {
        const response = await fetchFn(new URL('/session', serviceUrl).href, {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ scope, input, settings: policy, ...(control ? { control } : {}) }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          return { ok: false, error: { code: 'browser_unavailable' } };
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 2300000) return { ok: false, error: { code: 'browser_unavailable' } };
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        return schoolBrowserResultSchema.parse(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        signal?.throwIfAborted();
        if (timeout.aborted) return { ok: false, error: { code: 'browser_timeout' } };
        return { ok: false, error: { code: 'browser_unavailable' } };
      }
    },
  };
}
