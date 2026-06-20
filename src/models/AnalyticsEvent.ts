import mongoose, { Document, Schema } from 'mongoose';

export type EventType =
  | 'comment_received'
  | 'dm_sent'
  | 'dm_failed'
  | 'lead_captured'
  | 'link_clicked'
  | 'automation_triggered'
  | 'subscription_started'
  | 'subscription_cancelled';

export interface IAnalyticsEvent extends Document {
  creatorId: mongoose.Types.ObjectId;
  eventType: EventType;
  automationRuleId?: mongoose.Types.ObjectId;
  leadId?: mongoose.Types.ObjectId;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

const AnalyticsEventSchema = new Schema<IAnalyticsEvent>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventType: {
      type: String,
      enum: [
        'comment_received',
        'dm_sent',
        'dm_failed',
        'lead_captured',
        'link_clicked',
        'automation_triggered',
        'subscription_started',
        'subscription_cancelled',
      ],
      required: true,
    },
    automationRuleId: { type: Schema.Types.ObjectId, ref: 'AutomationRule' },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

AnalyticsEventSchema.index({ creatorId: 1, eventType: 1, timestamp: -1 });
AnalyticsEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 }); // 1 year TTL

export const AnalyticsEvent = mongoose.model<IAnalyticsEvent>('AnalyticsEvent', AnalyticsEventSchema);
