import { createRazorpaySubscription } from './razorpaySubscriptions';

const mockSubscriptionCreate = jest.fn();

jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({
  subscriptions: { create: mockSubscriptionCreate },
})));

describe('createRazorpaySubscription', () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = 'test-key';
    process.env.RAZORPAY_KEY_SECRET = 'test-secret';
    mockSubscriptionCreate.mockReset().mockResolvedValue({ id: 'sub_test' });
  });

  afterAll(() => {
    if (keyId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = keyId;
    if (keySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = keySecret;
  });

  it('sends the subscription end date rather than a billing cycle count or authorization deadline', async () => {
    const startAt = new Date('2026-02-15T12:00:00.000Z');
    const endAt = new Date('2027-01-15T12:00:00.000Z');

    await createRazorpaySubscription({ planId: 'plan_test', startAt, endAt });

    expect(mockSubscriptionCreate).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: 'plan_test',
      start_at: Math.floor(startAt.getTime() / 1000),
      end_at: Math.floor(endAt.getTime() / 1000),
    }));
    expect(mockSubscriptionCreate.mock.calls[0][0]).not.toHaveProperty('total_count');
    expect(mockSubscriptionCreate.mock.calls[0][0]).not.toHaveProperty('expire_by');
  });
});
