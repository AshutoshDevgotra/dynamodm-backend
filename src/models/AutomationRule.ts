import mongoose, { Document, Schema } from 'mongoose';

export type MatchType = 'exact' | 'contains' | 'starts_with' | 'regex';
export type TriggerType = 'comment' | 'mention' | 'story_mention' | 'dm';

export interface IAutomationRule extends Document {
  creatorId: mongoose.Types.ObjectId;
  name: string;
  keywords: string[];
  matchType: MatchType;
  triggerType: TriggerType;
  targetPosts?: string[];
  responseMessage: string;
  ctaLink?: string;
  attachmentUrl?: string;
  attachmentType?: 'pdf' | 'image' | 'video';
  isActive: boolean;
  delaySeconds: number; // delay before sending DM
  cooldownMinutes: number; // prevent repeat DMs to same user within X mins
  sendPublicReply: boolean;
  publicReplyMessage?: string;
  stats: {
    triggered: number;
    dmsSent: number;
    failed: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const AutomationRuleSchema = new Schema<IAutomationRule>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    keywords: { type: [String], required: true },
    matchType: { type: String, enum: ['exact', 'contains', 'starts_with', 'regex'], default: 'contains' },
    triggerType: { type: String, enum: ['comment', 'mention', 'story_mention', 'dm'], default: 'comment' },
    targetPosts: { type: [String], default: [] },
    responseMessage: { type: String, required: true, maxlength: 1000 },
    ctaLink: { type: String },
    attachmentUrl: { type: String },
    attachmentType: { type: String, enum: ['pdf', 'image', 'video'] },
    isActive: { type: Boolean, default: true },
    delaySeconds: { type: Number, default: 0 },
    cooldownMinutes: { type: Number, default: 60 },
    sendPublicReply: { type: Boolean, default: false },
    publicReplyMessage: { type: String, maxlength: 500 },
    stats: {
      triggered: { type: Number, default: 0 },
      dmsSent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

AutomationRuleSchema.index({ creatorId: 1, isActive: 1 });

export const AutomationRule = mongoose.model<IAutomationRule>('AutomationRule', AutomationRuleSchema);
