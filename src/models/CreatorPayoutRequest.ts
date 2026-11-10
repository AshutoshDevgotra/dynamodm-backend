import mongoose, { Document, Schema } from 'mongoose';

export type CreatorPayoutStatus = 'REQUESTED' | 'PROCESSING' | 'PAID' | 'REJECTED';

export interface ICreatorPayoutRequest extends Document {
  creatorId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  upiId: string;
  amount: number;
  academyAmount: number;
  affiliateAmount: number;
  status: CreatorPayoutStatus;
  adminNote?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CreatorPayoutRequestSchema = new Schema<ICreatorPayoutRequest>({
  creatorId: { type: Schema.Types.ObjectId, ref: 'CreatorAccount', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  upiId: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
  amount: { type: Number, required: true, min: 1 },
  academyAmount: { type: Number, required: true, min: 0 },
  affiliateAmount: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['REQUESTED', 'PROCESSING', 'PAID', 'REJECTED'], default: 'REQUESTED', index: true },
  adminNote: { type: String, maxlength: 500 },
  processedAt: { type: Date },
}, { timestamps: true });

CreatorPayoutRequestSchema.index({ creatorId: 1, status: 1, createdAt: -1 });

export const CreatorPayoutRequest = mongoose.model<ICreatorPayoutRequest>('CreatorPayoutRequest', CreatorPayoutRequestSchema);
