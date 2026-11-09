import { schoolBrowserSettingsSchema } from 'librechat-data-provider';
import type { BrowserFetch } from './client';
import { createSchoolBrowserClient } from './client';

const settings = schoolBrowserSettingsSchema.parse({ enabled: true });
const token = 'synthetic-test-token-that-is-not-a-real-credential';
test('binds namespaces to owner, tenant and conversation, never model input', async () => {
  const scopes: string[] = [];
  const fetchFn: BrowserFetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    scopes.push(body.scope);
    expect(options?.redirect).toBe('error');
    return Response.json({ ok: true, value: { status: 'closed' } });
  });
  for (const [id, tenantId, conversationId] of [
    ['alice', 'one', 'conversation-a'],
    ['bob', 'one', 'conversation-a'],
    ['alice', 'two', 'conversation-a'],
    ['alice', 'one', 'conversation-b'],
    ['alice', 'one', 'conversation-a'],
  ]) {
    await createSchoolBrowserClient({
      user: { id, tenantId },
      conversationId,
      settings,
      token,
      fetchFn,
    }).request();
  }
  expect(new Set(scopes.slice(0, 4)).size).toBe(4);
  expect(scopes[0]).toBe(scopes[4]);
  expect(scopes.every((scope) => /^[a-f0-9]{64}$/.test(scope))).toBe(true);
});
test('requires a configured credential and valid conversation without making requests', async () => {
  const fetchFn = jest.fn();
  expect(
    (
      await createSchoolBrowserClient({
        user: { id: 'alice' },
        conversationId: 'conversation-a',
        settings,
        fetchFn,
      }).request()
    ).ok,
  ).toBe(false);
  expect(
    (
      await createSchoolBrowserClient({
        user: { id: 'alice' },
        conversationId: '../other',
        settings,
        token,
        fetchFn,
      }).request()
    ).ok,
  ).toBe(false);
  expect(fetchFn).not.toHaveBeenCalled();
});
test.each([401, 500])('does not disclose upstream failures or credentials (%s)', async (status) => {
  const fetchFn: BrowserFetch = jest.fn(
    async () => new Response('private diagnostics: password and source body', { status }),
  );
  const result = await createSchoolBrowserClient({
    user: { id: 'alice' },
    conversationId: 'conversation-a',
    settings,
    token,
    fetchFn,
  }).request();
  expect(result).toEqual({ ok: false, error: { code: 'browser_unavailable' } });
});
test('rejects unbounded responses and unsafe image or URL data', async () => {
  for (const value of [
    { status: 'ready', url: 'javascript:alert(1)' },
    { status: 'ready', image: '<svg/>' },
    { status: 'ready', text: 'x'.repeat(2400000) },
  ]) {
    const fetchFn: BrowserFetch = jest.fn(async () => Response.json({ ok: true, value }));
    const result = await createSchoolBrowserClient({
      user: { id: 'alice' },
      conversationId: 'conversation-a',
      settings,
      token,
      fetchFn,
    }).request();
    expect(result.ok).toBe(false);
  }
});
