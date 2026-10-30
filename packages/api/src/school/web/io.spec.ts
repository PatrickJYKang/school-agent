import { resolveSchoolConfig } from 'librechat-data-provider';
import { downloadPublicSource, publicWebUrl } from './io';

const settings = resolveSchoolConfig({})!.externalLinks;
function fixture() {
  const fetchFn = jest
    .fn<Promise<Response>, [string, RequestInit]>()
    .mockImplementation(
      async () => new Response('Public article', { headers: { 'content-type': 'text/plain' } }),
    );
  const close = jest.fn(async () => undefined);
  const run = (url = 'https://news.example.edu/article') =>
    downloadPublicSource({ url, settings, createTransport: () => ({ fetchFn, close }) });
  return { fetchFn, close, run };
}
it.each([
  'http://127.0.0.1/a',
  'https://[::1]/',
  'https://localhost/',
  'https://host.internal/',
  'file:///etc/passwd',
  'https://user:key@example.com/',
  'https://site.example:3000/',
])('rejects unsafe sources before transport use: %s', (url) => {
  expect(() => publicWebUrl(url)).toThrow();
});
it('follows public redirects without credentials and returns the actual source URL', async () => {
  const { fetchFn, close, run } = fixture();
  fetchFn.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: 'https://cdn.example.edu/text.txt' } }),
  );
  const result = await run();
  expect(result).toMatchObject({
    source: 'https://cdn.example.edu/text.txt',
    mimeType: 'text/plain',
    filename: 'text.txt',
  });
  expect(result.buffer.toString()).toBe('Public article');
  for (const [, options] of fetchFn.mock.calls) {
    expect(options.method).toBe('GET');
    expect(new Headers(options.headers).has('authorization')).toBe(false);
    expect(new Headers(options.headers).has('cookie')).toBe(false);
  }
  expect(close).toHaveBeenCalledTimes(1);
});
it('rejects private redirects, oversized bodies, and access-denied pages with safe errors', async () => {
  const { fetchFn, run } = fixture();
  fetchFn.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    }),
  );
  await expect(run()).rejects.toMatchObject({ code: 'web_invalid_url' });
  expect(fetchFn).toHaveBeenCalledTimes(1);
  fetchFn.mockResolvedValueOnce(
    new Response('PRIVATE credentials echoed by site', { status: 403 }),
  );
  await expect(run()).rejects.toMatchObject({ code: 'web_forbidden', message: 'web_forbidden' });
  fetchFn.mockResolvedValueOnce(
    new Response('oversized', { headers: { 'content-length': String(settings.maxBytes + 1) } }),
  );
  await expect(run()).rejects.toMatchObject({ code: 'web_too_large' });
});
it('bounds redirect loops and cancellation, closing the transport', async () => {
  const { fetchFn, close, run } = fixture();
  fetchFn.mockImplementation(
    async () => new Response(null, { status: 302, headers: { location: '/loop' } }),
  );
  await expect(run()).rejects.toMatchObject({ code: 'web_invalid_response' });
  expect(fetchFn).toHaveBeenCalledTimes(settings.maxRedirects + 1);
  expect(close).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  controller.abort();
  await expect(
    downloadPublicSource({
      url: 'https://example.edu/',
      settings,
      createTransport: () => ({ fetchFn, close }),
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
