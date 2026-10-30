import { z } from 'zod';

const documentSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  maxBytes: z.number().int().min(10000).max(15000000).default(15000000),
  maxChars: z.number().int().min(1000).max(200000).default(60000),
  maxExtractedChars: z.number().int().min(10000).max(2000000).default(1000000),
  pagesPerRead: z.number().int().min(1).max(50).default(20),
  timeoutMs: z.number().int().min(1000).max(60000).default(20000),
  maxConcurrent: z.number().int().min(1).max(8).default(2),
  workerMemoryMb: z.number().int().min(128).max(512).default(256),
});
const externalLinksSchema = z.object({
  enabled: z
    .boolean()
    .default(true)
    .describe('Allow helpers to read public external links. Takes effect on the next tool call.'),
  maxBytes: z.number().int().min(10000).max(15000000).default(15000000),
  maxRedirects: z.number().int().min(0).max(8).default(4),
  timeoutMs: z.number().int().min(1000).max(60000).default(20000),
});
const schoolSearchSchema = z.object({
  enabled: z.boolean().default(true),
  maxResults: z.number().int().min(1).max(20).default(6),
  maxResponseBytes: z.number().int().min(10000).max(2000000).default(500000),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
  safeSearch: z.enum(['off', 'moderate', 'strict']).default('strict'),
});
export type SchoolDocumentSettings = z.infer<typeof documentSettingsSchema>;

/** Deployment policy. Credentials are stored separately for each authenticated user. */
const schoolSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  name: z.string().trim().min(1).max(100).default('School workspace'),
  timeZone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    })
    .default('UTC'),
  guidance: z
    .string()
    .max(4000)
    .default('Check sources, explain your reasoning, and follow your teacher’s AI guidance.'),
  documents: documentSettingsSchema.default(() => documentSettingsSchema.parse({})),
  externalLinks: externalLinksSchema.default(() => externalLinksSchema.parse({})),
  webSearch: schoolSearchSchema.default(() => schoolSearchSchema.parse({})),
  canvas: z
    .object({
      enabled: z.boolean().default(false),
      toolCalling: z.boolean().default(false),
      baseUrl: z.string().url().optional(),
      timeoutMs: z.number().int().min(1000).max(30000).default(10000),
      maxPages: z.number().int().min(1).max(10).default(4),
      maxContextChars: z.number().int().min(1000).max(200000).default(60000),
      maxResponseBytes: z.number().int().min(10000).max(10000000).default(2000000),
      downloadHosts: z
        .array(z.string().min(1).max(255))
        .max(30)
        .default([
          '*.instructure.com',
          '*.instructureusercontent.com',
          '*.canvas-user-content.com',
          '*.inscloudgate.net',
          '*.amazonaws.com',
        ]),
      maxDownloadRedirects: z.number().int().min(0).max(8).default(4),
    })
    .default(() => ({
      enabled: false,
      toolCalling: false,
      timeoutMs: 10000,
      maxPages: 4,
      maxContextChars: 60000,
      maxResponseBytes: 2000000,
      downloadHosts: [
        '*.instructure.com',
        '*.instructureusercontent.com',
        '*.canvas-user-content.com',
        '*.inscloudgate.net',
        '*.amazonaws.com',
      ],
      maxDownloadRedirects: 4,
    })),
});

// Configuration layers may override individual nested fields; resolve defaults after merging.
export const schoolSchema = schoolSettingsSchema.partial().extend({
  documents: documentSettingsSchema.partial().optional(),
  externalLinks: externalLinksSchema.partial().optional(),
  webSearch: schoolSearchSchema.partial().optional(),
  canvas: schoolSettingsSchema.shape.canvas.unwrap().partial().optional(),
});
export type SchoolConfig = z.infer<typeof schoolSettingsSchema>;
export function resolveSchoolConfig(
  value: z.input<typeof schoolSchema> | undefined,
): SchoolConfig | undefined {
  return value === undefined ? undefined : schoolSettingsSchema.parse(value);
}
export type SchoolStatus = {
  enabled: boolean;
  name: string;
  guidance: string;
  canvas: { enabled: boolean; baseUrl?: string; connected: boolean; toolCalling: boolean };
};
export type CanvasCourse = { id: string; name: string; code: string };
export type CanvasMaterial = {
  id: string;
  kind: 'assignment' | 'page';
  title: string;
  url: string;
  dueAt?: string | null;
};
export type CanvasList<T> = { items: T[]; truncated: boolean };
export const canvasSelectionSchema = z
  .object({
    courseId: z.string().regex(/^\d+$/),
    kind: z.enum(['assignment', 'page']),
    id: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\?#]+$/)
      .refine((value) => Array.from(value).every((character) => character.charCodeAt(0) >= 32))
      .refine((id) => id !== '.' && id !== '..'),
  })
  .refine((value) => value.kind !== 'assignment' || /^\d+$/.test(value.id));
export const canvasContextRequestSchema = z
  .object({
    selections: z.array(canvasSelectionSchema).min(1).max(10),
  })
  .strict();
export type CanvasSelection = z.infer<typeof canvasSelectionSchema>;
export type CanvasContext = {
  filename: string;
  markdown: string;
  sources: CanvasMaterial[];
  linkedFiles?: CanvasFileLink[];
  linkedUrls?: { title: string; url: string }[];
};
export type CanvasFileLink = { courseId: string; fileId: string; url: string; title: string };
export type CanvasDocumentFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
};
export const CANVAS_ERROR_CODES = [
  'school_disabled',
  'canvas_unconfigured',
  'canvas_not_connected',
  'canvas_unauthorized',
  'canvas_forbidden',
  'canvas_rate_limited',
  'canvas_unavailable',
  'canvas_invalid_response',
  'canvas_too_large',
  'canvas_invalid_request',
  'document_unsupported',
  'document_unreadable',
  'document_no_text',
  'document_too_large',
  'document_busy',
  'document_timeout',
  'document_forbidden',
  'document_blocked',
  'school_request_failed',
] as const;
export type CanvasErrorCode = (typeof CANVAS_ERROR_CODES)[number];
export const CANVAS_TOOL_NAME = 'canvas';
export const canvasToolInputSchema = z
  .object({
    operation: z
      .enum([
        'list_courses',
        'list_assignments',
        'list_pages',
        'read_material',
        'list_files',
        'read_file',
      ])
      .describe(
        'List courses to resolve names. read_material retrieves instructions, rubric and linked file IDs; list_files lists course documents; read_file reads a PDF/Word document.',
      ),
    course_id: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .describe('Canvas course ID from list_courses. Required except for list_courses.'),
    material_id: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe('Assignment ID or page slug from a preceding list. Required for read_material.'),
    kind: z
      .enum(['assignment', 'page'])
      .optional()
      .describe('Material kind. Required for read_material.'),
  })
  .strict();
export const documentReadOptionsSchema = z.object({
  start_page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('First PDF page, starting at 1. Defaults to page 1.'),
  end_page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Last PDF page. Omit to read the next bounded group of pages.'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Character offset within the selected pages/document. Use nextOffset to continue a truncated result.',
    ),
});
export const canvasDocumentToolInputSchema = canvasToolInputSchema.extend({
  file_id: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .describe(
      'Canvas file ID from read_material linkedFiles or list_files. Required for read_file.',
    ),
  search: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Optional filename search for list_files.'),
  ...documentReadOptionsSchema.shape,
});
export const canvasToolParameters = z.toJSONSchema(canvasDocumentToolInputSchema, {
  target: 'draft-7',
});
export const DOCUMENT_TOOL_NAME = 'documents';
export const documentToolInputSchema = documentReadOptionsSchema
  .extend({
    operation: z.enum(['list', 'read']),
    file_id: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe(
        'File ID from list; required for read. Only documents attached in this chat context are accessible.',
      ),
  })
  .strict();
export const documentToolParameters = z.toJSONSchema(documentToolInputSchema, {
  target: 'draft-7',
});

export const SCHOOL_WEB_TOOL_NAME = 'web';
export const schoolWebInputSchema = documentReadOptionsSchema
  .extend({
    operation: z.enum(['search', 'read']),
    query: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .optional()
      .describe('Search terms for search. Uses the institution’s Brave Search account.'),
    url: z
      .string()
      .url()
      .max(4096)
      .optional()
      .describe(
        'Public HTTP(S) URL to read. Follow Canvas linkedUrls or search results; do not guess article contents.',
      ),
  })
  .strict();
export const schoolWebParameters = z.toJSONSchema(schoolWebInputSchema, { target: 'draft-7' });
