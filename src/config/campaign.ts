/**
 * OrangeFlow Diwali Extended Offer — Server-side Campaign Configuration
 * Keep in sync with frontend lib/campaign.ts
 */

export interface CampaignPlanPrice {
  planId: string;
  regularPriceInr: number;
  offerPriceInr: number;
  introductoryCycles: number;
}

export interface ServerCampaignConfig {
  campaignId: string;
  active: boolean;
  endDate: Date | null;
  plans: CampaignPlanPrice[];
}

export const SERVER_CAMPAIGN: ServerCampaignConfig = {
  campaignId: 'diwali-extended-2026',
  active: true,
  endDate: null, // Set to e.g. new Date('2026-11-30T23:59:59+05:30') to expire
  plans: [
    { planId: 'starter', regularPriceInr: 99,  offerPriceInr: 79,  introductoryCycles: 3 },
    { planId: 'pro',     regularPriceInr: 499, offerPriceInr: 299, introductoryCycles: 3 },
    { planId: 'premium', regularPriceInr: 999, offerPriceInr: 699, introductoryCycles: 3 },
  ],
};

/**
 * Returns the offer price for a plan if the campaign is active and not expired.
 * Returns null if the campaign does not apply.
 */
export function getCampaignOfferPrice(planId: string): CampaignPlanPrice | null {
  if (!SERVER_CAMPAIGN.active) return null;
  if (SERVER_CAMPAIGN.endDate && new Date() > SERVER_CAMPAIGN.endDate) return null;
  return SERVER_CAMPAIGN.plans.find((p) => p.planId === planId) ?? null;
}
