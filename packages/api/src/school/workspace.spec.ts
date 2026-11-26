import express from 'express';
import mongoose from 'mongoose';
import supertest from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import { resolveSchoolConfig, RetentionMode } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { resolveChatProjectContext } from '../projects/context';
import { createSchoolRouter } from './router';

const origin = 'https://school.instructure.com';
const owner = { user: 'owner', tenantId: 'school-a' };
let mongo: MongoMemoryServer;
const methods = createMethods(mongoose);
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  createModels(mongoose);
  await mongoose.connect(mongo.getUri());
});
afterEach(async () => {
  await Promise.all(
    ['ChatProject', 'Conversation', 'Message', 'SchoolState', 'User'].map((name) =>
      mongoose.models[name].deleteMany({}),
    ),
  );
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

function fixture() {
  const school = resolveSchoolConfig({
    enabled: true,
    workspace: { enabled: true, viewersEnabled: true },
    canvas: { enabled: true, baseUrl: origin },
  })!;
  const fetchFn = jest.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const json = (data: object) =>
      new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/profile')) return json({ id: 42 });
    if (path.endsWith('/courses')) return json([{ id: 1, name: 'History' }]);
    if (path.endsWith('/assignments'))
      return json([{ id: 2, name: 'Essay', due_at: '2099-01-01T00:00:00Z' }]);
    return json({ id: 2, name: 'Essay', description: '<p>Compare primary sources.</p>' });
  });
  const config = { config: {}, interfaceConfig: { school } } as AppConfig;
  const sharing = { allowed: true };
  const app = express();
  app.use(express.json());
  app.use(
    '/school',
    createSchoolRouter({
      workspaceStore: methods,
      requireSharingAccess: (_req, res, next) => {
        if (sharing.allowed) next();
        else res.sendStatus(403);
      },
      store: {
        findOnePluginAuth: async () => ({ value: JSON.stringify({ origin, token: 'TEST_TOKEN' }) }),
        updatePluginAuth: async ({ value }) => ({ value }),
        deletePluginAuth: async () => ({ deletedCount: 1 }),
      },
      encrypt: async (v) => v,
      decrypt: async (v) => v,
      fetchFn,
      getAppConfig: async () => config,
      requireJwtAuth: (req, res, next) => {
        const user = req.header('x-user');
        if (!user) {
          res.sendStatus(401);
          return;
        }
        Object.assign(req, {
          user: { id: user, tenantId: req.header('x-tenant') ?? owner.tenantId, role: 'USER' },
        });
        next();
      },
    }),
  );
  return { app, fetchFn, school, config, sharing };
}

it('keeps the consent prompt undecided until an explicit choice; only Allow creates course roots', async () => {
  const { app } = fixture();
  await supertest(app).get('/school/workspace').expect(401);
  const first = await supertest(app).get('/school/workspace').set('x-user', owner.user).expect(200);
  expect(first.body).toMatchObject({
    choice: 'undecided',
    projects: [],
    assignments: [{ title: 'Essay', courseId: '1' }],
  });
  await supertest(app)
    .put('/school/workspace/choice')
    .set('x-user', owner.user)
    .send({ choice: 'denied' })
    .expect(200);
  expect(
    (await supertest(app).get('/school/workspace').set('x-user', owner.user)).body.projects,
  ).toEqual([]);
  await supertest(app)
    .put('/school/workspace/choice')
    .set('x-user', owner.user)
    .send({ choice: 'allowed' })
    .expect(200);
  const allowed = await supertest(app)
    .get('/school/workspace')
    .set('x-user', owner.user)
    .expect(200);
  expect(allowed.body.projects).toHaveLength(1);
  expect(allowed.body.projects[0].school).toMatchObject({ kind: 'course', courseId: '1' });
  expect(await mongoose.models.Conversation.countDocuments()).toBe(0);
});

it('makes imported assignments common to independent chats and refreshes subsequent turns', async () => {
  const { app } = fixture();
  const project = (await methods.createSchoolProject(owner, 'Research'))!;
  await supertest(app)
    .post(`/school/workspace/projects/${project._id}/sources`)
    .set('x-user', owner.user)
    .send({ courseId: '1', id: '2' })
    .expect(200);
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const result = await supertest(app)
      .post('/school/workspace/chats')
      .set('x-user', owner.user)
      .send({ projectId: project._id })
      .expect(201);
    ids.push(result.body.conversationId);
  }
  for (const conversationId of ids) {
    const context = await resolveChatProjectContext(
      { userId: owner.user, tenantId: owner.tenantId, conversationId },
      {
        getConvo: methods.getConvo,
        getChatProject: methods.getChatProject,
        getProjectFiles: async () => [],
      },
    );
    expect(context?.instructions).toContain('Compare primary sources.');
    expect(context?.contextRevision).toBe(1);
  }
  await supertest(app)
    .delete(`/school/workspace/projects/${project._id}/sources/1/2`)
    .set('x-user', owner.user)
    .expect(200);
  const refreshed = await resolveChatProjectContext(
    { userId: owner.user, tenantId: owner.tenantId, conversationId: ids[0] },
    {
      getConvo: methods.getConvo,
      getChatProject: methods.getChatProject,
      getProjectFiles: async () => [],
    },
  );
  expect(refreshed?.instructions).not.toContain('Compare primary sources.');
  expect(refreshed?.contextRevision).toBe(2);
});

it('checks project ownership before fetching Canvas material and sanitizes provider failures', async () => {
  const { app, fetchFn } = fixture();
  const project = (await methods.createSchoolProject(owner, 'Private'))!;
  await supertest(app)
    .post(`/school/workspace/projects/${project._id}/sources`)
    .set('x-user', 'other')
    .send({ courseId: '1', id: '2' })
    .expect(404);
  expect(fetchFn).not.toHaveBeenCalled();
  fetchFn.mockRejectedValueOnce(new Error('TEST_TOKEN with private diagnostics'));
  const failed = await supertest(app)
    .post(`/school/workspace/projects/${project._id}/sources`)
    .set('x-user', owner.user)
    .send({ courseId: '1', id: '2' });
  expect(failed.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(failed.body)).not.toMatch(/TEST_TOKEN|diagnostics/);
});

it('keeps ordinary project work available during a Canvas outage without resetting consent', async () => {
  const { app, fetchFn } = fixture();
  await methods.setSchoolChoice(owner, `${origin}/42`, 'denied');
  const project = (await methods.createSchoolProject(owner, 'Local research'))!;
  fetchFn.mockImplementation(async () => new Response('Unavailable', { status: 503 }));
  const result = await supertest(app)
    .get('/school/workspace')
    .set('x-user', owner.user)
    .expect(200);
  expect(result.body.choice).toBe('unavailable');
  expect(result.body.assignmentsError).toBeDefined();
  expect(result.body.projects[0]._id).toBe(project._id);
  expect(await methods.getSchoolChoice(owner, `${origin}/42`)).toBe('denied');
  await supertest(app)
    .post('/school/workspace/chats')
    .set('x-user', owner.user)
    .send({ projectId: project._id })
    .expect(201);
});

it.each([RetentionMode.ALL, RetentionMode.EPHEMERAL])(
  'applies %s retention to assignment chats and their visible source message',
  async (mode) => {
    const { app, config } = fixture();
    config.interfaceConfig = {
      ...config.interfaceConfig,
      retentionMode: mode,
      generalChatRetention: 1,
      temporaryChatRetention: 1,
    };
    const response = await supertest(app)
      .post('/school/workspace/chats')
      .set('x-user', owner.user)
      .send({ assignment: { courseId: '1', id: '2' } })
      .expect(201);
    const conversationId = response.body.conversationId;
    const convo = await mongoose.models.Conversation.findOne({ conversationId }).lean<{
      expiredAt: Date;
      isTemporary: boolean;
      title: string;
      messages: string[];
    }>();
    const messages = await mongoose.models.Message.find({ conversationId }).lean<
      Array<{ expiredAt: Date; text: string }>
    >();
    expect(convo?.title).toBe('Essay');
    expect(convo?.isTemporary).toBe(mode === RetentionMode.EPHEMERAL);
    expect(convo?.expiredAt.getTime()).toBeGreaterThan(Date.now());
    expect(messages).toHaveLength(1);
    expect(messages[0].expiredAt).toEqual(convo?.expiredAt);
    expect(messages[0].text).toContain('Compare primary sources.');
  },
);

it('honors institution sharing controls, role admission and current sharing content policy', async () => {
  const { app, school, config, sharing } = fixture();
  const viewer = await mongoose.models.User.create({
    email: 'viewer@example.org',
    tenantId: owner.tenantId,
  });
  const id = (await methods.createSchoolChat(owner, {
    title: 'Study',
    preset: { endpoint: 'openAI' },
  }))!;
  sharing.allowed = false;
  await supertest(app)
    .post(`/school/workspace/chats/${id}/viewers`)
    .set('x-user', owner.user)
    .send({ email: viewer.email })
    .expect(403);
  expect(await methods.getSchoolViewers(owner, id)).toEqual([]);
  sharing.allowed = true;
  await supertest(app)
    .post(`/school/workspace/chats/${id}/viewers`)
    .set('x-user', owner.user)
    .send({ email: viewer.email })
    .expect(200);
  school.workspace.viewersEnabled = false;
  await supertest(app)
    .get(`/school/workspace/view/${id}`)
    .set('x-user', String(viewer._id))
    .expect(403);
  school.workspace.viewersEnabled = true;
  config.interfaceConfig = { ...config.interfaceConfig, sharedLinks: false };
  await supertest(app)
    .get(`/school/workspace/view/${id}`)
    .set('x-user', String(viewer._id))
    .expect(403);
  config.interfaceConfig = { ...config.interfaceConfig, sharedLinks: true };
  await mongoose.models.Message.create({
    ...owner,
    conversationId: id,
    messageId: 'private',
    text: 'PRIVATE-CONTENT',
    isCreatedByUser: true,
  });
  config.filters = {
    messages: {
      pii: {
        action: 'block',
        starterPatterns: [],
        customPatterns: [{ id: 'private', label: 'private value', regex: 'PRIVATE-[A-Z]+' }],
      },
    },
  };
  const blocked = await supertest(app)
    .get(`/school/workspace/view/${id}`)
    .set('x-user', String(viewer._id))
    .expect(403);
  expect(blocked.body).toEqual({ code: 'workspace_content_blocked' });
});

it('rejects protected assignment text before copying it into history or project context', async () => {
  const { app, config } = fixture();
  config.filters = {
    messages: {
      pii: {
        action: 'redact',
        starterPatterns: [],
        customPatterns: [
          { id: 'protected', label: 'protected source', regex: 'Compare primary sources' },
        ],
      },
    },
  };
  const project = (await methods.createSchoolProject(owner, 'Research'))!;
  await supertest(app)
    .post('/school/workspace/chats')
    .set('x-user', owner.user)
    .send({ assignment: { courseId: '1', id: '2' } })
    .expect(403, { code: 'workspace_content_blocked' });
  await supertest(app)
    .post(`/school/workspace/projects/${project._id}/sources`)
    .set('x-user', owner.user)
    .send({ courseId: '1', id: '2' })
    .expect(403);
  expect(await mongoose.models.Message.countDocuments()).toBe(0);
  expect((await methods.getSchoolProject(owner, project._id))?.school?.sources).toHaveLength(0);
});

it('serves latest text only to named viewers, follows the latest branch, and stops after revocation', async () => {
  const { app } = fixture();
  const viewer = await mongoose.models.User.create({
    email: 'viewer@example.org',
    tenantId: owner.tenantId,
  });
  const id = (await methods.createSchoolChat(owner, {
    title: 'Study',
    preset: { endpoint: 'openAI' },
  }))!;
  await mongoose.models.Message.create({
    ...owner,
    conversationId: id,
    messageId: 'question',
    text: 'Question',
    isCreatedByUser: true,
    createdAt: new Date('2026-01-01'),
  });
  await mongoose.models.Message.create({
    ...owner,
    conversationId: id,
    messageId: 'old-answer',
    parentMessageId: 'question',
    text: 'Old branch',
    createdAt: new Date('2026-01-02'),
  });
  await mongoose.models.Message.create({
    ...owner,
    conversationId: id,
    messageId: 'new-answer',
    parentMessageId: 'question',
    text: 'Latest answer',
    privateText: 'PRIVATE',
    createdAt: new Date('2026-01-03'),
  });
  await supertest(app)
    .get(`/school/workspace/view/${id}`)
    .set('x-user', String(viewer._id))
    .expect(404);
  await supertest(app)
    .post(`/school/workspace/chats/${id}/viewers`)
    .set('x-user', owner.user)
    .send({ email: viewer.email })
    .expect(200);
  const result = await supertest(app)
    .get(`/school/workspace/view/${id}`)
    .set('x-user', String(viewer._id))
    .expect(200);
  expect(result.body.messages.map((m: { text: string }) => m.text)).toEqual([
    'Question',
    'Latest answer',
  ]);
  expect(JSON.stringify(result.body)).not.toContain('PRIVATE');
  await supertest(app)
    .post(`/school/workspace/chats/${id}/viewers`)
    .set('x-user', String(viewer._id))
    .send({ email: 'someone@example.org' })
    .expect(404);
  await supertest(app)
    .get(`/school/workspace/view/${id}`)
    .set('x-user', String(viewer._id))
    .set('x-tenant', 'school-b')
    .expect(404);
  await mongoose.models.Message.updateOne(
    { messageId: 'new-answer' },
    { $set: { text: 'Changed text' } },
  );
  const latest = await supertest(app)
    .get(`/school/workspace/view/${id}`)
    .set('x-user', String(viewer._id))
    .expect(200);
  expect(latest.body.messages[1].text).toBe('Changed text');
  await supertest(app)
    .delete(`/school/workspace/chats/${id}/viewers/${viewer._id}`)
    .set('x-user', owner.user)
    .expect(204);
  await supertest(app)
    .get(`/school/workspace/view/${id}`)
    .set('x-user', String(viewer._id))
    .expect(404);
});
