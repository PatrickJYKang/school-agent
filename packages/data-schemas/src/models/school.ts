import { Schema } from 'mongoose';
import type { Model } from 'mongoose';
import { applyTenantIsolation } from './plugins/tenantIsolation';

const schema = new Schema(
  {
    user: { type: String, required: true },
    tenantId: String,
    scope: { type: String, required: true },
    choice: { type: String, enum: ['allowed', 'denied'], required: true },
  },
  { timestamps: true },
);
schema.index({ user: 1, tenantId: 1, scope: 1 }, { unique: true });

type SchoolStateRecord = {
  user: string;
  tenantId?: string;
  scope: string;
  choice: 'allowed' | 'denied';
};

export function createSchoolStateModel(
  mongoose: typeof import('mongoose'),
): Model<SchoolStateRecord> {
  applyTenantIsolation(schema);
  return (
    (mongoose.models.SchoolState as Model<SchoolStateRecord> | undefined) ||
    mongoose.model<SchoolStateRecord>('SchoolState', schema, 'schoolstate')
  );
}

export type SchoolCourseRecord = {
  user: string;
  tenantId?: string;
  scope: string;
  canvasCourseId: string;
  name: string;
};

const courseSchema = new Schema<SchoolCourseRecord>(
  {
    user: { type: String, required: true },
    tenantId: String,
    scope: { type: String, required: true },
    canvasCourseId: { type: String, required: true },
    name: { type: String, required: true },
  },
  { timestamps: true },
);
courseSchema.index({ user: 1, tenantId: 1, scope: 1, canvasCourseId: 1 }, { unique: true });

export function createSchoolCourseModel(
  mongoose: typeof import('mongoose'),
): Model<SchoolCourseRecord> {
  applyTenantIsolation(courseSchema);
  return (
    (mongoose.models.SchoolCourse as Model<SchoolCourseRecord> | undefined) ||
    mongoose.model<SchoolCourseRecord>('SchoolCourse', courseSchema, 'schoolcourses')
  );
}
