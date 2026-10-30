import '~/mcp/registry/__tests__/helpers/setupCredsEnv';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMethods, createModels } from '@librechat/data-schemas';
import { resolveSchoolConfig, CANVAS_TOOL_NAME } from 'librechat-data-provider';
import type { AllMethods, AppConfig } from '@librechat/data-schemas';
import { createSchoolDocumentTransport } from './documents/download';
import { createCanvasTool, canvasToolDefinition } from './tools';
import { encryptCredential, decryptCredential } from '~/crypto';
import { canvasAuthField, canvasPluginKey } from './connection';
import { loadToolDefinitions } from '~/tools/definitions';
import { makePdf } from './documents/__fixtures__/pdf';
import { readSchoolDocument } from './documents/read';
import { loadEphemeralAgent } from '~/agents/load';

let mongo: MongoMemoryServer;
let store: AllMethods;
const owner = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  role: 'USER',
  tenantId: 'school-a',
  idOnTheSource: 'student-1',
};
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: ['--nounixsocket'] } });
  createModels(mongoose);
  await mongoose.connect(mongo.getUri());
  store = createMethods(mongoose);
});
afterEach(async () => {
  await mongoose.models.PluginAuth.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function fixture() {
  const school = resolveSchoolConfig({
    enabled: true,
    timeZone: 'America/Los_Angeles',
    canvas: { enabled: true, toolCalling: true, baseUrl: 'https://school.instructure.com' },
  })!;
  const config = {
    interfaceConfig: { school },
    modelSpecs: { list: [{ name: 'study-coach', canvas: true }] },
  } as AppConfig;
  const fetchFn = jest
    .fn<Promise<Response>, [string, RequestInit]>()
    .mockImplementation(async (url, options) => {
      expect(options.method).toBe('GET');
      const path = new URL(url).pathname;
      const responses: Record<string, object> = {
        '/api/v1/courses': [{ id: 2, name: 'Calculus', course_code: 'CALC' }],
        '/api/v1/courses/2/assignments': [
          {
            id: 7,
            name: 'Integration practice',
            due_at: '2026-10-29T18:00:00Z',
            submission: { score: 90, body: 'private submission' },
          },
        ],
        '/api/v1/courses/2/assignments/7': {
          id: 7,
          name: 'Integration practice',
          description: '<p>Explain your method.</p>',
          rubric: [{ description: 'Reasoning', points: 5 }],
        },
        '/api/v1/courses/2/pages': [{ url: 'integrals', title: 'Integrals' }],
        '/api/v1/courses/2/pages/integrals': {
          url: 'integrals',
          title: 'Integrals',
          body: '<p>Reference page</p>',
        },
      };
      return new Response(JSON.stringify(responses[path] ?? {}));
    });
  await store.updatePluginAuth({
    userId: owner.id,
    authField: canvasAuthField,
    pluginKey: canvasPluginKey,
    value: await encryptCredential(
      JSON.stringify({ origin: 'https://school.instructure.com', token: 'owner-secret' }),
    ),
  });
  const getAppConfig = jest.fn(async () => config);
  const deps = {
    readDocument: readSchoolDocument,
    createDocumentTransport: createSchoolDocumentTransport,
    getAppConfig,
    store,
    decrypt: decryptCredential,
    fetchFn,
    now: () => new Date('2026-10-29T05:00:00Z'),
  };
  const tool = createCanvasTool({ user: owner, deps });
  return { school, config, fetchFn, getAppConfig, deps, tool };
}

it('registers the native tool on a configured helper and can resolve courses, assignments, and rubric', async () => {
  const { config, school, tool, getAppConfig, fetchFn } = await fixture();
  const agent = await loadEphemeralAgent(
    { req: { user: owner, config }, spec: 'study-coach', endpoint: 'openAI' },
    { getAgent: async () => null, getMCPServerTools: async () => null },
  );
  expect(agent?.tools).toContain(CANVAS_TOOL_NAME);
  const definitions = await loadToolDefinitions(
    { userId: owner.id, agentId: agent!.id, tools: agent!.tools!, school },
    { isBuiltInTool: () => false, getOrFetchMCPServerTools: async () => null },
  );
  expect(definitions.toolRegistry.has(CANVAS_TOOL_NAME)).toBe(true);
  expect(definitions.toolRegistry.get(CANVAS_TOOL_NAME)?.parameters).toMatchObject({
    type: 'object',
    required: ['operation'],
    additionalProperties: false,
    properties: {
      operation: {
        enum: [
          'list_courses',
          'list_assignments',
          'list_pages',
          'read_material',
          'list_files',
          'read_file',
        ],
      },
    },
  });
  expect(definitions.toolDefinitions[0]).toMatchObject({
    name: CANVAS_TOOL_NAME,
    description: canvasToolDefinition.description,
  });
  const courses = JSON.parse(await tool.invoke({ operation: 'list_courses' }));
  expect(courses).toMatchObject({
    ok: true,
    currentDate: '2026-10-28',
    timeZone: 'America/Los_Angeles',
    value: {
      items: [{ id: '2', name: 'Calculus', url: 'https://school.instructure.com/courses/2' }],
    },
  });
  const assignments = await tool.invoke({ operation: 'list_assignments', course_id: '2' });
  expect(JSON.parse(assignments).value.items[0]).toMatchObject({
    id: '7',
    dueAt: '2026-10-29T18:00:00Z',
  });
  expect(assignments).not.toMatch(/private submission|score|owner-secret/);
  const material = await tool.invoke({
    operation: 'read_material',
    course_id: '2',
    material_id: '7',
    kind: 'assignment',
  });
  expect(material).toContain('Explain your method.');
  expect(material).toContain('Reasoning (5 points)');
  expect(material).toContain('https://school.instructure.com/courses/2/assignments/7');
  expect(getAppConfig).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: owner.id,
      role: 'USER',
      tenantId: 'school-a',
      idOnTheSource: 'student-1',
      failClosed: true,
    }),
  );
  expect(fetchFn).toHaveBeenCalledTimes(3);
});

it('uses only the executing user’s credential and rechecks disconnects between calls', async () => {
  const { deps, tool, fetchFn } = await fixture();
  const other = createCanvasTool({ user: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'USER' }, deps });
  expect(JSON.parse(await other.invoke({ operation: 'list_courses' }))).toEqual({
    ok: false,
    error: { code: 'canvas_not_connected' },
  });
  expect(fetchFn).not.toHaveBeenCalled();
  await tool.invoke({ operation: 'list_courses' });
  await store.deletePluginAuth({ userId: owner.id, pluginKey: canvasPluginKey, all: true });
  expect(JSON.parse(await tool.invoke({ operation: 'list_courses' })).error.code).toBe(
    'canvas_not_connected',
  );
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

it('fails closed on disabled policy, changed origins, and unresolved profile policy', async () => {
  const { tool, school, deps, fetchFn, getAppConfig } = await fixture();
  school.canvas.toolCalling = false;
  const definitions = await loadToolDefinitions(
    { userId: owner.id, agentId: 'helper', tools: ['canvas'], school },
    { isBuiltInTool: () => true, getOrFetchMCPServerTools: async () => null },
  );
  expect(definitions.toolDefinitions).toEqual([]);
  expect(JSON.parse(await tool.invoke({ operation: 'list_courses' })).error.code).toBe(
    'school_disabled',
  );
  school.canvas.toolCalling = true;
  school.canvas.baseUrl = 'https://other.instructure.com';
  expect(JSON.parse(await tool.invoke({ operation: 'list_courses' })).error.code).toBe(
    'canvas_not_connected',
  );
  getAppConfig.mockRejectedValue(new Error('private database diagnostic'));
  const failed = await createCanvasTool({ user: owner, deps }).invoke({
    operation: 'list_courses',
  });
  expect(JSON.parse(failed)).toEqual({ ok: false, error: { code: 'school_request_failed' } });
  expect(failed).not.toMatch(/private|owner-secret/);
  expect(fetchFn).not.toHaveBeenCalled();
});

it('validates model inputs without accepting identities, destinations, writes, or traversal', async () => {
  const { tool, fetchFn } = await fixture();
  await expect(tool.invoke({ operation: 'submit_assignment' } as never)).rejects.toThrow();
  await expect(
    tool.invoke({ operation: 'list_courses', userId: 'other', url: 'https://attacker.example' }),
  ).rejects.toThrow();
  expect(JSON.parse(await tool.invoke({ operation: 'list_assignments' })).error.code).toBe(
    'canvas_invalid_request',
  );
  expect(
    JSON.parse(
      await tool.invoke({
        operation: 'read_material',
        course_id: '2',
        material_id: '../users',
        kind: 'page',
      }),
    ).error.code,
  ).toBe('canvas_invalid_request');
  expect(fetchFn).not.toHaveBeenCalled();
});

it('keeps provider diagnostics out of results and propagates cancellation', async () => {
  const { tool, deps, fetchFn } = await fixture();
  fetchFn.mockResolvedValue(new Response('private token and provider body', { status: 401 }));
  expect(JSON.parse(await tool.invoke({ operation: 'list_courses' }))).toEqual({
    ok: false,
    error: { code: 'canvas_unauthorized' },
  });
  fetchFn.mockClear();
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(
    createCanvasTool({ user: owner, deps, signal: controller.signal }).invoke({
      operation: 'list_courses',
    }),
  ).rejects.toThrow('cancelled');
  expect(fetchFn).not.toHaveBeenCalled();
});

it('lists and reads pages through the same bounded native tool', async () => {
  const { tool } = await fixture();
  const pages = JSON.parse(await tool.invoke({ operation: 'list_pages', course_id: '2' }));
  expect(pages.value.items[0]).toMatchObject({ id: 'integrals', kind: 'page' });
  const page = await tool.invoke({
    operation: 'read_material',
    course_id: '2',
    material_id: 'integrals',
    kind: 'page',
  });
  expect(page).toContain('Reference page');
  expect(page).toContain('https://school.instructure.com/courses/2/pages/integrals');
});

it('bounds list output before sending it to the model', async () => {
  const { school, tool, fetchFn } = await fixture();
  school.canvas.maxContextChars = 1000;
  fetchFn.mockResolvedValue(new Response(JSON.stringify([{ id: 2, name: 'x'.repeat(2000) }])));
  expect(JSON.parse(await tool.invoke({ operation: 'list_courses' }))).toEqual({
    ok: false,
    error: { code: 'canvas_too_large' },
  });
});

it('honors the institution tool allowlist and blocklist at definition and execution time', async () => {
  const { config, school, tool, fetchFn } = await fixture();
  config.includedTools = ['calculator'];
  let definitions = await loadToolDefinitions(
    {
      userId: owner.id,
      agentId: 'helper',
      tools: ['canvas'],
      school,
      includedTools: config.includedTools,
    },
    { isBuiltInTool: () => true, getOrFetchMCPServerTools: async () => null },
  );
  expect(definitions.toolDefinitions).toEqual([]);
  expect(JSON.parse(await tool.invoke({ operation: 'list_courses' })).error.code).toBe(
    'school_disabled',
  );
  config.includedTools = [];
  config.filteredTools = ['canvas'];
  definitions = await loadToolDefinitions(
    {
      userId: owner.id,
      agentId: 'helper',
      tools: ['canvas'],
      school,
      filteredTools: config.filteredTools,
    },
    { isBuiltInTool: () => true, getOrFetchMCPServerTools: async () => null },
  );
  expect(definitions.toolDefinitions).toEqual([]);
  expect(JSON.parse(await tool.invoke({ operation: 'list_courses' })).error.code).toBe(
    'school_disabled',
  );
  expect(fetchFn).not.toHaveBeenCalled();
});

it('reads a Canvas-linked PDF through the real native tool and bounded parser', async () => {
  const { tool: _tool, deps, school, fetchFn } = await fixture();
  school.documents.enabled = true;
  fetchFn.mockImplementation(async (url) => {
    if (url.endsWith('/files/9'))
      return new Response(
        JSON.stringify({
          id: 9,
          filename: 'worksheet.pdf',
          display_name: 'worksheet.pdf',
          'content-type': 'application/pdf',
          size: 1000,
        }),
      );
    return new Response(
      JSON.stringify({
        id: 7,
        name: 'Worksheet',
        description:
          '<a href="/courses/2/files/9/download?verifier=PRIVATE">Read the worksheet</a>',
      }),
    );
  });
  const download = jest.fn(
    async () =>
      new Response(
        new Uint8Array(makePdf(['Compare the two sources and explain your conclusion.'])),
      ),
  );
  const native = createCanvasTool({
    user: owner,
    deps: {
      ...deps,
      createDocumentTransport: () => ({ fetchFn: download, close: async () => undefined }),
    },
  });
  const context = JSON.parse(
    await native.invoke({
      operation: 'read_material',
      course_id: '2',
      material_id: '7',
      kind: 'assignment',
    }),
  );
  expect(context.value.linkedFiles[0]).toMatchObject({ courseId: '2', fileId: '9' });
  const read = JSON.parse(
    await native.invoke({
      operation: 'read_file',
      course_id: '2',
      file_id: '9',
      start_page: 1,
      end_page: 1,
    }),
  );
  expect(read).toMatchObject({
    ok: true,
    value: {
      source: 'https://school.instructure.com/courses/2/files/9',
      format: 'pdf',
      pageCount: 1,
    },
  });
  expect(read.value.text).toContain('[Page 1]\nCompare the two sources');
  expect(JSON.stringify(read)).not.toMatch(/PRIVATE|verifier|owner-secret/);
});
