import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { SchoolSource } from 'librechat-data-provider';
import { createSchoolMethods } from './school';
import { createUserMethods } from './user';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const owner = { user: 'owner', tenantId: 'school-a' };
const other = { user: 'other', tenantId: 'school-a' };
const scope = 'https://school.instructure.com/123';
const source: SchoolSource = {
  courseId: '1',
  id: '2',
  title: 'Essay',
  url: 'https://school.instructure.com/courses/1/assignments/2',
  markdown: 'Compare two primary sources.',
  retrievedAt: '2026-11-25T12:00:00Z',
};
const limits = { maxSources: 3, maxContextChars: 1000 };
const methods = createSchoolMethods(mongoose);
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  createModels(mongoose);
  await mongoose.connect(mongo.getUri(), { autoIndex: false, autoCreate: false });
  await mongoose.models.ChatProject.createIndexes();
  await mongoose.models.SchoolState.createIndexes();
}, 60000);
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

it('persists choices per user, institution and verified Canvas account', async () => {
  expect(await methods.getSchoolChoice(owner, scope)).toBe('undecided');
  await methods.setSchoolChoice(owner, 'https://school.instructure.com', 'denied');
  expect(await methods.bindSchoolChoice(owner, scope, 'https://school.instructure.com')).toBe(
    'denied',
  );
  expect(await methods.getSchoolChoice(other, scope)).toBe('undecided');
  expect(await methods.getSchoolChoice({ ...owner, tenantId: 'school-b' }, scope)).toBe(
    'undecided',
  );
  expect(
    await methods.bindSchoolChoice(owner, `${scope}-different`, 'https://school.instructure.com'),
  ).toBe('undecided');
  await methods.setSchoolChoice(owner, scope, 'allowed');
  expect(await methods.getSchoolChoice(owner, scope)).toBe('allowed');
});

it('syncs course roots idempotently without creating assignment projects or chats', async () => {
  await methods.syncSchoolCourses(owner, scope, [{ id: '1', name: 'History' }]);
  const first = (await methods.listSchoolProjects(owner, 20)).projects[0];
  await methods.syncSchoolCourses(owner, scope, [{ id: '1', name: 'History renamed' }]);
  const second = await methods.listSchoolProjects(owner, 20);
  expect(second.projects).toHaveLength(1);
  expect(second.projects[0]).toMatchObject({
    _id: first._id,
    name: 'History renamed',
    school: { kind: 'course', courseId: '1' },
  });
  expect(await mongoose.models.Conversation.countDocuments()).toBe(0);
  expect(await methods.createSchoolProject(other, 'Foreign home', first._id)).toBeNull();
  expect(await methods.getSchoolProject({ ...owner, tenantId: 'school-b' }, first._id)).toBeNull();
});

it('keeps multiple assignment sources across concurrent imports and revisions', async () => {
  const project = (await methods.createSchoolProject(owner, 'Research'))!;
  const results = await Promise.all([
    methods.putSchoolSource(owner, project._id, source, limits),
    methods.putSchoolSource(
      owner,
      project._id,
      { ...source, courseId: '3', id: '4', title: 'Science' },
      limits,
    ),
  ]);
  expect(results.every((r) => r.ok)).toBe(true);
  const saved = (await methods.getSchoolProject(owner, project._id))!;
  expect(saved.school?.sources).toHaveLength(2);
  expect(saved.contextRevision).toBe(2);
  const refreshed = await methods.putSchoolSource(
    owner,
    project._id,
    { ...source, markdown: 'Updated material' },
    limits,
  );
  expect(refreshed.ok && refreshed.value.school?.sources).toHaveLength(2);
  expect(
    await methods.putSchoolSource(
      owner,
      project._id,
      { ...source, markdown: 'x'.repeat(1001) },
      limits,
    ),
  ).toEqual({ ok: false, code: 'workspace_context_limit' });
  expect(
    (await methods.listSchoolProjects(owner, 10)).projects[0].school?.sources?.[0].markdown,
  ).toBeUndefined();
  expect(await methods.putSchoolSource(other, project._id, source, limits)).toEqual({
    ok: false,
    code: 'workspace_not_found',
  });
  const removed = await methods.removeSchoolSource(owner, project._id, source.courseId, source.id);
  expect(removed?.school?.sources).toHaveLength(1);
  expect(removed?.contextRevision).toBe(4);
});

it('admits context to older projects whose stored records have no revision field', async () => {
  const project = (await methods.createSchoolProject(owner, 'Older project'))!;
  await mongoose.models.ChatProject.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(project._id) },
    { $unset: { contextRevision: '' } },
  );
  const result = await methods.putSchoolSource(owner, project._id, source, limits);
  expect(result.ok).toBe(true);
  expect(result.ok && result.value.contextRevision).toBe(1);
});

it('grants only named same-institution viewers and revokes access immediately', async () => {
  const viewer = await mongoose.models.User.create({
    email: 'viewer@example.org',
    name: 'Viewer',
    tenantId: owner.tenantId,
  });
  await mongoose.models.User.create({ email: 'outsider@example.org', tenantId: 'school-b' });
  const id = (await methods.createSchoolChat(owner, {
    title: 'Study',
    preset: { endpoint: 'openAI' },
  }))!;
  expect(await methods.findSchoolLiveConversation(other, id)).toBeNull();
  expect(await methods.grantSchoolViewer(owner, id, 'outsider@example.org', 20)).toBe(false);
  expect(await methods.grantSchoolViewer(other, id, viewer.email, 20)).toBe(false);
  expect(await methods.grantSchoolViewer(owner, id, viewer.email, 20)).toBe(true);
  const recipient = { user: String(viewer._id), tenantId: owner.tenantId };
  expect(await methods.findSchoolLiveConversation(recipient, id)).toMatchObject({ title: 'Study' });
  expect(await methods.getSchoolViewers(recipient, id)).toBeNull();
  await mongoose.models.Conversation.updateOne(
    { conversationId: id },
    { $set: { title: 'Latest title' } },
  );
  expect(await methods.findSchoolLiveConversation(recipient, id)).toMatchObject({
    title: 'Latest title',
  });
  expect((await methods.getSchoolViewers(owner, id))?.[0]).toMatchObject({ email: viewer.email });
  await methods.revokeSchoolViewer(owner, id, recipient.user);
  expect(await methods.findSchoolLiveConversation(recipient, id)).toBeNull();
});

it('preserves the configured helper and agent settings when admitting assignment context', async () => {
  const id = await methods.createSchoolChat(owner, {
    title: 'Essay',
    context: 'Assignment material',
    preset: {
      endpoint: 'agents',
      agent_id: 'agent-1',
      promptPrefix: 'Offer hints before answers.',
      temperature: 0.4,
      spec: 'study-coach',
    },
  });
  const saved = await mongoose.models.Conversation.findOne({ conversationId: id }).lean<{
    promptPrefix?: string;
  }>();
  expect(saved).toMatchObject({ agent_id: 'agent-1', temperature: 0.4, spec: 'study-coach' });
  expect(saved?.promptPrefix).toContain('Offer hints before answers.');
  expect(saved?.promptPrefix).toBe('Offer hints before answers.');
  const messages = await methods.readSchoolMessages(owner, id!, 10, 1000);
  expect(messages).toEqual([
    expect.objectContaining({ text: 'Assignment material', isCreatedByUser: true }),
  ]);
});

it('removes folder preferences and named viewer grants when an account is deleted', async () => {
  const viewer = await mongoose.models.User.create({
    email: 'deleted@example.org',
    tenantId: owner.tenantId,
  });
  const recipient = { user: String(viewer._id), tenantId: owner.tenantId };
  await methods.setSchoolChoice(recipient, scope, 'allowed');
  const id = (await methods.createSchoolChat(owner, {
    title: 'Study',
    preset: { endpoint: 'openAI' },
  }))!;
  await methods.grantSchoolViewer(owner, id, viewer.email, 20);
  await createUserMethods(mongoose).deleteUserById(recipient.user);
  expect(await methods.getSchoolChoice(recipient, scope)).toBe('undecided');
  expect(await methods.getSchoolViewers(owner, id)).toEqual([]);
  const saved = await mongoose.models.Conversation.findOne({ conversationId: id })
    .select('+schoolViewers')
    .lean<{ schoolViewers?: string[] }>();
  expect(saved?.schoolViewers).toEqual([]);
});

it('projects bounded public text, excluding files, reasoning, tools and expired messages', async () => {
  const conversationId = (await methods.createSchoolChat(owner, {
    title: 'Study',
    preset: { endpoint: 'openAI' },
  }))!;
  await mongoose.models.Message.create({
    ...owner,
    conversationId,
    messageId: 'a',
    text: '',
    content: [
      { type: 'text', text: 'Visible answer' },
      { type: 'think', think: 'PRIVATE_REASONING' },
      { type: 'tool_call', tool_call: { id: 'tool', name: 'secret', args: 'PRIVATE_TOOL' } },
    ],
    privateText: 'PRIVATE_ENVELOPE',
    files: [{ file_id: 'private-file' }],
  });
  await mongoose.models.Message.create({
    ...owner,
    conversationId,
    messageId: 'expired',
    text: 'EXPIRED',
    expiredAt: new Date(0),
  });
  await mongoose.models.Message.create({
    ...other,
    conversationId,
    messageId: 'foreign',
    text: 'FOREIGN',
  });
  const rows = await methods.readSchoolMessages(owner, conversationId, 10, 100);
  expect(rows).toEqual([{ messageId: 'a', text: 'Visible answer', isCreatedByUser: false }]);
  expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|private-file|EXPIRED|FOREIGN/);
  await mongoose.models.Message.updateOne({ messageId: 'a' }, { $set: { text: 'Changed answer' } });
  expect((await methods.readSchoolMessages(owner, conversationId, 1, 7))[0].text).toBe('Changed');
});
