import crypto from 'crypto';
import { addOneMonth, verifyRazorpaySignature } from './razorpay';

describe('Razorpay helpers', () => {
  it('accepts only a valid server-generated signature', () => {
    const secret = 'test-secret';
    const signature = crypto.createHmac('sha256', secret).update('order_1|pay_1').digest('hex');
    expect(verifyRazorpaySignature('order_1', 'pay_1', signature, secret)).toBe(true);
    expect(verifyRazorpaySignature('order_1', 'pay_1', 'bad', secret)).toBe(false);
  });

  it('sets the subscription period one calendar month from activation', () => {
    expect(addOneMonth(new Date('2026-01-15T00:00:00.000Z')).toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });
});
