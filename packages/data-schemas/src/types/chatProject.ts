import type { SchoolProjectData } from 'librechat-data-provider';
import type { Document, Types } from 'mongoose';

export interface IChatProject {
  school?: SchoolProjectData;
  _id?: Types.ObjectId;
  name: string;
  description?: string;
  instructions?: string;
  contextRevision?: number;
  file_ids?: string[];
  hasInstructions?: boolean;
  fileCount?: number;
  user: string;
  conversationCount: number;
  lastConversationAt?: Date | null;
  lastConversationId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  tenantId?: string;
}

export interface IChatProjectDocument extends Omit<IChatProject, '_id'>, Document {}
