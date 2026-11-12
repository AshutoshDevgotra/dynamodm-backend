import { PLANS } from './plans';

describe('plan configuration', () => {
  it('keeps checkout prices and usage limits centralized', () => {
    expect(PLANS.free).toMatchObject({ monthlyPriceInr: 0, leadsLimit: 10, dmsLimit: -1, instagramAccountsLimit: 1 });
    expect(PLANS.starter).toMatchObject({ monthlyPriceInr: 99, automationLimit: 3, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 30, instagramAccountsLimit: 5 });
    expect(PLANS.pro).toMatchObject({ monthlyPriceInr: 499, automationLimit: 10, leadsLimit: 5000, dmsLimit: 10000, analyticsRetentionDays: 30, selfServeCheckout: false });
    expect(PLANS.premium).toMatchObject({ monthlyPriceInr: 999, automationLimit: -1, leadsLimit: -1, dmsLimit: -1, analyticsRetentionDays: 365, selfServeCheckout: false });
    expect(PLANS.enterprise).toMatchObject({ monthlyPriceInr: null, selfServeCheckout: false, instagramAccountsLimit: 5 });
  });
});
