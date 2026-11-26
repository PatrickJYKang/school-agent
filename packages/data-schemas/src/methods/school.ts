import { randomUUID } from 'node:crypto';
import { Constants } from 'librechat-data-provider';
import type {
  SchoolChatPreset,
  SchoolCourse,
  SchoolCourseChats,
  SchoolFolderChoice,
  SchoolSource,
  SchoolViewer,
  TChatProject,
} from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type { SchoolCourseRecord } from '~/models/school';
import type { IChatProjectDocument } from '~/types';
import { buildRetentionVisibilityFilter } from '~/utils/retention';
import { tenantSafeBulkWrite } from '~/utils/tenantBulkWrite';
import { isValidObjectIdString } from '~/utils/objectId';

// Bound optimistic retries so repeated concurrent imports return control to the caller.
const SOURCE_UPDATE_ATTEMPTS = 5;

export type SchoolOwner = { user: string; tenantId?: string };
type SchoolState = SchoolOwner & { scope: string; choice: 'allowed' | 'denied' };
type ViewerConversation = {
  conversationId: string;
  user: string;
  title: string;
  schoolViewers?: string[];
};
type ViewerUser = { _id: { toString(): string }; name?: string; username?: string; email: string };
export interface SchoolMethods {
  getSchoolChoice(owner: SchoolOwner, scope: string): Promise<SchoolFolderChoice>;
  setSchoolChoice(owner: SchoolOwner, scope: string, choice: 'allowed' | 'denied'): Promise<void>;
  bindSchoolChoice(
    owner: SchoolOwner,
    scope: string,
    pendingScope: string,
  ): Promise<SchoolFolderChoice>;
  listSchoolProjects(
    owner: SchoolOwner,
    limit: number,
  ): Promise<{ projects: TChatProject[]; truncated: boolean }>;
  getSchoolProject(owner: SchoolOwner, id: string): Promise<TChatProject | null>;
  listSchoolCourses(
    owner: SchoolOwner,
    limit: number,
    scope?: string,
  ): Promise<{ courses: SchoolCourse[]; truncated: boolean }>;
  getSchoolCourse(owner: SchoolOwner, id: string): Promise<SchoolCourse | null>;
  listSchoolCourseChats(
    owner: SchoolOwner,
    id: string,
    limit: number,
    cursor?: string,
  ): Promise<SchoolCourseChats | null>;
  syncSchoolCourses(
    owner: SchoolOwner,
    scope: string,
    courses: Array<{ id: string; name: string }>,
  ): Promise<void>;
  createSchoolProject(
    owner: SchoolOwner,
    name: string,
    homeId?: string,
  ): Promise<TChatProject | null>;
  putSchoolSource(
    owner: SchoolOwner,
    id: string,
    source: SchoolSource,
    limits: { maxSources: number; maxContextChars: number },
  ): Promise<{ ok: true; value: TChatProject } | { ok: false; code: string }>;
  removeSchoolSource(
    owner: SchoolOwner,
    id: string,
    courseId: string,
    assignmentId: string,
  ): Promise<TChatProject | null>;
  getSchoolViewers(owner: SchoolOwner, conversationId: string): Promise<SchoolViewer[] | null>;
  grantSchoolViewer(
    owner: SchoolOwner,
    conversationId: string,
    email: string,
    limit: number,
  ): Promise<boolean>;
  revokeSchoolViewer(owner: SchoolOwner, conversationId: string, id: string): Promise<boolean>;
  findSchoolLiveConversation(
    owner: SchoolOwner,
    conversationId: string,
  ): Promise<{ conversationId: string; user: string; title: string } | null>;
  createSchoolChat(
    owner: SchoolOwner,
    input: {
      title: string;
      projectId?: string;
      schoolCourseId?: string;
      context?: string;
      retention?: { isTemporary?: boolean; expiredAt?: Date };
      preset: SchoolChatPreset;
    },
  ): Promise<string | null>;
  readSchoolMessages(
    owner: SchoolOwner,
    conversationId: string,
    limit: number,
    maxChars: number,
  ): Promise<
    Array<{
      messageId: string;
      parentMessageId?: string;
      text?: string;
      sender?: string;
      isCreatedByUser?: boolean;
      content?: Array<{ type: string; text?: string | { value?: string } }>;
    }>
  >;
}

export function createSchoolMethods(mongoose: typeof import('mongoose')): SchoolMethods {
  const projects = () => mongoose.models.ChatProject as Model<IChatProjectDocument>;
  const courses = () => mongoose.models.SchoolCourse as Model<SchoolCourseRecord>;
  const states = () => mongoose.models.SchoolState as Model<SchoolState>;
  const ownerFilter = ({ user, tenantId }: SchoolOwner) => ({ user, tenantId: tenantId ?? null });
  const projectFilter = (owner: SchoolOwner, id: string) => ({
    ...ownerFilter(owner),
    _id: isValidObjectIdString(id) ? id : null,
  });
  const view = (project: IChatProjectDocument): TChatProject => ({
    _id: String(project._id),
    name: project.name,
    description: project.description,
    instructions: project.instructions,
    contextRevision: project.contextRevision,
    school: project.school,
    conversationCount: project.conversationCount,
    createdAt: project.createdAt?.toISOString() ?? '',
    updatedAt: project.updatedAt?.toISOString() ?? '',
  });
  async function findProject(owner: SchoolOwner, id: string) {
    return projects().findOne(projectFilter(owner, id));
  }
  const courseView = (row: SchoolCourseRecord & { _id: { toString(): string } }): SchoolCourse => ({
    id: row._id.toString(),
    name: row.name,
    canvasCourseId: row.canvasCourseId,
  });
  // Keep old course workspaces as ordinary child projects: this preserves instructions,
  // files, chat IDs and context revisions without silently changing any agent's context.
  async function migrateCourses(owner: SchoolOwner) {
    const legacy = await projects()
      .find({ ...ownerFilter(owner), 'school.kind': 'course' })
      .select('_id school name');
    for (const row of legacy) {
      if (!row.school?.scope || !row.school.courseId) continue;
      const course = await courses().findOneAndUpdate(
        { ...ownerFilter(owner), scope: row.school.scope, canvasCourseId: row.school.courseId },
        { $setOnInsert: { _id: row._id, name: row.name } },
        { upsert: true, new: true },
      );
      const id = String(course._id);
      await projects().updateMany(
        { ...ownerFilter(owner), 'school.homeId': String(row._id) },
        { $set: { 'school.homeId': id } },
      );
      await projects().updateOne(
        { ...projectFilter(owner, String(row._id)), 'school.kind': 'course' },
        { $set: { 'school.kind': 'project', 'school.homeId': id } },
      );
    }
  }
  return {
    async listSchoolCourses(owner, limit, scope) {
      await migrateCourses(owner);
      const rows = await courses()
        .find(ownerFilter(owner))
        .sort({ name: 1, _id: 1 })
        .limit(limit + 1);
      return {
        courses: rows.slice(0, limit).map((row) => ({
          ...courseView(row),
          ...(scope ? { active: row.scope === scope } : {}),
        })),
        truncated: rows.length > limit,
      };
    },
    async getSchoolCourse(owner, id) {
      const row = await courses().findOne(projectFilter(owner, id));
      return row ? courseView(row) : null;
    },
    async listSchoolCourseChats(owner, id, limit, cursor) {
      if (!(await courses().exists(projectFilter(owner, id)))) return null;
      const filter = {
        ...ownerFilter(owner),
        schoolCourseId: id,
        chatProjectId: null,
        isArchived: { $ne: true },
        $and: [buildRetentionVisibilityFilter()],
      };
      const last = cursor
        ? await mongoose.models.Conversation.findOne({
            ...filter,
            _id: isValidObjectIdString(cursor) ? cursor : null,
          })
            .select('updatedAt')
            .lean<{ _id: { toString(): string }; updatedAt: Date }>()
        : null;
      if (cursor && !last) return { chats: [], nextCursor: null };
      const rows = await mongoose.models.Conversation.find({
        ...filter,
        ...(last
          ? {
              $or: [
                { updatedAt: { $lt: last.updatedAt } },
                { updatedAt: last.updatedAt, _id: { $lt: last._id } },
              ],
            }
          : {}),
      })
        .select('conversationId title updatedAt')
        .sort({ updatedAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean<
          Array<{
            _id: { toString(): string };
            conversationId: string;
            title: string;
            updatedAt: Date;
          }>
        >();
      return {
        chats: rows.slice(0, limit).map((row) => ({
          conversationId: row.conversationId,
          title: row.title,
          updatedAt: row.updatedAt.toISOString(),
        })),
        nextCursor: rows.length > limit ? String(rows[limit - 1]._id) : null,
      };
    },
    async getSchoolChoice(owner: SchoolOwner, scope: string): Promise<SchoolFolderChoice> {
      const state = await states()
        .findOne({ ...ownerFilter(owner), scope })
        .lean();
      return state?.choice ?? 'undecided';
    },
    async setSchoolChoice(owner: SchoolOwner, scope: string, choice: 'allowed' | 'denied') {
      await states().updateOne(
        { ...ownerFilter(owner), scope },
        { $set: { choice } },
        { upsert: true },
      );
    },
    async bindSchoolChoice(owner, scope, pendingScope) {
      const current = await states()
        .findOne({ ...ownerFilter(owner), scope })
        .lean();
      if (current) return current.choice;
      const pending = await states()
        .findOneAndDelete({ ...ownerFilter(owner), scope: pendingScope })
        .lean();
      if (!pending) return 'undecided';
      await states().updateOne(
        { ...ownerFilter(owner), scope },
        { $setOnInsert: { choice: pending.choice } },
        { upsert: true },
      );
      const saved = await states()
        .findOne({ ...ownerFilter(owner), scope })
        .lean();
      if (!saved) throw new Error('school_choice_missing');
      return saved.choice;
    },
    async listSchoolProjects(owner: SchoolOwner, limit: number) {
      const rows = await projects()
        .find(ownerFilter(owner))
        .select('-school.sources.markdown -instructions')
        .sort({ updatedAt: -1 })
        .limit(limit + 1);
      return { projects: rows.slice(0, limit).map(view), truncated: rows.length > limit };
    },
    async getSchoolProject(owner, id) {
      const row = await findProject(owner, id);
      return row ? view(row) : null;
    },
    async syncSchoolCourses(owner, scope, items) {
      if (items.length === 0) return;
      await migrateCourses(owner);
      await tenantSafeBulkWrite(
        courses(),
        items.map((course) => ({
          updateOne: {
            filter: { ...ownerFilter(owner), scope, canvasCourseId: course.id },
            update: { $set: { name: course.name.slice(0, 100) } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    },
    async createSchoolProject(owner: SchoolOwner, name: string, homeId?: string) {
      if (homeId && !(await courses().exists(projectFilter(owner, homeId)))) return null;
      const row = await projects().create({
        ...ownerFilter(owner),
        name,
        school: { kind: 'project', homeId: homeId ?? null },
      });
      return view(row);
    },
    async putSchoolSource(
      owner: SchoolOwner,
      id: string,
      source: SchoolSource,
      limits: { maxSources: number; maxContextChars: number },
    ) {
      for (let attempt = 0; attempt < SOURCE_UPDATE_ATTEMPTS; attempt++) {
        const row = await findProject(owner, id);
        if (!row || row.school?.kind === 'course')
          return { ok: false as const, code: 'workspace_not_found' };
        const sources = (row.school?.sources ?? []).filter(
          (s) => s.courseId !== source.courseId || s.id !== source.id,
        );
        sources.push(source);
        if (
          sources.length > limits.maxSources ||
          sources.reduce((sum, s) => sum + s.markdown.length, 0) > limits.maxContextChars
        )
          return { ok: false as const, code: 'workspace_context_limit' };
        const updated = await projects().findOneAndUpdate(
          {
            ...projectFilter(owner, id),
            ...(row.contextRevision == null || row.contextRevision === 0
              ? { $or: [{ contextRevision: 0 }, { contextRevision: { $exists: false } }] }
              : { contextRevision: row.contextRevision }),
          },
          {
            $set: { 'school.kind': 'project', 'school.sources': sources },
            $inc: { contextRevision: 1 },
          },
          { new: true },
        );
        if (updated) return { ok: true as const, value: view(updated) };
      }
      return { ok: false as const, code: 'workspace_conflict' };
    },
    async removeSchoolSource(
      owner: SchoolOwner,
      id: string,
      courseId: string,
      assignmentId: string,
    ) {
      const row = await projects().findOneAndUpdate(
        projectFilter(owner, id),
        {
          $pull: { 'school.sources': { courseId, id: assignmentId } },
          $inc: { contextRevision: 1 },
        },
        { new: true },
      );
      return row ? view(row) : null;
    },
    async getSchoolViewers(
      owner: SchoolOwner,
      conversationId: string,
    ): Promise<SchoolViewer[] | null> {
      const convo = await mongoose.models.Conversation.findOne({
        ...ownerFilter(owner),
        conversationId,
      })
        .select('+schoolViewers')
        .lean<ViewerConversation>();
      if (!convo) return null;
      const users = await mongoose.models.User.find({
        _id: { $in: convo.schoolViewers ?? [] },
        tenantId: owner.tenantId ?? null,
      })
        .select('name username email')
        .lean<ViewerUser[]>();
      return users.map((u) => ({
        id: u._id.toString(),
        name: u.name || u.username || u.email,
        email: u.email,
      }));
    },
    async grantSchoolViewer(
      owner: SchoolOwner,
      conversationId: string,
      email: string,
      limit: number,
    ) {
      const recipient = await mongoose.models.User.findOne({
        email,
        tenantId: owner.tenantId ?? null,
      })
        .select('_id')
        .lean<ViewerUser>();
      if (!recipient || recipient._id.toString() === owner.user) return false;
      const id = recipient._id.toString();
      const row = await mongoose.models.Conversation.findOneAndUpdate(
        {
          ...ownerFilter(owner),
          conversationId,
          $or: [
            { schoolViewers: id },
            { $expr: { $lt: [{ $size: { $ifNull: ['$schoolViewers', []] } }, limit] } },
          ],
        },
        { $addToSet: { schoolViewers: id } },
      );
      return row !== null;
    },
    async revokeSchoolViewer(owner: SchoolOwner, conversationId: string, id: string) {
      const row = await mongoose.models.Conversation.updateOne(
        { ...ownerFilter(owner), conversationId },
        { $pull: { schoolViewers: id } },
      );
      return row.matchedCount > 0;
    },
    async findSchoolLiveConversation(owner: SchoolOwner, conversationId: string) {
      return mongoose.models.Conversation.findOne({
        conversationId,
        tenantId: owner.tenantId ?? null,
        $or: [{ user: owner.user }, { schoolViewers: owner.user }],
        isArchived: { $ne: true },
        $and: [{ $or: [{ expiredAt: null }, { expiredAt: { $gt: new Date() } }] }],
      })
        .select('conversationId user title')
        .lean<{ conversationId: string; user: string; title: string }>();
    },
    async createSchoolChat(owner, input) {
      if (input.projectId && !(await findProject(owner, input.projectId))) return null;
      if (
        input.schoolCourseId &&
        (input.projectId || !(await courses().exists(projectFilter(owner, input.schoolCourseId))))
      )
        return null;
      const conversationId = randomUUID();
      // Store admitted source text in visible history. Enforced model specs replace
      // prompt prefixes, so a source hidden in that field would disappear on send.
      const reference = input.context
        ? await mongoose.models.Message.create({
            ...ownerFilter(owner),
            conversationId,
            messageId: randomUUID(),
            parentMessageId: Constants.NO_PARENT,
            sender: 'User',
            isCreatedByUser: true,
            text: input.context,
            endpoint: input.preset.endpoint,
            ...input.retention,
          })
        : null;
      await mongoose.models.Conversation.create({
        ...input.preset,
        ...input.retention,
        ...ownerFilter(owner),
        conversationId,
        title: input.title,
        titleSetByUser: Boolean(input.context),
        ...(reference ? { messages: [reference._id] } : {}),
        ...(input.projectId ? { chatProjectId: input.projectId } : {}),
        ...(input.schoolCourseId ? { schoolCourseId: input.schoolCourseId } : {}),
      });
      if (input.projectId)
        await projects().updateOne(projectFilter(owner, input.projectId), {
          $inc: { conversationCount: 1 },
          $set: { lastConversationId: conversationId, lastConversationAt: new Date() },
        });
      return conversationId;
    },
    async readSchoolMessages(owner, conversationId, limit, maxChars) {
      const partText = {
        $cond: [
          { $eq: [{ $type: '$$this.text' }, 'string'] },
          '$$this.text',
          { $cond: [{ $eq: [{ $type: '$$this.text.value' }, 'string'] }, '$$this.text.value', ''] },
        ],
      };
      const contentText = {
        $reduce: {
          input: { $cond: [{ $isArray: '$content' }, '$content', []] },
          initialValue: '',
          in: {
            $substrCP: [
              { $concat: ['$$value', { $cond: [{ $eq: ['$$this.type', 'text'] }, partText, ''] }] },
              0,
              maxChars,
            ],
          },
        },
      };
      return mongoose.models.Message.aggregate([
        {
          $match: {
            ...ownerFilter(owner),
            conversationId,
            $or: [{ expiredAt: null }, { expiredAt: { $gt: new Date() } }],
          },
        },
        { $sort: { createdAt: -1, _id: -1 } },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            messageId: 1,
            parentMessageId: 1,
            sender: 1,
            isCreatedByUser: 1,
            text: {
              $substrCP: [
                {
                  $cond: [
                    { $eq: [{ $type: '$text' }, 'string'] },
                    { $cond: [{ $ne: ['$text', ''] }, '$text', contentText] },
                    contentText,
                  ],
                },
                0,
                maxChars,
              ],
            },
          },
        },
      ]);
    },
  };
}
