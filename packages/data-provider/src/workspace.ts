import { z } from 'zod';
import type { TModelSpecPreset } from './schemas';
import type { TChatProject } from './types';

export type SchoolChatPreset = TModelSpecPreset & { endpoint: string; spec?: string };

export const schoolWorkspaceSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  viewersEnabled: z.boolean().default(false),
  maxProjects: z.number().int().min(10).max(1000).default(200),
  courseChatPageSize: z.number().int().min(1).max(100).default(30),
  maxCourses: z.number().int().min(1).max(100).default(30),
  courseConcurrency: z.number().int().min(1).max(10).default(4),
  maxAssignments: z.number().int().min(1).max(500).default(100),
  maxSources: z.number().int().min(1).max(50).default(20),
  maxContextChars: z.number().int().min(1000).max(200000).default(60000),
  maxViewers: z.number().int().min(1).max(100).default(20),
  refreshMs: z.number().int().min(5000).max(300000).default(300000),
  viewerRefreshMs: z.number().int().min(1000).max(60000).default(3000),
  maxViewMessages: z.number().int().min(10).max(1000).default(300),
  maxViewChars: z.number().int().min(10000).max(2000000).default(200000),
});
export type SchoolWorkspaceSettings = z.infer<typeof schoolWorkspaceSettingsSchema>;
export type SchoolFolderChoice = 'undecided' | 'allowed' | 'denied';
export type SchoolSource = {
  courseId: string;
  id: string;
  title: string;
  url: string;
  markdown: string;
  retrievedAt: string;
};
export type SchoolProjectData = {
  kind: 'course' | 'project';
  scope?: string;
  courseId?: string;
  homeId?: string | null;
  sources?: SchoolSource[];
};
export type SchoolAssignment = {
  id: string;
  courseId: string;
  title: string;
  course: string;
  url: string;
  dueAt?: string | null;
};
export type SchoolCourse = {
  id: string;
  name: string;
  canvasCourseId: string;
  active?: boolean;
};
export type SchoolCourseChats = {
  chats: Array<{ conversationId: string; title: string; updatedAt: string }>;
  nextCursor: string | null;
};
export type SchoolWorkspace = {
  courses: SchoolCourse[];
  choice: SchoolFolderChoice | 'unavailable';
  projects: TChatProject[];
  truncated: boolean;
  connected: boolean;
  assignments: SchoolAssignment[];
  assignmentsError?: string;
  retrievedAt: string;
  timeZone: string;
  settings: Pick<SchoolWorkspaceSettings, 'refreshMs' | 'viewerRefreshMs'>;
};
export type SchoolViewer = { id: string; name: string; email: string };
export type SchoolViewMessage = {
  messageId: string;
  parentMessageId?: string | null;
  sender?: string;
  text?: string;
  isCreatedByUser?: boolean;
  content?: Array<{ type: string; text?: string }>;
};
export type SchoolLiveView = {
  title: string;
  messages: SchoolViewMessage[];
  truncated: boolean;
  refreshMs: number;
};
