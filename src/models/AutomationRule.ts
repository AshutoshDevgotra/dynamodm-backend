import mongoose, { Document, Schema } from 'mongoose';

export type FlowStepType = 'CHECK_FOLLOW' | 'SEND_DM' | 'DELAY' | 'CONDITION';

export interface IFlowStep {
  step: number;
  type: FlowStepType;
  content?: string;
  attachment?: string;
  fallbackAction?: string;
  delaySeconds?: number;
}

export interface IAutomation extends Document {
  creatorId: mongoose.Types.ObjectId;
  name: string;
  trigger: {
    type: 'COMMENT' | 'KEYWORD' | 'STORY_REPLY' | 'DM';
    keywords: string[];
    postId?: string;
  };
  flow: IFlowStep[];
  publicReply?: {
    enabled: boolean;
    message?: string;
  };
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
    creatorId: { type: Schema.Types.ObjectId, ref: 'CreatorAccount', required: true, index: true },
    name: { type: String, required: true },
    trigger: {
      type: { type: String, enum: ['COMMENT', 'KEYWORD', 'STORY_REPLY', 'DM'], required: true },
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
    }],
    publicReply: {
      enabled: { type: Boolean, default: false },
      message: { type: String },
    },
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
