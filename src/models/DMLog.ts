import mongoose, { Document, Schema } from 'mongoose';

export type DMStatus = 'queued' | 'sent' | 'failed' | 'skipped_cooldown' | 'skipped_duplicate';

export interface IDMLog extends Document {
  creatorId: mongoose.Types.ObjectId;
  leadId?: mongoose.Types.ObjectId;
  automationRuleId: mongoose.Types.ObjectId;
  instagramUserId: string;
  instagramUsername?: string;
  messageText: string;
  status: DMStatus;
  errorMessage?: string;
  retryCount: number;
  sentAt?: Date;
  jobId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DMLogSchema = new Schema<IDMLog>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    automationRuleId: { type: Schema.Types.ObjectId, ref: 'AutomationRule', required: true },
    instagramUserId: { type: String, required: true },
    instagramUsername: { type: String },
    messageText: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'skipped_cooldown', 'skipped_duplicate'],
      default: 'queued',
      index: true,
    },
    errorMessage: { type: String },
    retryCount: { type: Number, default: 0 },
    sentAt: { type: Date },
    jobId: { type: String },
  },
  { timestamps: true }
);

DMLogSchema.index({ creatorId: 1, createdAt: -1 });
DMLogSchema.index({ creatorId: 1, status: 1 });

export const DMLog = mongoose.model<IDMLog>('DMLog', DMLogSchema);
