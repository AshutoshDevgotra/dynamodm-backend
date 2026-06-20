import mongoose, { Document, Schema } from 'mongoose';

export interface ICampaign extends Document {
  creatorId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  automationRuleIds: mongoose.Types.ObjectId[];
  status: 'active' | 'paused' | 'ended';
  startDate?: Date;
  endDate?: Date;
  postUrl?: string;
  postId?: string;
  metrics: {
    totalTriggers: number;
    totalDmsSent: number;
    totalLeads: number;
    totalClicks: number;
    conversionRate: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    automationRuleIds: [{ type: Schema.Types.ObjectId, ref: 'AutomationRule' }],
    status: { type: String, enum: ['active', 'paused', 'ended'], default: 'active' },
    startDate: { type: Date },
    endDate: { type: Date },
    postUrl: { type: String },
    postId: { type: String },
    metrics: {
      totalTriggers: { type: Number, default: 0 },
      totalDmsSent: { type: Number, default: 0 },
      totalLeads: { type: Number, default: 0 },
      totalClicks: { type: Number, default: 0 },
      conversionRate: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export const Campaign = mongoose.model<ICampaign>('Campaign', CampaignSchema);
