import { z } from 'zod';
import express from 'express';
import { createChatExpirationDate, createFallbackRetentionDate } from '@librechat/data-schemas';
import {
  resolveSchoolConfig,
  tModelSpecPresetSchema,
  messageFilterPiiSchema,
} from 'librechat-data-provider';
import type { SchoolWorkspace, SchoolSource, SchoolLiveView } from 'librechat-data-provider';
import type { SchoolOwner, SchoolMethods } from '@librechat/data-schemas';
import type { Request, Response, RequestHandler, Router } from 'express';
import type { SchoolConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { SchoolDependencies } from './types';
import type { ServerRequest } from '~/types';
import { resolveImportRetentionFields } from '../conversations/retention';
import { canvasOrigin, CanvasError, createCanvasClient } from './canvas';
import { createShareContentPreflight } from '../shared-links/protection';
import { assertConversationImportContentAllowed } from '../imports';
import { isContentFilterError } from '../middleware/contentFilter';
import { PRIVATE_MODEL_SPEC_PRESET_FIELDS } from '../modelSpecs';
import { getAppConfigOptionsFromUser } from '~/app/service';
import { inspectSchoolDocument } from './documents/policy';
import { DocumentReadError } from './documents/types';
import { readCanvasConnection } from './connection';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const chatId = z.string().uuid();
const selection = z.object({ courseId: z.string().regex(/^\d+$/), id: z.string().regex(/^\d+$/) });

export function schoolViewersEnabled(
  school: SchoolConfig,
  config: AppConfig,
  hasSharingAccess: boolean,
): boolean {
  const sharing = config.interfaceConfig?.sharedLinks;
  return (
    school.workspace.enabled &&
    school.workspace.viewersEnabled &&
    hasSharingAccess &&
    sharing !== false &&
    !(typeof sharing === 'object' && sharing?.create === false)
  );
}

export function createSchoolWorkspaceRouter(
  deps: SchoolDependencies & { workspaceStore: SchoolMethods },
): Router {
  const router = express.Router();
  const store = deps.workspaceStore;
  const handle =
    (run: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    (req, res) => {
      res.set('Cache-Control', 'no-store');
      void run(req, res).catch((error) => {
        if (error instanceof DocumentReadError) {
          res.status(403).json({ code: error.code });
          return;
        }
        if (isContentFilterError(error)) {
          res.status(403).json({ code: 'workspace_content_blocked' });
          return;
        }
        const safe = error instanceof CanvasError;
        res
          .status(safe ? error.status : 503)
          .json({ code: safe ? error.code : 'workspace_unavailable' });
      });
    };
  async function access(req: Request) {
    const user = (req as ServerRequest).user;
    if (!user?.id) throw new CanvasError('canvas_unauthorized', 401);
    const config = await deps.getAppConfig({
      ...getAppConfigOptionsFromUser(user),
      failClosed: true,
    });
    const school = resolveSchoolConfig(config.interfaceConfig?.school);
    if (!school?.enabled || !school.workspace.enabled)
      throw new CanvasError('school_disabled', 403);
    const owner: SchoolOwner = {
      user: user.id,
      ...(user.tenantId ? { tenantId: user.tenantId } : {}),
    };
    return { owner, config, school, settings: school.workspace };
  }
  async function canvas(context: Awaited<ReturnType<typeof access>>) {
    const baseUrl = context.school.canvas.baseUrl;
    const origin = baseUrl ? canvasOrigin(baseUrl) : 'unconfigured';
    const token =
      context.school.canvas.enabled && baseUrl
        ? await readCanvasConnection({ userId: context.owner.user, origin, ...deps })
        : null;
    if (!token) return { origin, scope: origin, client: null };
    const client = createCanvasClient({
      baseUrl: origin,
      token,
      settings: context.school.canvas,
      fetchFn: deps.fetchFn,
    });
    const account = await client.verify();
    return { origin, scope: `${origin}/${account}`, client };
  }
  async function sharedAccess(req: Request) {
    const context = await access(req);
    if (!schoolViewersEnabled(context.school, context.config, Boolean(deps.requireSharingAccess)))
      throw new CanvasError('school_disabled', 403);
    return context;
  }
  const requireSharingAccess: RequestHandler =
    deps.requireSharingAccess ??
    ((_req, res) => {
      res.sendStatus(403);
    });
  async function source(
    context: Awaited<ReturnType<typeof access>>,
    input: z.infer<typeof selection>,
  ): Promise<SchoolSource> {
    const connected = await canvas(context);
    if (!connected.client) throw new CanvasError('canvas_not_connected', 409);
    const data = await connected.client.context([{ ...input, kind: 'assignment' }]);
    inspectSchoolDocument('Canvas assignment', data.markdown, context.config.filters);
    await assertConversationImportContentAllowed(
      context.config.filters,
      {
        conversations: [],
        messages: [{ text: data.markdown, isCreatedByUser: true }],
      },
      {
        legacyPii: context.config.messageFilter?.pii
          ? messageFilterPiiSchema.parse(context.config.messageFilter.pii)
          : undefined,
      },
    );
    return {
      ...input,
      title: data.sources[0]?.title ?? input.id,
      url: `${connected.origin}/courses/${input.courseId}/assignments/${input.id}`,
      markdown: data.markdown,
      retrievedAt: new Date().toISOString(),
    };
  }
  router.get(
    '/',
    handle(async (req, res) => {
      const context = await access(req);
      const { owner, settings } = context;
      let connected: Awaited<ReturnType<typeof canvas>>;
      let connectionFailed = false;
      try {
        connected = await canvas(context);
      } catch (error) {
        if (!(error instanceof CanvasError)) throw error;
        const origin = context.school.canvas.baseUrl
          ? canvasOrigin(context.school.canvas.baseUrl)
          : 'unconfigured';
        connected = { origin, scope: origin, client: null };
        connectionFailed = true;
      }
      let choice: SchoolWorkspace['choice'] = 'unavailable';
      if (!connectionFailed) {
        choice = connected.client
          ? await store.bindSchoolChoice(owner, connected.scope, connected.origin)
          : await store.getSchoolChoice(owner, connected.scope);
      }
      const response: SchoolWorkspace = {
        choice,
        ...(connectionFailed ? { assignmentsError: 'workspace_unavailable' } : {}),
        projects: [],
        courses: [],
        truncated: false,
        connected: connected.client !== null,
        assignments: [],
        retrievedAt: new Date().toISOString(),
        timeZone: context.school.timeZone,
        settings: { refreshMs: settings.refreshMs, viewerRefreshMs: settings.viewerRefreshMs },
      };
      if (connected.client) {
        try {
          const courses = await connected.client.courses();
          const admitted = courses.items.slice(0, settings.maxCourses);
          response.truncated = courses.truncated || admitted.length < courses.items.length;
          if (choice === 'allowed') await store.syncSchoolCourses(owner, connected.scope, admitted);
          // Bounded batches avoid serial per-assignment reads.
          for (let index = 0; index < admitted.length; index += settings.courseConcurrency) {
            const pages = await Promise.allSettled(
              admitted.slice(index, index + settings.courseConcurrency).map(async (course) => ({
                course,
                result: await connected.client!.materials(course.id, 'assignment'),
              })),
            );
            for (const page of pages) {
              if (page.status === 'rejected') {
                response.assignmentsError = 'workspace_partial';
                continue;
              }
              const { course, result } = page.value;
              response.truncated ||= result.truncated;
              response.assignments.push(
                ...result.items.map((item) => ({
                  ...item,
                  courseId: course.id,
                  course: course.name,
                })),
              );
            }
          }
          const now = Date.now();
          response.assignments = response.assignments
            .filter((item) => item.dueAt && new Date(item.dueAt).getTime() >= now)
            .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
          response.truncated ||= response.assignments.length > settings.maxAssignments;
          response.assignments = response.assignments.slice(0, settings.maxAssignments);
        } catch {
          response.assignmentsError = 'workspace_unavailable';
        }
      }
      const listedCourses = await store.listSchoolCourses(
        owner,
        settings.maxCourses,
        connected.client ? connected.scope : undefined,
      );
      response.courses = listedCourses.courses;
      response.truncated ||= listedCourses.truncated;
      const listed = await store.listSchoolProjects(owner, settings.maxProjects);
      response.projects = listed.projects;
      response.truncated ||= listed.truncated;
      res.json(response);
    }),
  );
  router.get(
    '/courses/:id',
    handle(async (req, res) => {
      const context = await access(req);
      if (!objectId.safeParse(req.params.id).success) {
        res.status(400).json({ code: 'workspace_invalid' });
        return;
      }
      const course = await store.getSchoolCourse(context.owner, String(req.params.id));
      if (!course) {
        res.sendStatus(404);
        return;
      }
      res.json(course);
    }),
  );
  router.get(
    '/courses/:id/chats',
    handle(async (req, res) => {
      const context = await access(req);
      const input = z
        .object({ id: objectId, cursor: objectId.optional() })
        .safeParse({ id: req.params.id, cursor: req.query.cursor });
      if (!input.success) {
        res.status(400).json({ code: 'workspace_invalid' });
        return;
      }
      const result = await store.listSchoolCourseChats(
        context.owner,
        input.data.id,
        context.settings.courseChatPageSize,
        input.data.cursor,
      );
      if (!result) {
        res.sendStatus(404);
        return;
      }
      res.json(result);
    }),
  );
  router.put(
    '/choice',
    handle(async (req, res) => {
      const context = await access(req);
      const input = z
        .object({ choice: z.enum(['allowed', 'denied']) })
        .strict()
        .safeParse(req.body);
      if (!input.success) {
        res.status(400).json({ code: 'workspace_invalid' });
        return;
      }
      const connected = await canvas(context);
      await store.setSchoolChoice(context.owner, connected.scope, input.data.choice);
      res.json({ choice: input.data.choice });
    }),
  );
  router.post(
    '/projects',
    handle(async (req, res) => {
      const context = await access(req);
      const parsed = z
        .object({ name: z.string().trim().min(1).max(100), homeId: objectId.optional() })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: 'workspace_invalid' });
        return;
      }
      const listed = await store.listSchoolProjects(context.owner, context.settings.maxProjects);
      if (listed.projects.length >= context.settings.maxProjects) {
        res.status(409).json({ code: 'workspace_limit' });
        return;
      }
      const project = await store.createSchoolProject(
        context.owner,
        parsed.data.name,
        parsed.data.homeId,
      );
      if (!project) {
        res.sendStatus(404);
        return;
      }
      res.status(201).json(project);
    }),
  );
  router.post(
    '/projects/:id/sources',
    handle(async (req, res) => {
      const context = await access(req);
      const id = objectId.safeParse(req.params.id);
      const input = selection.strict().safeParse(req.body);
      if (!id.success || !input.success) {
        res.status(400).json({ code: 'workspace_invalid' });
        return;
      }
      const project = await store.getSchoolProject(context.owner, id.data);
      if (!project || project.school?.kind === 'course') {
        res.sendStatus(404);
        return;
      }
      const imported = await source(context, input.data);
      const result = await store.putSchoolSource(
        context.owner,
        id.data,
        imported,
        context.settings,
      );
      if (!result.ok) {
        res.status(409).json({ code: result.code });
        return;
      }
      res.json(result.value);
    }),
  );
  router.delete(
    '/projects/:id/sources/:courseId/:assignmentId',
    handle(async (req, res) => {
      const context = await access(req);
      const input = z
        .object({
          id: objectId,
          courseId: z.string().regex(/^\d+$/),
          assignmentId: z.string().regex(/^\d+$/),
        })
        .safeParse(req.params);
      if (!input.success) {
        res.sendStatus(400);
        return;
      }
      const project = await store.removeSchoolSource(
        context.owner,
        input.data.id,
        input.data.courseId,
        input.data.assignmentId,
      );
      if (!project) {
        res.sendStatus(404);
        return;
      }
      res.json(project);
    }),
  );
  router.post(
    '/chats',
    handle(async (req, res) => {
      const context = await access(req);
      const input = z
        .object({
          projectId: objectId.optional(),
          schoolCourseId: objectId.optional(),
          assignment: selection.optional(),
        })
        .strict()
        .safeParse(req.body);
      if (!input.success) {
        res.status(400).json({ code: 'workspace_invalid' });
        return;
      }
      if (
        input.data.projectId &&
        !(await store.getSchoolProject(context.owner, input.data.projectId))
      ) {
        res.sendStatus(404);
        return;
      }
      if (input.data.schoolCourseId) {
        if (input.data.projectId) {
          res.status(400).json({ code: 'workspace_invalid' });
          return;
        }
        const course = await store.getSchoolCourse(context.owner, input.data.schoolCourseId);
        if (
          !course ||
          (input.data.assignment && input.data.assignment.courseId !== course.canvasCourseId)
        ) {
          res.sendStatus(404);
          return;
        }
      }
      const material = input.data.assignment ? await source(context, input.data.assignment) : null;
      const spec =
        context.config.modelSpecs?.list?.find((item) => item.default) ??
        context.config.modelSpecs?.list?.[0];
      const configured = spec?.preset ? tModelSpecPresetSchema.parse(spec.preset) : undefined;
      // These fields are applied by the model-spec boundary on each turn and
      // must not become user-visible conversation preferences.
      if (configured) {
        for (const field of PRIVATE_MODEL_SPEC_PRESET_FIELDS) delete configured[field];
      }
      const preset = {
        ...configured,
        endpoint: configured?.endpoint ?? (configured?.agent_id ? 'agents' : 'openAI'),
        spec: spec?.name,
      };
      const conversationId = await store.createSchoolChat(context.owner, {
        title: material?.title ?? 'New Chat',
        projectId: input.data.projectId,
        schoolCourseId: input.data.schoolCourseId,
        context: material?.markdown,
        preset,
        retention: preset.isTemporary
          ? {
              isTemporary: true,
              expiredAt: createChatExpirationDate(context.config.interfaceConfig, true),
            }
          : resolveImportRetentionFields(context.config.interfaceConfig, {
              createChatExpirationDate,
              createFallbackRetentionDate,
            }),
      });
      if (!conversationId) {
        res.sendStatus(404);
        return;
      }
      res.status(201).json({ conversationId });
    }),
  );
  router.get(
    '/chats/:id/viewers',
    handle(async (req, res) => {
      const context = await sharedAccess(req);
      if (!chatId.safeParse(req.params.id).success) {
        res.sendStatus(400);
        return;
      }
      const viewers = await store.getSchoolViewers(context.owner, String(req.params.id));
      if (!viewers) {
        res.sendStatus(404);
        return;
      }
      res.json(viewers);
    }),
  );
  router.post(
    '/chats/:id/viewers',
    requireSharingAccess,
    handle(async (req, res) => {
      const context = await sharedAccess(req);
      const input = z
        .object({ email: z.string().trim().toLowerCase().email().max(254) })
        .strict()
        .safeParse(req.body);
      if (!input.success || !chatId.safeParse(req.params.id).success) {
        res.sendStatus(400);
        return;
      }
      if ((await store.getSchoolViewers(context.owner, String(req.params.id))) === null) {
        res.sendStatus(404);
        return;
      }
      const added = await store.grantSchoolViewer(
        context.owner,
        String(req.params.id),
        input.data.email,
        context.settings.maxViewers,
      );
      if (!added) {
        res.status(409).json({ code: 'workspace_viewer_unavailable' });
        return;
      }
      res.json({ ok: true });
    }),
  );
  router.delete(
    '/chats/:id/viewers/:viewer',
    handle(async (req, res) => {
      const context = await access(req);
      if (
        !chatId.safeParse(req.params.id).success ||
        !objectId.safeParse(req.params.viewer).success
      ) {
        res.sendStatus(400);
        return;
      }
      const removed = await store.revokeSchoolViewer(
        context.owner,
        String(req.params.id),
        String(req.params.viewer),
      );
      res.sendStatus(removed ? 204 : 404);
    }),
  );
  router.get(
    '/view/:id',
    handle(async (req, res) => {
      const context = await sharedAccess(req);
      if (!chatId.safeParse(req.params.id).success) {
        res.sendStatus(400);
        return;
      }
      const convo = await store.findSchoolLiveConversation(context.owner, String(req.params.id));
      if (!convo) {
        res.sendStatus(404);
        return;
      }
      const rows = await store.readSchoolMessages(
        { ...context.owner, user: convo.user },
        convo.conversationId,
        context.settings.maxViewMessages + 1,
        context.settings.maxContextChars,
      );
      // Follow the latest saved branch so edited questions and regenerated answers
      // do not appear as several conversations interleaved in the viewer.
      const byId = new Map(rows.map((row) => [row.messageId, row]));
      const branch: typeof rows = [];
      const seen = new Set<string>();
      let current: (typeof rows)[number] | undefined = rows[0];
      while (current && !seen.has(current.messageId)) {
        branch.push(current);
        seen.add(current.messageId);
        current = current.parentMessageId ? byId.get(current.parentMessageId) : undefined;
      }
      let remaining = context.settings.maxViewChars;
      let clipped = false;
      const messages = branch
        .slice(0, context.settings.maxViewMessages)
        .map((row) => {
          const text = (row.text ?? '').slice(0, Math.max(0, remaining));
          remaining -= text.length;
          clipped ||=
            text.length < (row.text?.length ?? 0) ||
            text.length >= context.settings.maxContextChars;
          return {
            messageId: row.messageId,
            parentMessageId: row.parentMessageId,
            sender: row.sender,
            isCreatedByUser: row.isCreatedByUser,
            text,
          };
        })
        .filter((row) => row.text !== '')
        .reverse();
      const result: SchoolLiveView = {
        title: convo.title,
        truncated: rows.length > context.settings.maxViewMessages || clipped,
        refreshMs: context.settings.viewerRefreshMs,
        messages,
      };
      const inspectSharing = createShareContentPreflight(context.config.filters, {
        snapshotFiles: false,
        legacyPii: context.config.messageFilter?.pii
          ? messageFilterPiiSchema.parse(context.config.messageFilter.pii)
          : undefined,
      });
      await inspectSharing?.({
        title: result.title,
        messages: result.messages.map(({ text, isCreatedByUser }) => ({ text, isCreatedByUser })),
      });
      // Recheck after reading so a concurrent revocation withholds the response.
      if (!(await store.findSchoolLiveConversation(context.owner, convo.conversationId))) {
        res.sendStatus(404);
        return;
      }
      res.json(result);
    }),
  );
  return router;
}
