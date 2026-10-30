import '~/mcp/registry/__tests__/helpers/setupCredsEnv';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { createReadStream } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMethods, createModels } from '@librechat/data-schemas';
import { resolveSchoolConfig, FileSources, DOCUMENT_TOOL_NAME } from 'librechat-data-provider';
import type { AppConfig, AllMethods } from '@librechat/data-schemas';
import { createSchoolDocumentTool, addSchoolDocumentResources } from './tool';
import { loadToolDefinitions } from '~/tools/definitions';
import { makePdf } from './__fixtures__/pdf';
import { readSchoolDocument } from './read';

let mongo: MongoMemoryServer;
let store: AllMethods;
let folder: string;
const owner = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'USER', tenantId: 'school-a' };
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: ['--nounixsocket'] } });
  createModels(mongoose);
  await mongoose.connect(mongo.getUri());
  store = createMethods(mongoose);
  folder = await mkdtemp(path.join(os.tmpdir(), 'document-tool-test-'));
});
afterEach(async () => {
  await mongoose.models.File.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  await rm(folder, { recursive: true, force: true });
});

async function fixture() {
  const source = path.join(folder, 'worksheet.pdf');
  const buffer = makePdf([
    'First page: compare evidence.',
    'Second page: explain your conclusion.',
  ]);
  await writeFile(source, buffer);
  await mongoose.models.File.create({
    user: owner.id,
    tenantId: owner.tenantId,
    file_id: 'file-a',
    filename: 'worksheet.pdf',
    filepath: source,
    bytes: buffer.length,
    type: 'application/pdf',
    source: FileSources.local,
    llmDeliveryPath: 'text',
  });
  const school = resolveSchoolConfig({ enabled: true, documents: { enabled: true } })!;
  const config = { interfaceConfig: { school } } as AppConfig;
  const getStream = jest.fn(async (file: { filepath: string }) => createReadStream(file.filepath));
  const deps = {
    getAppConfig: async () => config,
    getFiles: store.getReadableDocumentFiles,
    getStream,
    readDocument: readSchoolDocument,
  };
  const tool = createSchoolDocumentTool({ user: owner, fileIds: ['file-a'], deps });
  return { tool, deps, getStream, config, school };
}
it('lists only safe metadata and reads an attached PDF with real storage and extraction', async () => {
  const { tool } = await fixture();
  const list = await tool.invoke({ operation: 'list' });
  expect(JSON.parse(list)).toMatchObject({
    ok: true,
    value: [{ file_id: 'file-a', filename: 'worksheet.pdf' }],
  });
  expect(list).not.toMatch(/filepath|storageKey|tenant|aaaaaaaa/);
  const result = JSON.parse(
    await tool.invoke({ operation: 'read', file_id: 'file-a', start_page: 2, end_page: 2 }),
  );
  expect(result).toMatchObject({ ok: true, value: { format: 'pdf', startPage: 2, endPage: 2 } });
  expect(result.value.text).toContain('[Page 2]\nSecond page: explain your conclusion.');
});
it('enforces current-context membership, owner, tenant, deletion, and expiry before storage access', async () => {
  const { deps, tool, getStream } = await fixture();
  await mongoose.models.File.create({
    user: owner.id,
    tenantId: 'school-a',
    file_id: 'not-attached',
    filename: 'other.pdf',
    filepath: 'PRIVATE',
    bytes: 10,
    type: 'application/pdf',
  });
  expect(
    JSON.parse(await tool.invoke({ operation: 'read', file_id: 'not-attached' })).error.code,
  ).toBe('document_forbidden');
  const other = createSchoolDocumentTool({
    user: { ...owner, id: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
    fileIds: ['file-a'],
    deps,
  });
  expect(JSON.parse(await other.invoke({ operation: 'list' })).value).toEqual([]);
  const otherTenant = createSchoolDocumentTool({
    user: { ...owner, tenantId: 'school-b' },
    fileIds: ['file-a'],
    deps,
  });
  expect(
    JSON.parse(await otherTenant.invoke({ operation: 'read', file_id: 'file-a' })).error.code,
  ).toBe('document_forbidden');
  await mongoose.models.File.updateOne({ file_id: 'file-a' }, { $set: { expiresAt: new Date(0) } });
  expect(JSON.parse(await tool.invoke({ operation: 'list' })).value).toEqual([]);
  await mongoose.models.File.updateOne(
    { file_id: 'file-a' },
    { $unset: { expiresAt: 1 }, $set: { expiredAt: new Date(0) } },
  );
  expect(JSON.parse(await tool.invoke({ operation: 'list' })).value).toEqual([]);
  await mongoose.models.File.deleteOne({ file_id: 'file-a' });
  expect(JSON.parse(await tool.invoke({ operation: 'read', file_id: 'file-a' })).error.code).toBe(
    'document_forbidden',
  );
  expect(getStream).not.toHaveBeenCalled();
});
it('honors document policy and institution tool filters at definition and execution time', async () => {
  const { config, school, tool, getStream } = await fixture();
  const defs = await loadToolDefinitions(
    { userId: owner.id, agentId: 'helper', tools: [DOCUMENT_TOOL_NAME], school },
    { isBuiltInTool: () => false, getOrFetchMCPServerTools: async () => null },
  );
  expect(defs.toolRegistry.has(DOCUMENT_TOOL_NAME)).toBe(true);
  config.filteredTools = [DOCUMENT_TOOL_NAME];
  expect(JSON.parse(await tool.invoke({ operation: 'read', file_id: 'file-a' })).error.code).toBe(
    'school_disabled',
  );
  config.filteredTools = [];
  school.documents.enabled = false;
  expect(JSON.parse(await tool.invoke({ operation: 'list' })).error.code).toBe('school_disabled');
  expect(getStream).not.toHaveBeenCalled();
});
it('blocks extracted source content under the school’s existing file filters', async () => {
  const { config, tool } = await fixture();
  config.filters = {
    files: {
      pii: {
        fields: ['extracted_text'],
        starterPatterns: [],
        customPatterns: [
          { id: 'source-evidence', label: 'test protected text', regex: 'evidence' },
        ],
      },
    },
  };
  const result = await tool.invoke({ operation: 'read', file_id: 'file-a' });
  expect(JSON.parse(result)).toEqual({ ok: false, error: { code: 'document_blocked' } });
  expect(result).not.toContain('compare evidence');
});
it('does not put a file excluded from model delivery into the document reader scope', () => {
  const resources = addSchoolDocumentResources(
    undefined,
    [
      { file_id: 'included', llmDeliveryPath: 'text' },
      { file_id: 'excluded', llmDeliveryPath: 'none' },
    ] as never,
    [DOCUMENT_TOOL_NAME],
  );
  expect(resources?.context?.file_ids).toEqual(['included']);
});
