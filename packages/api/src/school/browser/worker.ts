import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { access, mkdir, mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { schoolBrowserRequestSchema, schoolBrowserSettingsSchema } from 'librechat-data-provider';
import type {
  SchoolBrowserState,
  SchoolBrowserResult,
  SchoolBrowserSettings,
  SchoolBrowserInput,
  SchoolBrowserErrorCode,
} from 'librechat-data-provider';
import { admitBrowserUrl } from './policy';

type Session = {
  client: Client;
  directory: string;
  state: SchoolBrowserState;
  links: Map<string, string>;
  snapshot: string;
  policy: string;
  lastUsed: number;
  created: number;
  lifetimeMs: number;
  stopped: boolean;
  closing?: Promise<void>;
};
type WorkerSettings = {
  token: string;
  entry: string;
  guard: string;
  proxy: string;
  maxSessions: number;
  maxLifetimeMs: number;
  stateDirectory: string;
  maxPausedSessions: number;
};
const failure = (code: SchoolBrowserErrorCode): SchoolBrowserResult => ({
  ok: false,
  error: { code },
});

/** Owns processes, profiles and cancellation. No raw MCP endpoint is published. */
export function createBrowserWorker(settings: WorkerSettings) {
  const sessions = new Map<string, Session>();
  const pending = new Set<string>();
  const idle = new Map<string, number>();
  let unhealthy = false;
  let pauseWrites = Promise.resolve();
  async function isStopped(scope: string): Promise<boolean> {
    try {
      await access(join(settings.stateDirectory, scope));
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  }
  async function stop(scope: string): Promise<void> {
    const write = pauseWrites.then(async () => {
      if (await isStopped(scope)) return;
      await mkdir(settings.stateDirectory, { recursive: true, mode: 0o700 });
      if ((await readdir(settings.stateDirectory)).length >= settings.maxPausedSessions) {
        unhealthy = true;
        throw new Error('browser_pause_capacity');
      }
      await writeFile(join(settings.stateDirectory, scope), 'stopped\n', { mode: 0o600 });
    });
    pauseWrites = write.catch(() => undefined);
    try {
      await write;
    } catch {
      unhealthy = true;
      await close(scope);
      throw new Error('browser_pause_unavailable');
    }
    await close(scope);
  }
  async function close(scope: string): Promise<void> {
    const session = sessions.get(scope);
    if (!session) return;
    session.closing ??= (async () => {
      session.stopped = true;
      try {
        await session.client.close();
        await rm(session.directory, { recursive: true, force: true });
        sessions.delete(scope);
        idle.delete(scope);
      } catch {
        unhealthy = true;
        throw new Error('browser_cleanup_failed');
      }
    })();
    await session.closing;
  }
  async function call(
    session: Session,
    name: string,
    args: Record<string, string | number>,
    timeout: number,
  ) {
    const response = await session.client.callTool({ name, arguments: args }, undefined, {
      timeout,
    });
    if (response.isError) throw new Error('browser_call_failed');
    return CallToolResultSchema.parse(response).content;
  }
  async function snapshot(session: Session, policy: SchoolBrowserSettings) {
    const navigation = await readFile(join(session.directory, 'navigation.json'), 'utf8').catch(
      (error) => {
        if (error.code === 'ENOENT') return '{}';
        throw error;
      },
    );
    const status = JSON.parse(navigation).status;
    if (typeof status === 'number' && status >= 400) throw new Error('browser_forbidden');
    const content = await call(
      session,
      'browser_snapshot',
      { depth: policy.snapshotDepth },
      policy.timeoutMs,
    );
    const text = Array.isArray(content)
      ? content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n')
      : '';
    const url = /^- Page URL: (.+)$/m.exec(text)?.[1];
    if (!url || !admitBrowserUrl(url, policy)) throw new Error('browser_forbidden');
    session.snapshot = text.slice(0, 200000);
    session.links.clear();
    const lines = session.snapshot.split('\n');
    let ref: string | undefined;
    for (const line of lines) {
      const link = /- link .*\[ref=(e\d+)\]/.exec(line);
      if (link) ref = link[1];
      else if (/\[ref=/.test(line)) ref = undefined;
      const href = /- \/url: (.+)$/.exec(line)?.[1];
      if (ref && href) {
        try {
          const allowed = admitBrowserUrl(new URL(href, url).href, policy);
          if (allowed) session.links.set(ref, allowed);
        } catch {
          /* An unusable page link grants no navigation. */
        }
        ref = undefined;
      }
    }
    session.state.url = url;
    session.state.title = (/^- Page Title: (.+)$/m.exec(text)?.[1] ?? '').slice(0, 500);
  }
  function view(session: Session, policy: SchoolBrowserSettings, offset = 0): SchoolBrowserState {
    const text = session.snapshot.slice(offset, offset + policy.maxChars);
    return {
      ...session.state,
      text,
      ...(offset + text.length < session.snapshot.length
        ? { nextOffset: offset + text.length }
        : {}),
    };
  }
  async function create(scope: string, policy: SchoolBrowserSettings): Promise<Session> {
    const directory = await mkdtemp(join(tmpdir(), 'school-browser-'));
    const file = join(directory, 'config.json');
    const policyFile = join(directory, 'policy.json');
    await writeFile(policyFile, JSON.stringify(policy), { mode: 0o600 });
    await writeFile(
      file,
      JSON.stringify({
        browser: {
          browserName: 'chromium',
          isolated: true,
          initPage: [settings.guard],
          launchOptions: {
            headless: true,
            chromiumSandbox: true,
            proxy: { server: settings.proxy, bypass: '<-loopback>' },
            args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
          },
          contextOptions: {
            acceptDownloads: false,
            serviceWorkers: 'block',
            viewport: { width: 1100, height: 750 },
            permissions: [],
          },
        },
        capabilities: ['core'],
        webmcp: false,
        saveSession: false,
        timeouts: { navigation: policy.timeoutMs, action: policy.timeoutMs },
        outputDir: directory,
      }),
      { mode: 0o600 },
    );
    const client = new Client({ name: 'school-browser', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [settings.entry, '--config', file],
      stderr: 'ignore',
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: directory,
        TMPDIR: directory,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/ms-playwright',
        SCHOOL_BROWSER_POLICY_FILE: policyFile,
      },
    });
    try {
      await client.connect(transport, { timeout: policy.timeoutMs });
    } catch {
      await client.close();
      await rm(directory, { recursive: true, force: true });
      throw new Error('browser_unavailable');
    }
    const session: Session = {
      client,
      directory,
      state: { status: 'ready', actions: 0 },
      links: new Map(),
      snapshot: '',
      policy: JSON.stringify(policy),
      lastUsed: Date.now(),
      created: Date.now(),
      lifetimeMs: Math.min(settings.maxLifetimeMs, policy.maxLifetimeMs),
      stopped: false,
    };
    sessions.set(scope, session);
    idle.set(scope, policy.idleTimeoutMs);
    return session;
  }
  async function execute(
    scope: string,
    input: SchoolBrowserInput | undefined,
    policy: SchoolBrowserSettings,
    control?: 'stop' | 'restart',
  ): Promise<SchoolBrowserResult> {
    if (unhealthy) return failure('browser_unavailable');
    if (control === 'restart') {
      if (pending.has(scope)) return failure('browser_busy');
      pending.add(scope);
      try {
        await close(scope);
        const reset = pauseWrites.then(() =>
          rm(join(settings.stateDirectory, scope), { force: true }),
        );
        pauseWrites = reset.catch(() => undefined);
        await reset;
        return { ok: true, value: { status: 'closed' } };
      } finally {
        pending.delete(scope);
      }
    }
    if (control === 'stop') {
      await stop(scope);
      return { ok: true, value: { status: 'closed', stopped: await isStopped(scope) } };
    }
    if (input?.operation === 'close') {
      await close(scope);
      return { ok: true, value: { status: 'closed' } };
    }
    let session = sessions.get(scope);
    if (!input)
      return {
        ok: true,
        value: session
          ? { ...session.state, text: undefined }
          : { status: pending.has(scope) ? 'busy' : 'closed', stopped: await isStopped(scope) },
      };
    if (pending.has(scope)) return failure('browser_busy');
    // Reserve ownership before the first await; two requests must not launch two profiles.
    pending.add(scope);
    try {
      if (await isStopped(scope)) return failure('browser_stopped');
      if (!session && input.operation !== 'open') return failure('browser_closed');
      if (session && session.policy !== JSON.stringify(policy)) {
        await close(scope);
        session = undefined;
      }
      if (input.operation === 'open' && !admitBrowserUrl(input.url, policy))
        return failure('browser_forbidden');
      if (session && (session.state.actions ?? 0) >= policy.maxActions)
        return failure('browser_limit');
      if (
        !session &&
        sessions.size + pending.size > Math.min(settings.maxSessions, policy.maxSessions)
      )
        return failure('browser_busy');
      session ??= await create(scope, policy);
      if (await isStopped(scope)) {
        await close(scope);
        return failure('browser_stopped');
      }
      session.state.status = 'busy';
      session.state.actions = (session.state.actions ?? 0) + 1;
      session.lastUsed = Date.now();
      if (input.operation === 'open' || input.operation === 'follow') {
        session.state.image = undefined;
        await rm(join(session.directory, 'navigation.json'), { force: true });
        const url = input.operation === 'open' ? input.url : session.links.get(input.ref);
        if (!url) return failure('browser_invalid_request');
        await call(session, 'browser_navigate', { url }, policy.timeoutMs);
      } else if (input.operation === 'back') {
        session.state.image = undefined;
        await call(session, 'browser_navigate_back', {}, policy.timeoutMs);
      }
      await snapshot(session, policy);
      if (input.operation === 'view') {
        const content = await call(
          session,
          'browser_take_screenshot',
          { type: 'png' },
          policy.timeoutMs,
        );
        const item = Array.isArray(content)
          ? content.find((part) => part.type === 'image')
          : undefined;
        if (item?.type !== 'image' || typeof item.data !== 'string' || item.data.length > 2000000)
          return failure('browser_limit');
        session.state.image = item.data;
      }
      if (session.stopped) return failure('browser_stopped');
      session.state.status = 'ready';
      return {
        ok: true,
        value: view(session, policy, input.operation === 'read' ? input.offset : 0),
      };
    } catch (error) {
      const stopped = session?.stopped;
      await close(scope);
      if (stopped) return failure('browser_stopped');
      if (error instanceof Error && error.message === 'browser_forbidden')
        return failure('browser_forbidden');
      return failure('browser_unavailable');
    } finally {
      pending.delete(scope);
      if (session && !session.stopped) session.state.status = 'ready';
    }
  }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [scope, session] of sessions) {
      if (
        now - session.lastUsed > (idle.get(scope) ?? 120000) ||
        now - session.created > session.lifetimeMs
      )
        void close(scope).catch(() => {
          process.exitCode = 1;
        });
    }
  }, 5000);
  timer.unref();
  const server = createServer(async (req, res) => {
    const authorization = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${settings.token}`);
    const send = (status: number, value: object) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected))
      return send(401, failure('browser_forbidden'));
    if (req.method !== 'POST' || req.url !== '/session')
      return send(404, failure('browser_invalid_request'));
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        // Covers the maximum ASCII host-policy shape before JSON/schema processing.
        if (size > 65536) return send(413, failure('browser_invalid_request'));
        chunks.push(chunk);
      }
      const parsed = schoolBrowserRequestSchema.safeParse(
        JSON.parse(Buffer.concat(chunks).toString()),
      );
      if (!parsed.success) return send(400, failure('browser_invalid_request'));
      const { scope, input, settings: source, control } = parsed.data;
      const policy = {
        ...source,
        serviceUrl: 'http://browser.invalid',
        tokenEnv: 'SCHOOL_BROWSER_TOKEN',
      };
      const abort = () => {
        if (!res.writableEnded && input) {
          void stop(scope).catch(() => {
            unhealthy = true;
          });
        }
      };
      res.once('close', abort);
      const result = await execute(scope, input, policy, control);
      res.off('close', abort);
      if (!res.destroyed) send(200, result);
    } catch (error) {
      if (!res.destroyed) {
        const malformed = error instanceof SyntaxError;
        send(
          malformed ? 400 : 503,
          failure(malformed ? 'browser_invalid_request' : 'browser_unavailable'),
        );
      }
    }
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 5000;
  return {
    server,
    close: async () => {
      clearInterval(timer);
      await Promise.all([...sessions.keys()].map(close));
      server.close();
    },
  };
}

if (process.env.SCHOOL_BROWSER_WORKER === 'true') {
  const token = process.env.SCHOOL_BROWSER_TOKEN;
  if (!token || token.length < 32) throw new Error('Browser service requires a private token.');
  const worker = createBrowserWorker({
    token,
    entry: '/runtime/node_modules/@playwright/mcp/cli.js',
    guard: '/runtime/guard.cjs',
    proxy: 'http://proxy:4750',
    stateDirectory: '/state',
    ...schoolBrowserSettingsSchema
      .pick({ maxSessions: true, maxLifetimeMs: true, maxPausedSessions: true })
      .parse({
        ...(process.env.SCHOOL_BROWSER_MAX_SESSIONS
          ? { maxSessions: Number(process.env.SCHOOL_BROWSER_MAX_SESSIONS) }
          : {}),
        ...(process.env.SCHOOL_BROWSER_MAX_LIFETIME_MS
          ? { maxLifetimeMs: Number(process.env.SCHOOL_BROWSER_MAX_LIFETIME_MS) }
          : {}),
        ...(process.env.SCHOOL_BROWSER_MAX_PAUSED_SESSIONS
          ? { maxPausedSessions: Number(process.env.SCHOOL_BROWSER_MAX_PAUSED_SESSIONS) }
          : {}),
      }),
  });
  worker.server.listen(3118, '0.0.0.0');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      void worker.close().finally(() => process.exit());
    });
}
