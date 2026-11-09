import { resolveSchoolConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { createSchoolBrowserTool, schoolBrowserEnabled } from './tool';

function config(enabled = true): AppConfig {
  return {
    interfaceConfig: { school: resolveSchoolConfig({ enabled: true, browser: { enabled } }) },
  } as AppConfig;
}
function setup(getAppConfig = jest.fn().mockResolvedValue(config())) {
  const request = jest.fn().mockResolvedValue({
    ok: true,
    value: { status: 'ready', url: 'https://example.com/', text: 'Observed example page' },
  });
  const tool = createSchoolBrowserTool({
    user: { id: 'alice' },
    conversationId: 'conversation-a',
    deps: { getAppConfig, createClient: () => ({ request }) },
  });
  return { tool, request };
}
test('defaults off and respects institution tool restrictions', () => {
  expect(schoolBrowserEnabled({ enabled: true })).toBe(false);
  expect(
    schoolBrowserEnabled(config().interfaceConfig?.school, { filteredTools: ['school_browser'] }),
  ).toBe(false);
  expect(schoolBrowserEnabled(config().interfaceConfig?.school, { includedTools: ['web'] })).toBe(
    false,
  );
});
test('returns observed page results using the native tool response contract', async () => {
  const { tool, request } = setup();
  const result = await tool.invoke({ operation: 'open', url: 'https://example.com' });
  expect(JSON.stringify(result)).toContain('Observed example page');
  expect(request).toHaveBeenCalledWith({ operation: 'open', url: 'https://example.com' });
});
test('revocation during retrieval closes the session and withholds content', async () => {
  const getAppConfig = jest.fn().mockResolvedValueOnce(config()).mockResolvedValue(config(false));
  const { tool, request } = setup(getAppConfig);
  const result = JSON.stringify(await tool.invoke({ operation: 'read' }));
  expect(result).toContain('browser_disabled');
  expect(result).not.toContain('Observed example page');
  expect(request).toHaveBeenLastCalledWith({ operation: 'close' });
});
test('a configuration outage does not run the browser or disclose diagnostics', async () => {
  const { tool, request } = setup(
    jest.fn().mockRejectedValue(new Error('private database password')),
  );
  const result = JSON.stringify(await tool.invoke({ operation: 'read' }));
  expect(result).toContain('browser_unavailable');
  expect(result).not.toContain('password');
  expect(request).not.toHaveBeenCalled();
});
