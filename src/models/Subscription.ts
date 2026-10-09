import mongoose, { Document, Schema } from 'mongoose';

import { PLANS, PlanId } from '../config/plans';

export type SubscriptionPlan = PlanId;
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'past_due' | 'trialing' | 'paused';

export interface ISubscription extends Document {
  userId: mongoose.Types.ObjectId;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  razorpaySubscriptionId?: string;
  razorpayCustomerId?: string;
  razorpayPlanId?: string;
  provider: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  startedAt?: Date;
  cancelledAt?: Date;
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

const SubscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    plan: { type: String, enum: ['free', 'pro', 'premium', 'enterprise'], default: 'free' },
    status: { type: String, enum: ['active', 'cancelled', 'expired', 'past_due', 'trialing', 'paused'], default: 'active' },
    provider: { type: String, default: 'manual' },
    providerOrderId: { type: String, index: true },
    providerPaymentId: { type: String, index: true },
    startedAt: { type: Date },
    cancelledAt: { type: Date },
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
    const config = PLANS[this.plan];
    this.features = {
      maxAutomations: config.automationLimit,
      maxLeads: config.leadsLimit,
      maxDmsPerMonth: config.dmsLimit,
      analyticsRetentionDays: config.analyticsRetentionDays,
      prioritySupport: this.plan !== 'free',
      customBranding: this.plan !== 'free',
    };
  }
  next();
});

export const Subscription = mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
