import { z } from 'zod';
import express from 'express';
import { logger } from '@librechat/data-schemas';
import { canvasContextRequestSchema, resolveSchoolConfig } from 'librechat-data-provider';
import type { SchoolConfig, SchoolStatus } from 'librechat-data-provider';
import type { Request, Response, RequestHandler, Router } from 'express';
import type { AppConfig } from '@librechat/data-schemas';
import type { GetAppConfigOptions } from '~/app/service';
import type { ServerRequest } from '~/types';
import type { CanvasFetch } from './canvas';
import {
  canvasPluginKey as pluginKey,
  canvasAuthField as authField,
  readCanvasConnection,
} from './connection';
import { CanvasError, canvasOrigin, createCanvasClient } from './canvas';
import { getAppConfigOptionsFromUser } from '~/app/service';

export type SchoolDependencies = {
  getAppConfig: (options: GetAppConfigOptions) => Promise<AppConfig>;
  requireJwtAuth: RequestHandler;
  fetchFn: CanvasFetch;
  encrypt: (value: string, format?: 'v3' | 'legacy') => Promise<string>;
  decrypt: (value: string) => Promise<string>;
  store: {
    findOnePluginAuth: (input: {
      userId: string;
      authField: string;
      pluginKey: string;
    }) => Promise<{ value: string } | null>;
    updatePluginAuth: (input: {
      userId: string;
      authField: string;
      pluginKey: string;
      value: string;
    }) => Promise<{ value: string }>;
    deletePluginAuth: (input: {
      userId: string;
      pluginKey: string;
      all: boolean;
    }) => Promise<{ deletedCount?: number }>;
  };
};

export function createSchoolRouter(deps: SchoolDependencies): Router {
  const router = express.Router();
  router.use(deps.requireJwtAuth);
  async function access(req: Request) {
    const user = (req as ServerRequest).user;
    if (!user?.id) throw new CanvasError('canvas_unauthorized', 401);
    const config = await deps.getAppConfig({
      ...getAppConfigOptionsFromUser(user),
      failClosed: true,
    });
    return { userId: user.id, config, school: resolveSchoolConfig(config.interfaceConfig?.school) };
  }
  async function connection(userId: string, origin: string) {
    return readCanvasConnection({ userId, origin, ...deps });
  }
  function enabled(school: SchoolConfig | undefined): SchoolConfig {
    if (!school?.enabled) throw new CanvasError('school_disabled', 403);
    if (!school.canvas.enabled) throw new CanvasError('canvas_unconfigured', 503);
    return school;
  }
  async function clientFor(req: Request) {
    const context = await access(req);
    const school = enabled(context.school);
    const origin = canvasOrigin(school.canvas.baseUrl);
    const token = await connection(context.userId, origin);
    if (!token) throw new CanvasError('canvas_not_connected', 409);
    return createCanvasClient({
      baseUrl: origin,
      token,
      settings: school.canvas,
      fetchFn: deps.fetchFn,
    });
  }
  function handler(run: (req: Request, res: Response) => Promise<void>): RequestHandler {
    return (req, res) => {
      void run(req, res).catch((error) => {
        if (error instanceof CanvasError) {
          res.status(error.status).json({ code: error.code });
          return;
        }
        logger.error('[school] Request failed', { code: 'school_request_failed' });
        res.status(500).json({ code: 'school_request_failed' });
      });
    };
  }
  async function status(req: Request): Promise<SchoolStatus> {
    const { userId, school } = await access(req);
    if (!school?.enabled)
      return {
        enabled: false,
        name: '',
        guidance: '',
        canvas: { enabled: false, connected: false, toolCalling: false },
      };
    const baseUrl =
      school.canvas.enabled && school.canvas.baseUrl
        ? canvasOrigin(school.canvas.baseUrl)
        : undefined;
    return {
      enabled: true,
      name: school.name,
      guidance: school.guidance,
      canvas: {
        enabled: school.canvas.enabled,
        toolCalling: school.canvas.toolCalling,
        baseUrl,
        connected: baseUrl ? (await connection(userId, baseUrl)) !== null : false,
      },
    };
  }
  router.get(
    '/',
    handler(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await status(req));
    }),
  );
  router.put(
    '/canvas/connection',
    handler(async (req, res) => {
      const input = z
        .object({ token: z.string().trim().min(10).max(4096).regex(/^\S+$/) })
        .strict()
        .safeParse(req.body);
      if (!input.success) throw new CanvasError('canvas_invalid_request', 400);
      const { userId, config, school: source } = await access(req);
      const school = enabled(source),
        origin = canvasOrigin(school.canvas.baseUrl);
      await createCanvasClient({
        baseUrl: origin,
        token: input.data.token,
        settings: school.canvas,
        fetchFn: deps.fetchFn,
      }).verify();
      await deps.store.updatePluginAuth({
        userId,
        authField,
        pluginKey,
        value: await deps.encrypt(
          JSON.stringify({ origin, token: input.data.token }),
          config.credentials?.writeFormat,
        ),
      });
      res.json({ connected: true });
    }),
  );
  router.delete(
    '/canvas/connection',
    handler(async (req, res) => {
      const { userId } = await access(req);
      await deps.store.deletePluginAuth({ userId, pluginKey, all: true });
      res.sendStatus(204);
    }),
  );
  router.get(
    '/canvas/courses',
    handler(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await (await clientFor(req)).courses());
    }),
  );
  for (const kind of ['assignment', 'page'] as const) {
    router.get(
      `/canvas/courses/:courseId/${kind === 'assignment' ? 'assignments' : 'pages'}`,
      handler(async (req, res) => {
        const courseId = z.string().regex(/^\d+$/).safeParse(req.params.courseId);
        if (!courseId.success) throw new CanvasError('canvas_invalid_request', 400);
        res.set('Cache-Control', 'no-store');
        res.json(await (await clientFor(req)).materials(courseId.data, kind));
      }),
    );
  }
  router.post(
    '/canvas/context',
    handler(async (req, res) => {
      const input = canvasContextRequestSchema.safeParse(req.body);
      if (!input.success) throw new CanvasError('canvas_invalid_request', 400);
      res.set('Cache-Control', 'no-store');
      res.json(await (await clientFor(req)).context(input.data.selections));
    }),
  );
  return router;
}
