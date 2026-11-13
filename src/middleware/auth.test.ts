jest.mock('../models/Subscription', () => ({ Subscription: { findOne: jest.fn() } }));

import { requirePaidSubscription, requireSubscription } from './auth';
import { Subscription } from '../models/Subscription';

const findOne = Subscription.findOne as jest.Mock;
const makeResponse = () => {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

describe('requirePaidSubscription', () => {
  beforeEach(() => findOne.mockReset());

  it('returns the contract 402 response for unpaid users', async () => {
    findOne.mockResolvedValue(null);
    const res = makeResponse();
    const next = jest.fn();
    await requirePaidSubscription({ user: { id: 'u1', role: 'CREATOR' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith({ success: false, code: 'SUBSCRIPTION_REQUIRED', message: 'An active paid subscription is required to use this feature.', data: { redirect: '/creator/payments/subscriptions' } });
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['active', 'trialing'])('allows an active or trialing paid subscription', async (status) => {
    findOne.mockResolvedValue({ plan: 'pro', status, currentPeriodEnd: new Date(Date.now() + 86400000) });
    const req: any = { user: { id: 'u1', role: 'CREATOR' } };
    const res = makeResponse();
    const next = jest.fn();
    await requirePaidSubscription(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.subscription.plan).toBe('pro');
  });

  it.each(['cancelled', 'expired', 'past_due'])('blocks %s subscriptions', async (status) => {
    findOne.mockResolvedValue({ plan: 'premium', status, currentPeriodEnd: new Date(Date.now() + 86400000) });
    const res = makeResponse();
    await requirePaidSubscription({ user: { id: 'u1', role: 'CREATOR' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(402);
  });

  it('blocks a trial after its end date', async () => {
    findOne.mockResolvedValue({ plan: 'starter', status: 'trialing', currentPeriodEnd: new Date(Date.now() - 1) });
    const res = makeResponse();
    await requirePaidSubscription({ user: { id: 'u1', role: 'CREATOR' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(402);
  });

  it('allows trialing users through the general subscription guard', async () => {
    findOne.mockResolvedValue({ plan: 'starter', status: 'trialing', currentPeriodEnd: new Date(Date.now() + 86400000) });
    const next = jest.fn();
    await requireSubscription({ user: { id: 'u1', role: 'CREATOR' } }, makeResponse(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows admins without a subscription', async () => {
    const next = jest.fn();
    await requirePaidSubscription({ user: { id: 'admin', role: 'ADMIN' } }, makeResponse(), next);
    expect(next).toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });
});
