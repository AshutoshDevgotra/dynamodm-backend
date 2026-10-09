export type PaidPlan = 'pro' | 'premium' | 'enterprise';
export type PlanId = 'free' | PaidPlan;

export interface PlanConfig {
  monthlyPriceInr: number | null;
  automationLimit: number;
  leadsLimit: number;
  dmsLimit: number;
  analyticsRetentionDays: number;
  selfServeCheckout: boolean;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: { monthlyPriceInr: 0, automationLimit: 1, leadsLimit: 100, dmsLimit: 500, analyticsRetentionDays: 7, selfServeCheckout: false },
  pro: { monthlyPriceInr: 999, automationLimit: 10, leadsLimit: 5000, dmsLimit: 10000, analyticsRetentionDays: 30, selfServeCheckout: true },
  premium: { monthlyPriceInr: 2499, automationLimit: -1, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 365, selfServeCheckout: true },
  enterprise: { monthlyPriceInr: null, automationLimit: -1, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 365, selfServeCheckout: false },
};

export const paidPlans = ['pro', 'premium', 'enterprise'] as const;
export const isPaidPlan = (plan: string): plan is PaidPlan => paidPlans.includes(plan as PaidPlan);
