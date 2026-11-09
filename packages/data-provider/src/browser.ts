import { z } from 'zod';

export const SCHOOL_BROWSER_TOOL_NAME = 'school_browser';
const hostRule = z
  .string()
  .max(253)
  .regex(/^(?:\*\.)?[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}$/i);
export const schoolBrowserSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  serviceUrl: z.string().url().default('http://127.0.0.1:3118'),
  tokenEnv: z
    .string()
    .regex(/^SCHOOL_BROWSER_[A-Z0-9_]+$/)
    .default('SCHOOL_BROWSER_TOKEN'),
  allowedHosts: z.array(hostRule).max(100).default([]),
  blockedHosts: z
    .array(hostRule)
    .max(100)
    .default([
      '*.instructure.com',
      '*.office.com',
      '*.office365.com',
      '*.sharepoint.com',
      'login.microsoftonline.com',
      'outlook.live.com',
      'accounts.google.com',
    ]),
  timeoutMs: z.number().int().min(1000).max(30000).default(20000),
  maxChars: z.number().int().min(1000).max(60000).default(24000),
  maxActions: z.number().int().min(1).max(100).default(30),
  idleTimeoutMs: z.number().int().min(10000).max(600000).default(120000),
  maxSessions: z.number().int().min(1).max(8).default(2),
  maxLifetimeMs: z.number().int().min(10000).max(1800000).default(600000),
  snapshotDepth: z.number().int().min(1).max(12).default(6),
  maxPausedSessions: z.number().int().min(10).max(10000).default(1000),
});
export type SchoolBrowserSettings = z.infer<typeof schoolBrowserSettingsSchema>;
export const schoolBrowserInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('open'), url: z.string().min(1).max(2048) }).strict(),
  z
    .object({
      operation: z.literal('read'),
      offset: z.number().int().min(0).max(200000).optional(),
    })
    .strict(),
  z.object({ operation: z.literal('follow'), ref: z.string().regex(/^e\d+$/) }).strict(),
  z.object({ operation: z.literal('back') }).strict(),
  z.object({ operation: z.literal('view') }).strict(),
  z.object({ operation: z.literal('close') }).strict(),
]);
export type SchoolBrowserInput = z.infer<typeof schoolBrowserInputSchema>;
export const schoolBrowserStateSchema = z.object({
  status: z.enum(['closed', 'ready', 'busy']),
  stopped: z.boolean().optional(),
  url: z
    .string()
    .max(2048)
    .regex(/^https?:\/\//)
    .optional(),
  title: z.string().max(500).optional(),
  text: z.string().max(200000).optional(),
  nextOffset: z.number().int().nonnegative().optional(),
  actions: z.number().int().nonnegative().optional(),
  image: z
    .string()
    .max(2000000)
    .regex(/^[A-Za-z0-9+/=]*$/)
    .optional(),
});
export type SchoolBrowserState = z.infer<typeof schoolBrowserStateSchema>;
export const SCHOOL_BROWSER_ERRORS = [
  'browser_disabled',
  'browser_unconfigured',
  'browser_invalid_request',
  'browser_forbidden',
  'browser_unavailable',
  'browser_busy',
  'browser_limit',
  'browser_closed',
  'browser_timeout',
  'browser_stopped',
] as const;
export type SchoolBrowserErrorCode = (typeof SCHOOL_BROWSER_ERRORS)[number];
export const schoolBrowserResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: schoolBrowserStateSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.enum(SCHOOL_BROWSER_ERRORS) }) }),
]);
export type SchoolBrowserResult = z.infer<typeof schoolBrowserResultSchema>;
export const schoolBrowserRequestSchema = z
  .object({
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    input: schoolBrowserInputSchema.optional(),
    control: z.enum(['stop', 'restart']).optional(),
    settings: schoolBrowserSettingsSchema.omit({ serviceUrl: true, tokenEnv: true }),
  })
  .strict();
