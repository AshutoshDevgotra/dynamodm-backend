export type PaidPlan = 'starter' | 'pro' | 'premium' | 'enterprise';
export type CheckoutPlan = Exclude<PaidPlan, 'enterprise'>;
export type PlanId = 'free' | PaidPlan;

export interface PlanConfig {
  monthlyPriceInr: number | null;
  automationLimit: number;
  leadsLimit: number;
  dmsLimit: number;
  analyticsRetentionDays: number;
  selfServeCheckout: boolean;
  instagramAccountsLimit: number;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: { monthlyPriceInr: 0, automationLimit: 1, leadsLimit: 100, dmsLimit: 10, analyticsRetentionDays: 7, selfServeCheckout: false, instagramAccountsLimit: 1 },
  // Publicly shown as Creator. Keep the internal ID for existing subscriptions.
  starter: { monthlyPriceInr: 99, automationLimit: 3, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 30, selfServeCheckout: true, instagramAccountsLimit: 5 },
  pro: { monthlyPriceInr: 499, automationLimit: 10, leadsLimit: 5000, dmsLimit: 10000, analyticsRetentionDays: 30, selfServeCheckout: true, instagramAccountsLimit: 5 },
  premium: { monthlyPriceInr: 999, automationLimit: -1, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 365, selfServeCheckout: true, instagramAccountsLimit: 5 },
  enterprise: { monthlyPriceInr: null, automationLimit: -1, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 365, selfServeCheckout: false, instagramAccountsLimit: -1 },
};

export const paidPlans = ['starter', 'pro', 'premium', 'enterprise'] as const;
export const isPaidPlan = (plan: string): plan is PaidPlan => paidPlans.includes(plan as PaidPlan);
