import express from 'express';
import request from 'supertest';
import { resolveSchoolConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { createSchoolRouter } from '../router';

function setup(enabled = true) {
  const factory = jest.fn(() => ({
    request: jest.fn().mockResolvedValue({ ok: true, value: { status: 'closed' } }),
  }));
  const app = express();
  app.use(express.json());
  app.use(
    '/school',
    createSchoolRouter({
      createBrowserClient: factory,
      getAppConfig: jest.fn().mockResolvedValue({
        interfaceConfig: { school: resolveSchoolConfig({ enabled: true, browser: { enabled } }) },
      } as AppConfig),
      requireJwtAuth: (req, res, next) => {
        if (req.headers.authorization !== 'Bearer synthetic-user') {
          res.sendStatus(401);
          return;
        }
        Object.defineProperty(req, 'user', {
          value: { id: 'alice', tenantId: 'school-a', role: 'USER' },
        });
        next();
      },
      fetchFn: jest.fn(),
      encrypt: jest.fn(),
      decrypt: jest.fn(),
      store: {
        findOnePluginAuth: jest.fn(),
        updatePluginAuth: jest.fn(),
        deletePluginAuth: jest.fn(),
      },
    }),
  );
  return { app, factory };
}
test.each([
  ['get', undefined],
  ['delete', 'stop'],
  ['post', 'restart'],
] as const)('binds %s to the authenticated owner and fixed control', async (method, control) => {
  const { app, factory } = setup();
  const response = await request(app)
    [method]('/school/browser/conversation-a')
    .set('Authorization', 'Bearer synthetic-user')
    .send({ user: 'bob', scope: 'other-owner' });
  expect(response.status).toBe(200);
  expect(factory).toHaveBeenCalledWith(
    expect.objectContaining({
      user: expect.objectContaining({ id: 'alice', tenantId: 'school-a' }),
      conversationId: 'conversation-a',
    }),
  );
  expect(factory.mock.results[0].value.request).toHaveBeenCalledWith(undefined, control);
  expect(response.headers['cache-control']).toBe('no-store');
});
test('rejects anonymous callers before resolving a client', async () => {
  const { app, factory } = setup();
  expect((await request(app).get('/school/browser/conversation-a')).status).toBe(401);
  expect(factory).not.toHaveBeenCalled();
});
test('enforces institution disablement and rejects malformed chat scopes', async () => {
  const { app, factory } = setup(false);
  expect(
    (
      await request(app)
        .get('/school/browser/conversation-a')
        .set('Authorization', 'Bearer synthetic-user')
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .get('/school/browser/bad%2Fscope')
        .set('Authorization', 'Bearer synthetic-user')
    ).status,
  ).toBe(400);
  expect(factory).not.toHaveBeenCalled();
});
