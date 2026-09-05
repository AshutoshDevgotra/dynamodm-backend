import mongoose, { Document, Schema } from 'mongoose';

export interface IDMJob extends Document {
  jobId: string;
  dmLogId: string;
  creatorId: string;
  igUserId: string;
  recipientId: string;
  message: string;
  attachmentUrl?: string;
  automationRuleId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lockedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DMJobSchema = new Schema<IDMJob>(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    dmLogId: { type: String, required: true },
    creatorId: { type: String, required: true },
    igUserId: { type: String, required: true },
    recipientId: { type: String, required: true },
    message: { type: String, required: true },
    attachmentUrl: { type: String },
    automationRuleId: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lockedAt: { type: Date },
    lastError: { type: String },
  },
  { timestamps: true },
);

DMJobSchema.index({ status: 1, nextAttemptAt: 1 });

export const DMJob = mongoose.model<IDMJob>('DMJob', DMJobSchema);