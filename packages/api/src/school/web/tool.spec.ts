import '~/mcp/registry/__tests__/helpers/setupCredsEnv';
import {
  resolveSchoolConfig,
  SCHOOL_WEB_TOOL_NAME,
  webSearchSchema,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { createSchoolWebTool, schoolWebToolsEnabled } from './tool';
import { canvasLinkedUrls, createCanvasClient } from '../canvas';
import { encryptConfigSecretFields } from '~/admin/secrets';
import { loadToolDefinitions } from '~/tools/definitions';
import { makePdf } from '../documents/__fixtures__/pdf';
import { readSchoolDocument } from '../documents/read';
import { loadEphemeralAgent } from '~/agents/load';
import { readBraveSearchKey } from './search';

const user = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'USER', tenantId: 'school-a' };
function fixture() {
  const school = resolveSchoolConfig({ enabled: true, documents: { enabled: true } })!;
  const config = {
    interfaceConfig: { school },
    webSearch: { braveApiKey: 'institution-secret' },
    modelSpecs: { list: [{ name: 'helper', schoolWeb: true }] },
  } as AppConfig;
  const fetchFn = jest
    .fn<Promise<Response>, [string, RequestInit]>()
    .mockImplementation(
      async () =>
        new Response(
          '<html><title>Milk study</title><nav>Skip navigation</nav><article><h1>Prices and choices</h1><p>Households switched to lower-fat milk.</p><a href="/study">Original study</a><script>PRIVATE_SCRIPT</script></article></html>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
    );
  const close = jest.fn(async () => undefined);
  const getAppConfig = jest.fn(async () => config);
  const deps = {
    getAppConfig,
    readDocument: readSchoolDocument,
    createDocumentTransport: () => ({ fetchFn, close }),
  };
  const tool = createSchoolWebTool({ user, deps });
  return { school, config, fetchFn, close, tool, getAppConfig, deps };
}
it('preserves the assignment’s external destinations, excluding unsafe links and Canvas credentials', async () => {
  const html =
    '<a href="https://news.umich.edu/how-a-fat-tax-could-work-as-intended/">Open Contemporary Article</a><a href="javascript:bad()">bad</a><a href="https://user:key@example.com">secret</a><a href="/courses/1/files/9?verifier=PRIVATE">PDF</a>';
  expect(canvasLinkedUrls(html, 'https://school.instructure.com')).toEqual([
    {
      title: 'Open Contemporary Article',
      url: 'https://news.umich.edu/how-a-fat-tax-could-work-as-intended/',
    },
  ]);
  const school = resolveSchoolConfig({ canvas: { baseUrl: 'https://school.instructure.com' } })!;
  const client = createCanvasClient({
    baseUrl: school.canvas.baseUrl!,
    token: 'PRIVATE',
    settings: school.canvas,
    fetchFn: async () =>
      new Response(JSON.stringify({ id: 7, name: 'Fat tax', description: html })),
  });
  const context = await client.context([{ courseId: '1', kind: 'assignment', id: '7' }]);
  expect(context.linkedUrls?.[0].url).toBe(
    'https://news.umich.edu/how-a-fat-tax-could-work-as-intended/',
  );
  expect(context.markdown).toContain('Open Contemporary Article: https://news.umich.edu/');
  expect(context.markdown).not.toContain('verifier');
});
it('reads real article HTML with safe extraction, source links, and no script execution', async () => {
  const { tool, getAppConfig } = fixture();
  const result = JSON.parse(
    await tool.invoke({ operation: 'read', url: 'https://news.example.edu/article' }),
  );
  expect(result).toMatchObject({
    ok: true,
    value: { source: 'https://news.example.edu/article', format: 'html' },
  });
  expect(result.value.text).toContain('Households switched to lower-fat milk.');
  expect(result.value.text).toContain('https://news.example.edu/study');
  expect(result.value.text).not.toMatch(/PRIVATE_SCRIPT|Skip navigation/);
  expect(getAppConfig).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: 'school-a', failClosed: true }),
  );
});
it('reads external PDFs by page range using the real parser', async () => {
  const { tool, fetchFn } = fixture();
  fetchFn.mockResolvedValue(
    new Response(new Uint8Array(makePdf(['First page.', 'Second page evidence.'])), {
      headers: { 'content-type': 'application/pdf' },
    }),
  );
  const result = JSON.parse(
    await tool.invoke({
      operation: 'read',
      url: 'https://example.edu/handout.pdf',
      start_page: 2,
      end_page: 2,
    }),
  );
  expect(result).toMatchObject({ ok: true, value: { format: 'pdf', startPage: 2 } });
  expect(result.value.text).toContain('[Page 2]\nSecond page evidence.');
});
it('searches Brave with the institution key and strict SafeSearch, returning citations without credentials', async () => {
  const { tool, fetchFn } = fixture();
  fetchFn.mockResolvedValue(
    new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: 'University <b>study</b>',
              url: 'https://news.example.edu/milk',
              description: 'Lower-fat <strong>milk</strong>.',
            },
          ],
        },
      }),
    ),
  );
  const output = await tool.invoke({ operation: 'search', query: 'milk price elasticity' });
  expect(JSON.parse(output)).toMatchObject({
    ok: true,
    value: {
      provider: 'Brave Search',
      results: [
        {
          title: 'University study',
          url: 'https://news.example.edu/milk',
          snippet: 'Lower-fat milk.',
        },
      ],
    },
  });
  const [url, request] = fetchFn.mock.calls[0];
  expect(new URL(url).origin).toBe('https://api.search.brave.com');
  expect(new URL(url).searchParams.get('safesearch')).toBe('strict');
  expect(request.headers).toMatchObject({ 'X-Subscription-Token': 'institution-secret' });
  expect(output).not.toContain('institution-secret');
});
it('applies live institutional toggles separately on every call and defaults external fetching on', async () => {
  const { tool, school, fetchFn, config } = fixture();
  expect(resolveSchoolConfig({ enabled: true })!.externalLinks.enabled).toBe(true);
  school.externalLinks.enabled = false;
  expect(
    JSON.parse(await tool.invoke({ operation: 'read', url: 'https://example.edu/' })).error.code,
  ).toBe('web_disabled');
  expect(fetchFn).not.toHaveBeenCalled();
  school.webSearch.enabled = false;
  expect(schoolWebToolsEnabled(school)).toBe(false);
  school.webSearch.enabled = true;
  config.webSearch!.braveApiKey = '';
  expect(JSON.parse(await tool.invoke({ operation: 'search', query: 'test' })).error.code).toBe(
    'web_search_unconfigured',
  );
  expect(fetchFn).not.toHaveBeenCalled();
});
it('uses encrypted per-institution credentials and applies native allowlists at definition and execution time', async () => {
  const { tool, config, school, fetchFn } = fixture();
  const stored = await encryptConfigSecretFields({ webSearch: { braveApiKey: 'school-b-secret' } });
  const storedSearch = webSearchSchema.parse(stored.webSearch);
  expect(storedSearch.braveApiKey).not.toBe('school-b-secret');
  expect(readBraveSearchKey(storedSearch)).toBe('school-b-secret');
  config.filteredTools = [SCHOOL_WEB_TOOL_NAME];
  const definitions = await loadToolDefinitions(
    {
      userId: user.id,
      agentId: 'agent',
      tools: [SCHOOL_WEB_TOOL_NAME],
      school,
      filteredTools: config.filteredTools,
    },
    { isBuiltInTool: () => false, getOrFetchMCPServerTools: async () => null },
  );
  expect(definitions.toolDefinitions).toEqual([]);
  expect(
    JSON.parse(await tool.invoke({ operation: 'read', url: 'https://example.edu/' })).error.code,
  ).toBe('web_disabled');
  expect(fetchFn).not.toHaveBeenCalled();
  config.filteredTools = [];
  const agent = await loadEphemeralAgent(
    { req: { user, config }, spec: 'helper', endpoint: 'openAI' },
    { getAgent: async () => null, getMCPServerTools: async () => null },
  );
  expect(agent?.tools).toContain(SCHOOL_WEB_TOOL_NAME);
});
it('discloses site denial safely and does not forward provider errors or a key to arbitrary sites', async () => {
  const { tool, fetchFn } = fixture();
  fetchFn.mockResolvedValue(new Response('PRIVATE echoed upstream body', { status: 403 }));
  const denied = await tool.invoke({ operation: 'read', url: 'https://example.edu/' });
  expect(JSON.parse(denied).error.code).toBe('web_forbidden');
  expect(denied).not.toMatch(/PRIVATE|institution-secret/);
  expect(new Headers(fetchFn.mock.calls[0][1].headers).has('X-Subscription-Token')).toBe(false);
});
