import { z } from 'zod';
import { AuthType } from 'librechat-data-provider';
import type { SchoolConfig, TCustomConfig } from 'librechat-data-provider';
import type { DocumentTransport } from '../documents/download';
import { boundedWebBody, publicWebUrl, SchoolWebError } from './io';
import { resolveConfigSecret } from '~/admin/secrets';
import { canvasText } from '../canvas';

export function readBraveSearchKey(config: TCustomConfig['webSearch']): string | undefined {
  const value = resolveConfigSecret(config?.braveApiKey ?? '${BRAVE_SEARCH_API_KEY}')?.trim();
  if (!value || value === AuthType.USER_PROVIDED || /^\$\{[^}]+\}$/.test(value)) return undefined;
  return value;
}

const resultSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string(),
            url: z.string(),
            description: z.string().optional(),
            age: z.string().optional(),
          }),
        )
        .default([]),
    })
    .optional(),
});

/** The key's destination is fixed; institutional configuration cannot redirect it elsewhere. */
export async function searchBrave(input: {
  query: string;
  key: string;
  settings: SchoolConfig['webSearch'];
  createTransport: () => DocumentTransport;
  signal?: AbortSignal;
}): Promise<{
  provider: 'Brave Search';
  results: { title: string; url: string; snippet: string; age?: string }[];
}> {
  const { settings, signal } = input;
  signal?.throwIfAborted();
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', input.query);
  url.searchParams.set('count', String(settings.maxResults));
  url.searchParams.set('safesearch', settings.safeSearch);
  url.searchParams.set('text_decorations', 'false');
  const transport = input.createTransport();
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, settings.timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await transport.fetchFn(url.href, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-Subscription-Token': input.key },
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new SchoolWebError('web_search_unauthorized');
      if (response.status === 429) throw new SchoolWebError('web_rate_limited');
      throw new SchoolWebError('web_unavailable');
    }
    const buffer = await boundedWebBody(response, settings.maxResponseBytes);
    const parsed = resultSchema.safeParse(JSON.parse(buffer.toString('utf8')));
    if (!parsed.success) throw new SchoolWebError('web_invalid_response');
    const results = [];
    for (const item of (parsed.data.web?.results ?? []).slice(0, settings.maxResults)) {
      try {
        results.push({
          title: canvasText(item.title),
          url: publicWebUrl(item.url).href,
          snippet: canvasText(item.description ?? ''),
          age: item.age,
        });
      } catch {
        /* A malformed result is not a source. */
      }
    }
    return { provider: 'Brave Search', results };
  } catch (error) {
    signal?.throwIfAborted();
    if (controller.signal.aborted) throw new SchoolWebError('web_timeout');
    if (error instanceof SchoolWebError) throw error;
    throw new SchoolWebError('web_invalid_response');
  } finally {
    controller.abort();
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await transport.close();
  }
}
