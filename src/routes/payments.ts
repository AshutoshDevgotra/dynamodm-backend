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

// Plan definitions — amounts in paise (INR × 100)
const PLANS: Record<string, { amount: number; name: string; durationDays: number }> = {
  pro: { amount: 99900, name: 'DynamoDM Pro', durationDays: 30 },
  premium: { amount: 249900, name: 'DynamoDM Premium', durationDays: 30 },
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

// POST /api/payments/create-order
// Creates a Razorpay order. Frontend uses this to open the checkout modal.
router.post('/create-order', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { plan } = req.body as { plan: 'pro' | 'premium' };
  if (!PLANS[plan]) throw new AppError('Invalid plan selected.', 400);

  const planConfig = PLANS[plan];

  let order: any;
  try {
    order = await (razorpay.orders.create as Function)({
      amount: planConfig.amount,
      currency: 'INR',
      receipt: `rcpt_${req.user!.id.slice(-8)}_${Date.now().toString().slice(-8)}`,
      notes: { userId: req.user!.id, plan },
    });
  } catch (razorErr: any) {
    const errMsg = razorErr?.error?.description || razorErr?.message || 'Razorpay order creation failed';
    logger.error(`❌ Razorpay create order error: ${errMsg}`, razorErr?.error);
    throw new AppError(`Payment gateway error: ${errMsg}`, 502);
  }

  // Store a pending subscription record so we can look it up on verify
  await Subscription.findOneAndUpdate(
    { userId: req.user!.id },
    {
      userId: req.user!.id,
      plan,
      status: 'paused', // Stays paused until payment is verified
      razorpaySubscriptionId: order.id, // Store order ID here temporarily
    },
    { upsert: true, new: true }
  );

  res.json({
    success: true,
    data: {
      orderId: order.id,
      amount: planConfig.amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
      planName: planConfig.name,
    },
  });
});

// POST /api/payments/verify
// Called by frontend after Razorpay checkout completes. Verifies HMAC and activates subscription.
router.post('/verify', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new AppError('Missing payment verification fields.', 400);
  }

  // Verify HMAC signature — this is tamper-proof, cannot be faked without the key secret
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string)
    .update(body)
    .digest('hex');

  if (expected !== razorpay_signature) {
    logger.warn(`⚠️ Invalid Razorpay payment signature for user ${req.user!.id}`);
    throw new AppError('Invalid payment signature. Payment not verified.', 400);
  }

  // Find the pending subscription for this user
  const subscription = await Subscription.findOne({ userId: req.user!.id, razorpaySubscriptionId: razorpay_order_id });
  if (!subscription) throw new AppError('Subscription record not found. Please contact support.', 404);

  const now = new Date();
  const planConfig = PLANS[subscription.plan];

  // Activate the subscription
  subscription.status = 'active';
  subscription.razorpaySubscriptionId = razorpay_payment_id; // Now store the payment ID
  subscription.currentPeriodStart = now;
  subscription.currentPeriodEnd = new Date(now.getTime() + (planConfig?.durationDays || 30) * 24 * 60 * 60 * 1000);
  await subscription.save();

  // Record the payment
  await Payment.create({
    userId: req.user!.id,
    subscriptionId: subscription._id,
    razorpayPaymentId: razorpay_payment_id,
    status: 'captured',
    amount: planConfig?.amount || 0,
    currency: 'INR',
  });

  logger.info(`✅ Payment verified and subscription activated for user ${req.user!.id} (plan: ${subscription.plan})`);
  res.json({ success: true, message: `Payment verified! ${subscription.plan.toUpperCase()} plan activated.`, data: { plan: subscription.plan } });
});

// POST /api/payments/webhook (Razorpay webhooks — server-side events)
router.post('/webhook', (req: Request, res: Response): void => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const body = (req as any).rawBody || JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET as string).update(body).digest('hex');

  if (signature !== expected) {
    logger.warn('⚠️ Invalid Razorpay webhook signature');
    res.status(400).json({ success: false });
    return;
  }

  const event = req.body as { event: string; payload: any };
  logger.info(`Razorpay webhook: ${event.event}`);

  // Handle payment capture from webhook as backup verification
  if (event.event === 'payment.captured') {
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id) {
      Subscription.findOneAndUpdate(
        { razorpaySubscriptionId: payment.order_id, status: 'paused' },
        { status: 'active', razorpaySubscriptionId: payment.id }
      ).exec();
    }
  }

  if (event.event === 'subscription.cancelled') {
    const sub = event.payload?.subscription?.entity;
    if (sub?.id) {
      Subscription.findOneAndUpdate({ razorpaySubscriptionId: sub.id }, { status: 'cancelled' }).exec();
    }
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
  const subscription = await Subscription.findOne({ userId: req.user!.id, status: 'active' });
  if (!subscription) throw new AppError('No active subscription found.', 400);

  subscription.cancelAtPeriodEnd = true;
  subscription.status = 'cancelled';
  await subscription.save();

  res.json({ success: true, message: 'Subscription cancelled.' });
});

export default router;
