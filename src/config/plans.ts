export type PaidPlan = 'starter' | 'pro' | 'premium' | 'enterprise';
export type CheckoutPlan = Exclude<PaidPlan, 'enterprise'>;
export type PlanId = 'free' | PaidPlan;

export interface PlanConfig {
  monthlyPriceInr: number | null;
  razorpayPeriod: 'monthly' | 'weekly' | 'yearly';
  razorpayInterval: number;
  publicName: string;
  publicDescription: string;
  automationLimit: number;
  leadsLimit: number;
  dmsLimit: number;
  analyticsRetentionDays: number;
  selfServeCheckout: boolean;
  instagramAccountsLimit: number;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: { monthlyPriceInr: 0, razorpayPeriod: 'monthly', razorpayInterval: 1, publicName: 'Starter', publicDescription: 'Forever free for creators getting started.', automationLimit: 1, leadsLimit: 100, dmsLimit: 10, analyticsRetentionDays: 7, selfServeCheckout: false, instagramAccountsLimit: 1 },
  // Publicly shown as Creator. Keep the internal ID for existing subscriptions.
  starter: { monthlyPriceInr: 99, razorpayPeriod: 'monthly', razorpayInterval: 1, publicName: 'Creator', publicDescription: '₹0 for the first month, then ₹99/month.', automationLimit: 3, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 30, selfServeCheckout: true, instagramAccountsLimit: 5 },
  pro: { monthlyPriceInr: 499, razorpayPeriod: 'monthly', razorpayInterval: 1, publicName: 'Pro', publicDescription: 'Tailored solutions for growing teams.', automationLimit: 10, leadsLimit: 5000, dmsLimit: 10000, analyticsRetentionDays: 30, selfServeCheckout: true, instagramAccountsLimit: 5 },
  premium: { monthlyPriceInr: 999, razorpayPeriod: 'monthly', razorpayInterval: 1, publicName: 'Premium', publicDescription: 'For power creators who want everything.', automationLimit: -1, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 365, selfServeCheckout: true, instagramAccountsLimit: 5 },
  enterprise: { monthlyPriceInr: null, razorpayPeriod: 'monthly', razorpayInterval: 1, publicName: 'Enterprise', publicDescription: 'Tailored solutions for growing teams.', automationLimit: -1, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 365, selfServeCheckout: false, instagramAccountsLimit: -1 },
};

export const paidPlans = ['starter', 'pro', 'premium', 'enterprise'] as const;
export const isPaidPlan = (plan: string): plan is PaidPlan => paidPlans.includes(plan as PaidPlan);
