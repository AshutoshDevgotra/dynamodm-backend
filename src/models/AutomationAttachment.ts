import mongoose, { Document, Schema } from 'mongoose';

export interface IAutomationAttachment extends Document {
  creatorId: mongoose.Types.ObjectId;
  originalName: string;
  mimeType: string;
  size: number;
  data: Buffer;
  createdAt: Date;
}

const AutomationAttachmentSchema = new Schema<IAutomationAttachment>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true }
);

export const AutomationAttachment = mongoose.model<IAutomationAttachment>(
  'AutomationAttachment',
  AutomationAttachmentSchema,
);
