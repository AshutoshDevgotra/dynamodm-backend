import mongoose, { Document, Schema } from 'mongoose';

export interface ILead extends Document {
  creatorId: mongoose.Types.ObjectId;
  automationRuleId?: mongoose.Types.ObjectId;
  instagramUserId: string;
  username?: string;
  name?: string;
  email?: string;
  phone?: string;
  profilePic?: string;
  source: 'comment' | 'mention' | 'story_mention' | 'manual';
  commentText?: string;
  postId?: string;
  tags: string[];
  notes?: string;
  isConverted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema = new Schema<ILead>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    automationRuleId: { type: Schema.Types.ObjectId, ref: 'AutomationRule' },
    instagramUserId: { type: String, required: true },
    username: { type: String },
    name: { type: String },
    email: { type: String },
    phone: { type: String },
    profilePic: { type: String },
    source: { type: String, enum: ['comment', 'mention', 'story_mention', 'manual'], default: 'comment' },
    commentText: { type: String },
    postId: { type: String },
    tags: [{ type: String }],
    notes: { type: String },
    isConverted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

LeadSchema.index({ creatorId: 1, instagramUserId: 1 });

export const Lead = mongoose.model<ILead>('Lead', LeadSchema);
