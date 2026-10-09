import { PLANS } from './plans';

describe('plan configuration', () => {
  it('keeps checkout prices and usage limits centralized', () => {
    expect(PLANS.pro).toMatchObject({ monthlyPriceInr: 999, automationLimit: 10, leadsLimit: 5000, dmsLimit: 10000, analyticsRetentionDays: 30 });
    expect(PLANS.premium).toMatchObject({ monthlyPriceInr: 2499, automationLimit: -1, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 365 });
    expect(PLANS.enterprise).toMatchObject({ monthlyPriceInr: null, selfServeCheckout: false });
  });
});
