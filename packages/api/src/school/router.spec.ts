import '~/mcp/registry/__tests__/helpers/setupCredsEnv';
import express from 'express';
import supertest from 'supertest';
import { resolveSchoolConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { encryptCredential, decryptCredential } from '~/crypto';
import { createSchoolRouter } from './router';

describe('school Canvas authorization', () => {
  function fixture() {
    const school = resolveSchoolConfig({
      enabled: true,
      canvas: { enabled: true, baseUrl: 'https://school.instructure.com' },
    });
    const rows = new Map<string, { value: string }>();
    const fetchFn = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockImplementation(async () => new Response(JSON.stringify({ id: 1 })));
    const getAppConfig = jest.fn(
      async () => ({ config: {}, interfaceConfig: { school } }) as AppConfig,
    );
    const store = {
      findOnePluginAuth: jest.fn(
        async ({ userId }: { userId: string }) => rows.get(userId) ?? null,
      ),
      updatePluginAuth: jest.fn(async ({ userId, value }: { userId: string; value: string }) => {
        const row = { value };
        rows.set(userId, row);
        return row;
      }),
      deletePluginAuth: jest.fn(async ({ userId }: { userId: string }) => ({
        deletedCount: rows.delete(userId) ? 1 : 0,
      })),
    };
    const app = express();
    app.use(express.json());
    app.use(
      '/api/school',
      createSchoolRouter({
        getAppConfig,
        store,
        fetchFn,
        encrypt: encryptCredential,
        decrypt: decryptCredential,
        requireJwtAuth: (req, res, next) => {
          const id = req.header('x-test-user');
          if (!id) {
            res.sendStatus(401);
            return;
          }
          Object.assign(req, { user: { id, role: 'USER' } });
          next();
        },
      }),
    );
    return { app, rows, fetchFn, getAppConfig, school, store };
  }
  it('requires a local session before any upstream call', async () => {
    const { app, fetchFn } = fixture();
    await supertest(app).get('/api/school/canvas/courses').expect(401);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('stores encrypted credentials for their owner and never includes them in metadata', async () => {
    const { app, rows } = fixture();
    await supertest(app)
      .put('/api/school/canvas/connection')
      .set('x-test-user', 'A')
      .send({ token: 'personal-canvas-token' })
      .expect(200, { connected: true });
    const stored = rows.get('A')!.value;
    expect(stored).toMatch(/^v3:/);
    expect(stored).not.toContain('personal-canvas-token');
    const owner = await supertest(app).get('/api/school').set('x-test-user', 'A').expect(200);
    expect(owner.body.canvas.connected).toBe(true);
    expect(JSON.stringify(owner.body)).not.toContain('personal-canvas-token');
    const other = await supertest(app).get('/api/school').set('x-test-user', 'B').expect(200);
    expect(other.body.canvas.connected).toBe(false);
    await supertest(app)
      .get('/api/school/canvas/courses')
      .set('x-test-user', 'B')
      .expect(409, { code: 'canvas_not_connected' });
  });
  it('will not replay an old token to a newly configured institution', async () => {
    const { app, school, fetchFn } = fixture();
    await supertest(app)
      .put('/api/school/canvas/connection')
      .set('x-test-user', 'A')
      .send({ token: 'personal-canvas-token' })
      .expect(200);
    school!.canvas.baseUrl = 'https://other.instructure.com';
    fetchFn.mockClear();
    await supertest(app).get('/api/school/canvas/courses').set('x-test-user', 'A').expect(409);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('honors disabled profile policy and permits disconnecting a stale connection', async () => {
    const { app, school, fetchFn, store } = fixture();
    school!.enabled = false;
    await supertest(app)
      .get('/api/school/canvas/courses')
      .set('x-test-user', 'A')
      .expect(403, { code: 'school_disabled' });
    await supertest(app)
      .delete('/api/school/canvas/connection')
      .set('x-test-user', 'A')
      .expect(204);
    expect(store.deletePluginAuth).toHaveBeenCalledWith({
      userId: 'A',
      pluginKey: 'school-canvas',
      all: true,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('rejects malformed selections and never returns raw provider errors', async () => {
    const { app, fetchFn } = fixture();
    await supertest(app)
      .post('/api/school/canvas/context')
      .set('x-test-user', 'A')
      .send({ selections: [{ courseId: '1', kind: 'grade', id: '2' }] })
      .expect(400);
    fetchFn.mockResolvedValue(new Response('sensitive-provider-error', { status: 401 }));
    const failure = await supertest(app)
      .put('/api/school/canvas/connection')
      .set('x-test-user', 'A')
      .send({ token: 'personal-canvas-token' })
      .expect(400);
    expect(failure.body).toEqual({ code: 'canvas_unauthorized' });
  });
});
