import mongoose, { Document, Schema } from 'mongoose';

export type FlowStepType = 'CHECK_FOLLOW' | 'SEND_DM' | 'DELAY' | 'CONDITION';

export interface IFlowStep {
  step: number;
  type: FlowStepType;
  content?: string;
  attachment?: string;
  fallbackAction?: string;
  delaySeconds?: number;
  role?: 'PRIMARY' | 'PRE_DM' | 'FOLLOW_GATE';
}

export interface IAutomation extends Document {
  creatorId: mongoose.Types.ObjectId;
  instagramAccountId: mongoose.Types.ObjectId;
  instagramUserId: string;
  name: string;
  trigger: {
    type: 'COMMENT' | 'KEYWORD' | 'STORY_REPLY' | 'LIVE_COMMENT' | 'DM';
    keywords: string[];
    postId?: string;
  };
  flow: IFlowStep[];
  publicReply?: {
    enabled: boolean;
    message?: string;
    messages?: string[];
  };
  aiFallback?: { enabled: boolean; instruction?: string };
  excludedKeywords?: string[];
  delaySeconds?: number;
  preDms?: { type: 'FOLLOW' | 'EMAIL'; message: string }[];
  primaryDm?: { type: 'TEXT' | 'TEXT_BUTTON'; buttonLabel?: string; buttonUrl?: string; trackButtonClicks?: boolean };
  isActive: boolean;
  stats: {
    triggeredCount: number;
    dmSentCount: number;
    conversionCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const AutomationSchema = new Schema<IAutomation>(
  {
    // creatorId is the authenticated User id used by every creator route.
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Keep the connected Instagram identity on the rule as well. This prevents
    // a rule from being reused when an account is switched or reconnected.
    instagramAccountId: { type: Schema.Types.ObjectId, ref: 'CreatorAccount', required: false, index: true },
    instagramUserId: { type: String, required: false, index: true },
    name: { type: String, required: true },
    trigger: {
      type: { type: String, enum: ['COMMENT', 'KEYWORD', 'STORY_REPLY', 'LIVE_COMMENT', 'DM'], required: true },
      keywords: { type: [String], default: [] },
      postId: { type: String }
    },
    flow: [{
      step: { type: Number, required: true },
      type: { type: String, enum: ['CHECK_FOLLOW', 'SEND_DM', 'DELAY', 'CONDITION'], required: true },
      content: { type: String },
      attachment: { type: String },
      fallbackAction: { type: String },
      delaySeconds: { type: Number }
      ,role: { type: String, enum: ['PRIMARY', 'PRE_DM', 'FOLLOW_GATE'] }
    }],
    publicReply: {
      enabled: { type: Boolean, default: false },
      message: { type: String },
      messages: { type: [String], default: [] },
    },
    aiFallback: { enabled: { type: Boolean, default: false }, instruction: { type: String } },
    excludedKeywords: { type: [String], default: [] },
    delaySeconds: { type: Number, default: 0 },
    preDms: [{ type: { type: String, enum: ['FOLLOW', 'EMAIL'] }, message: String }],
    primaryDm: { type: { type: String, enum: ['TEXT', 'TEXT_BUTTON'] }, buttonLabel: String, buttonUrl: String, trackButtonClicks: Boolean },
    isActive: { type: Boolean, default: true },
    stats: {
      triggeredCount: { type: Number, default: 0 },
      dmSentCount: { type: Number, default: 0 },
      conversionCount: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

AutomationSchema.index({ creatorId: 1, isActive: 1 });

export const Automation = mongoose.model<IAutomation>('Automation', AutomationSchema);
