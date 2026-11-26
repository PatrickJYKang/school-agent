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
