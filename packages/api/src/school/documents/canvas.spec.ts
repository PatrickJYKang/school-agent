import { resolveSchoolConfig } from 'librechat-data-provider';
import { canvasFileLinks, createCanvasClient } from '../canvas';

const origin = 'https://school.instructure.com';
const settings = resolveSchoolConfig({ canvas: { enabled: true, baseUrl: origin } })!.canvas;
const metadata = {
  id: 9,
  filename: 'handout.pdf',
  display_name: 'handout.pdf',
  'content-type': 'application/pdf',
  size: 100,
};
function fixture() {
  const api = jest
    .fn<Promise<Response>, [string, RequestInit]>()
    .mockImplementation(async () => new Response(JSON.stringify(metadata)));
  const download = jest
    .fn<Promise<Response>, [string, RequestInit]>()
    .mockImplementation(async () => new Response('%PDF-small-fixture'));
  const close = jest.fn(async () => undefined);
  const transport = () => ({ fetchFn: download, close });
  const client = createCanvasClient({
    baseUrl: origin,
    token: 'private-token',
    settings,
    fetchFn: api,
  });
  return { api, download, close, transport, client };
}
it('preserves only same-institution, same-course file references with canonical links', () => {
  const links = canvasFileLinks(
    `<p><a href="/courses/2/files/9/download?verifier=secret">Read the handout</a>
    <a data-api-endpoint="${origin}/api/v1/courses/2/files/9" href="/files/9">duplicate</a>
    <a href="https://attacker.example/files/5">external</a><a href="/courses/3/files/8">other course</a></p>`,
    origin,
    '2',
  );
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({
    courseId: '2',
    fileId: '9',
    url: `${origin}/courses/2/files/9`,
  });
  expect(JSON.stringify(links)).not.toContain('secret');
});
it('checks course permissions, follows bounded CDN redirects, and never forwards the bearer off origin', async () => {
  const { client, api, download, close, transport } = fixture();
  download.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { location: 'https://files.instructure.com/handout.pdf?signature=private' },
    }),
  );
  const result = await client.downloadFile('2', '9', 1000, transport);
  expect(api.mock.calls[0][0]).toBe(`${origin}/api/v1/courses/2/files/9`);
  expect(download.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer private-token' });
  expect(download.mock.calls[1][1].headers).toEqual({});
  expect(result.file.url).toBe(`${origin}/courses/2/files/9`);
  expect(JSON.stringify(result.file)).not.toMatch(/signature|private/);
  expect(result.buffer.toString()).toBe('%PDF-small-fixture');
  expect(close).toHaveBeenCalledTimes(1);
});
it.each([
  'https://attacker.example/document.pdf',
  'http://files.instructure.com/document.pdf',
  'https://127.0.0.1/document.pdf',
  'https://user:password@files.instructure.com/document.pdf',
])('rejects an unsafe redirect before making that request: %s', async (location) => {
  const { client, download, transport } = fixture();
  download.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
  await expect(client.downloadFile('2', '9', 1000, transport)).rejects.toHaveProperty('code');
  expect(download).toHaveBeenCalledTimes(1);
});
it('will not download locked/hidden files or return over-limit bytes', async () => {
  const { client, api, download, transport } = fixture();
  api.mockResolvedValueOnce(new Response(JSON.stringify({ ...metadata, locked_for_user: true })));
  await expect(client.downloadFile('2', '9', 1000, transport)).rejects.toMatchObject({
    code: 'canvas_forbidden',
  });
  expect(download).not.toHaveBeenCalled();
  download.mockResolvedValueOnce(new Response(Buffer.alloc(1001)));
  await expect(client.downloadFile('2', '9', 1000, transport)).rejects.toMatchObject({
    code: 'document_too_large',
  });
});
it('bounds redirect loops and rejects login pages instead of treating them as documents', async () => {
  const { client, download, close, transport } = fixture();
  download.mockImplementation(
    async () =>
      new Response(null, { status: 302, headers: { location: `${origin}/files/9/download` } }),
  );
  await expect(client.downloadFile('2', '9', 1000, transport)).rejects.toMatchObject({
    code: 'canvas_invalid_response',
  });
  expect(download).toHaveBeenCalledTimes(settings.maxDownloadRedirects + 1);
  expect(close).toHaveBeenCalledTimes(1);
  download.mockResolvedValue(
    new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
  );
  await expect(client.downloadFile('2', '9', 1000, transport)).rejects.toMatchObject({
    code: 'document_unreadable',
  });
});
