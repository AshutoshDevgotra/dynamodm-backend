import mongoose, { Document, Schema } from 'mongoose';

export type SubscriptionPlan = 'free' | 'pro' | 'premium';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'trialing' | 'paused';

export interface ISubscription extends Document {
  userId: mongoose.Types.ObjectId;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  razorpaySubscriptionId?: string;
  razorpayCustomerId?: string;
  razorpayPlanId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  trialEnd?: Date;
  features: {
    maxAutomations: number;
    maxLeads: number;
    maxDmsPerMonth: number;
    analyticsRetentionDays: number;
    prioritySupport: boolean;
    customBranding: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const planFeatures = {
  free: { maxAutomations: 1, maxLeads: 100, maxDmsPerMonth: 500, analyticsRetentionDays: 7, prioritySupport: false, customBranding: false },
  pro: { maxAutomations: 10, maxLeads: 5000, maxDmsPerMonth: 10000, analyticsRetentionDays: 30, prioritySupport: false, customBranding: false },
  premium: { maxAutomations: -1, maxLeads: -1, maxDmsPerMonth: -1, analyticsRetentionDays: 365, prioritySupport: true, customBranding: true },
};

const SubscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    plan: { type: String, enum: ['free', 'pro', 'premium'], default: 'free' },
    status: { type: String, enum: ['active', 'cancelled', 'past_due', 'trialing', 'paused'], default: 'active' },
    razorpaySubscriptionId: { type: String },
    razorpayCustomerId: { type: String },
    razorpayPlanId: { type: String },
    currentPeriodStart: { type: Date },
    currentPeriodEnd: { type: Date },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    trialEnd: { type: Date },
    features: {
      maxAutomations: { type: Number },
      maxLeads: { type: Number },
      maxDmsPerMonth: { type: Number },
      analyticsRetentionDays: { type: Number },
      prioritySupport: { type: Boolean },
      customBranding: { type: Boolean },
    },
  },
  { timestamps: true }
);

SubscriptionSchema.pre('save', function (next) {
  if (this.isModified('plan')) {
    this.features = planFeatures[this.plan];
  }
  next();
});

export const Subscription = mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
