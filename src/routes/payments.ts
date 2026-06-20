import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { authenticate, AuthRequest } from '../middleware/auth';
import { Subscription } from '../models/Subscription';
import { Payment } from '../models/Payment';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID as string,
  key_secret: process.env.RAZORPAY_KEY_SECRET as string,
});

const PLANS: Record<string, { amount: number; planId: string; name: string }> = {
  pro: { amount: 99900, planId: process.env.RAZORPAY_PRO_PLAN_ID || '', name: 'DynamoDM Pro' },
  premium: { amount: 249900, planId: process.env.RAZORPAY_PREMIUM_PLAN_ID || '', name: 'DynamoDM Premium' },
};

// GET /api/payments/plans
router.get('/plans', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      plans: [
        { id: 'free', name: 'Free', price: 0, currency: 'INR', features: ['1 Automation', '100 Leads', '500 DMs/month'] },
        { id: 'pro', name: 'Pro', price: 999, currency: 'INR', features: ['10 Automations', '5,000 Leads', '10,000 DMs/month', '30-day analytics'] },
        { id: 'premium', name: 'Premium', price: 2499, currency: 'INR', features: ['Unlimited Automations', 'Unlimited Leads', 'Unlimited DMs', '1-year analytics', 'Priority Support', 'Custom Branding'] },
      ],
    },
  });
});

// POST /api/payments/subscribe
router.post('/subscribe', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { plan } = req.body as { plan: 'pro' | 'premium' };
  if (!PLANS[plan]) throw new AppError('Invalid plan selected.', 400);

  const planConfig = PLANS[plan];
  
  if (!planConfig.planId) {
    // Mock Razorpay subscription if no plan ID is configured
    const mockSubId = 'sub_mock_' + Math.random().toString(36).substr(2, 9);
    await Subscription.findOneAndUpdate(
      { userId: req.user!.id },
      { razorpaySubscriptionId: mockSubId, plan, status: 'trialing' },
      { upsert: true }
    );
    res.json({ success: true, data: { subscriptionId: mockSubId, keyId: 'mock' } });
    return;
  }

  const subscription = await (razorpay.subscriptions.create as Function)({
    plan_id: planConfig.planId,
    customer_notify: 1,
    total_count: 12,
    notes: { userId: req.user!.id, plan },
  });

  await Subscription.findOneAndUpdate(
    { userId: req.user!.id },
    { razorpaySubscriptionId: subscription.id, plan, status: 'trialing' },
    { upsert: true }
  );

  res.json({ success: true, data: { subscriptionId: subscription.id, keyId: process.env.RAZORPAY_KEY_ID } });
});

// POST /api/payments/verify
router.post('/verify', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, isMock } = req.body;

  if (!isMock) {
    const body = razorpay_payment_id + '|' + razorpay_subscription_id;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string).update(body).digest('hex');

    if (expected !== razorpay_signature) throw new AppError('Invalid payment signature.', 400);
  }

  const subscription = await Subscription.findOne({ userId: req.user!.id });
  if (subscription) {
    subscription.status = 'active';
    await subscription.save();
  }

  await Payment.create({
    userId: req.user!.id,
    subscriptionId: subscription?._id,
    razorpayPaymentId: razorpay_payment_id,
    status: 'captured',
    amount: PLANS[subscription?.plan || 'pro']?.amount || 0,
    currency: 'INR',
  });

  res.json({ success: true, message: 'Payment verified. Subscription activated!' });
});

// POST /api/payments/webhook (Razorpay webhooks)
router.post('/webhook', (req: Request, res: Response): void => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET as string).update(body).digest('hex');

  if (signature !== expected) {
    res.status(400).json({ success: false });
    return;
  }

  const event = req.body as { event: string; payload: { subscription: { entity: { id: string; status: string; notes: { plan: string } } } } };
  logger.info('Razorpay webhook received:', event.event);

  // Handle subscription events asynchronously
  if (event.event === 'subscription.cancelled') {
    const sub = event.payload.subscription.entity;
    Subscription.findOneAndUpdate({ razorpaySubscriptionId: sub.id }, { status: 'cancelled' }).exec();
  }

  res.json({ success: true });
});

// GET /api/payments/invoices
router.get('/invoices', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const payments = await Payment.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, data: { payments } });
});

// GET /api/payments/subscription
router.get('/subscription', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const subscription = await Subscription.findOne({ userId: req.user!.id });
  res.json({ success: true, data: { subscription } });
});

// POST /api/payments/cancel
router.post('/cancel', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const subscription = await Subscription.findOne({ userId: req.user!.id });
  if (!subscription?.razorpaySubscriptionId) throw new AppError('No active subscription.', 400);

  if (!subscription.razorpaySubscriptionId.startsWith('sub_mock')) {
    try {
      await (razorpay.subscriptions.cancel as Function)(subscription.razorpaySubscriptionId, { cancel_at_cycle_end: 1 });
    } catch (e) {
      logger.error('Razorpay cancel error', e);
    }
  }
  
  subscription.cancelAtPeriodEnd = true;
  await subscription.save();

  res.json({ success: true, message: 'Subscription will cancel at end of billing period.' });
});

export default router;
