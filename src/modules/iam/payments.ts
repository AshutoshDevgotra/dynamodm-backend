import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { Subscription } from '../../models/Subscription';
import { Payment } from '../../models/Payment';
import { BrandCampaign } from '../../models/BrandCampaign';
import { Brand } from '../../models/Brand';
import { Transaction } from '../../models/Transaction';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { CheckoutPlan, PLANS, paidPlans } from '../../config/plans';
import { addOneMonth, verifyRazorpaySignature } from '../../utils/razorpay';

const router = Router();

const getRazorpayInstance = (): Razorpay => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (!keyId || !keySecret) {
    throw new AppError('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.', 503);
  }

  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

// Plan definitions — amounts in paise (INR × 100)
// GET /api/payments/plans
router.get('/plans', (_req: Request, res: Response): void => {
  const planDetails = (id: keyof typeof PLANS, name: string) => ({
    id,
    name,
    price: PLANS[id].monthlyPriceInr,
    currency: 'INR',
    interval: 'month',
    limits: {
      automations: PLANS[id].automationLimit,
      leads: PLANS[id].leadsLimit,
      dms: PLANS[id].dmsLimit,
      analyticsRetentionDays: PLANS[id].analyticsRetentionDays,
    },
    features: [
      `${PLANS[id].automationLimit === -1 ? 'Unlimited' : PLANS[id].automationLimit} Automations`,
      `${PLANS[id].leadsLimit === -1 ? 'Unlimited' : PLANS[id].leadsLimit.toLocaleString('en-IN')} Leads`,
      `${PLANS[id].dmsLimit === -1 ? 'Unlimited' : PLANS[id].dmsLimit.toLocaleString('en-IN')} DMs/month`,
      `${PLANS[id].analyticsRetentionDays}-day analytics`,
    ],
    selfServeCheckout: PLANS[id].selfServeCheckout,
  });

  res.json({
    success: true,
    data: {
      plans: [
        planDetails('free', 'Free'),
        planDetails('starter', 'Starter'),
        planDetails('pro', 'Pro'),
        planDetails('premium', 'Premium'),
      ],
    },
  });
});

// POST /api/payments/create-order
// Creates a Razorpay order. Frontend uses this to open the checkout modal.
router.post('/create-order', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  // Preserve the legacy brand-campaign funding API while keeping the creator
  // subscription contract plan-only and server-priced.
  if (req.body?.campaignId) {
    if (req.user!.role.toUpperCase() !== 'BRAND') throw new AppError('Insufficient permissions.', 403);
    const campaign = await BrandCampaign.findOne({ _id: req.body.campaignId, brandId: (await Brand.findOne({ userId: req.user!.id }))?._id });
    if (!campaign) throw new AppError('Campaign not found', 404);
    const amountInr = Number(req.body.amount);
    if (!Number.isFinite(amountInr) || amountInr <= 0) throw new AppError('A valid campaign amount is required.', 400);
    let campaignOrder: any;
    try {
      campaignOrder = await (getRazorpayInstance().orders.create as Function)({ amount: Math.round(amountInr * 100), currency: 'INR', receipt: `camp_${campaign._id}`, notes: { campaignId: campaign._id.toString(), userId: req.user!.id } });
      await Transaction.create({ campaignId: campaign._id, brandId: campaign.brandId, razorpayOrderId: campaignOrder.id, type: 'DEPOSIT', amount: Math.round(amountInr * 100), currency: 'INR', platformFee: 0, netAmount: Math.round(amountInr * 100), status: 'PENDING' });
    } catch (error: any) {
      throw new AppError(error?.error?.description || error?.message || 'Failed to create order', 502);
    }
    res.json({ success: true, data: { orderId: campaignOrder.id, amount: campaignOrder.amount, currency: campaignOrder.currency } });
    return;
  }
  const plan = req.body?.plan as CheckoutPlan;
  if (!paidPlans.includes(plan) || !PLANS[plan].selfServeCheckout) throw new AppError('Invalid plan selected.', 400);
  const planConfig = PLANS[plan];
  const amount = (planConfig.monthlyPriceInr as number) * 100;
  const idempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
  const priorQuery = idempotencyKey
    ? { userId: req.user!.id, idempotencyKey }
    : { userId: req.user!.id, plan, status: 'created', createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) } };
  {
    const prior = await Payment.findOne(priorQuery);
    if (prior?.providerOrderId) {
      res.json({ success: true, data: { orderId: prior.providerOrderId, amount: prior.amount, currency: prior.currency, keyId: process.env.RAZORPAY_KEY_ID, planName: plan[0].toUpperCase() + plan.slice(1) } });
      return;
    }
  }

  let order: any;
  try {
    order = await (getRazorpayInstance().orders.create as Function)({
      amount,
      currency: 'INR',
      receipt: `rcpt_${req.user!.id.slice(-8)}_${Date.now().toString().slice(-8)}`,
      notes: { userId: req.user!.id, plan },
    });
  } catch (razorErr: any) {
    const errMsg = razorErr?.error?.description || razorErr?.message || 'Razorpay order creation failed';
    logger.error(`❌ Razorpay create order error: ${errMsg}`, razorErr?.error);
    throw new AppError(`Payment gateway error: ${errMsg}`, 502);
  }

  await Payment.create({ userId: req.user!.id, plan, provider: 'razorpay', providerOrderId: order.id, razorpayOrderId: order.id, amount, currency: 'INR', status: 'created', ...(idempotencyKey ? { idempotencyKey } : {}) });

  res.json({
    success: true,
    data: {
      orderId: order.id,
      amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
      planName: plan[0].toUpperCase() + plan.slice(1),
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
  if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, process.env.RAZORPAY_KEY_SECRET || '')) {
    logger.warn(`⚠️ Invalid Razorpay payment signature for user ${req.user!.id}`);
    throw new AppError('Invalid payment signature. Payment not verified.', 400);
  }

  const payment = await Payment.findOne({ userId: req.user!.id, providerOrderId: razorpay_order_id });
  if (!payment) throw new AppError('Payment order not found.', 404);
  if (payment.status === 'captured' && payment.providerPaymentId === razorpay_payment_id) {
    const existing = await Subscription.findOne({ userId: req.user!.id });
    res.json({ success: true, data: { plan: payment.plan, status: 'active', currentPeriodEnd: existing?.currentPeriodEnd || null } });
    return;
  }
  if (payment.amount !== (PLANS[payment.plan].monthlyPriceInr as number) * 100 || payment.currency !== 'INR') throw new AppError('Stored payment amount does not match the selected plan.', 409);

  const now = new Date();
  const currentPeriodEnd = addOneMonth(now);
  const subscription = await Subscription.findOneAndUpdate(
    { userId: req.user!.id },
    { userId: req.user!.id, plan: payment.plan, status: 'active', provider: 'razorpay', providerOrderId: razorpay_order_id, providerPaymentId: razorpay_payment_id, startedAt: now, currentPeriodStart: now, currentPeriodEnd, cancelledAt: null, features: { maxAutomations: PLANS[payment.plan].automationLimit, maxLeads: PLANS[payment.plan].leadsLimit, maxDmsPerMonth: PLANS[payment.plan].dmsLimit, analyticsRetentionDays: PLANS[payment.plan].analyticsRetentionDays, prioritySupport: payment.plan !== 'starter', customBranding: payment.plan === 'premium' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  payment.subscriptionId = subscription._id;
  payment.razorpayPaymentId = razorpay_payment_id;
  payment.providerPaymentId = razorpay_payment_id;
  payment.razorpaySignature = razorpay_signature;
  payment.status = 'captured';
  await payment.save();

  logger.info(`✅ Payment verified and subscription activated for user ${req.user!.id} (plan: ${subscription.plan})`);
  res.json({ success: true, data: { plan: subscription.plan, status: 'active', currentPeriodEnd: subscription.currentPeriodEnd } });
});

// POST /api/payments/webhook (Razorpay webhooks — server-side events)
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const body = (req as any).rawBody || JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '').update(body).digest('hex');

  if (!signature || expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
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
      const stored = await Payment.findOne({ providerOrderId: payment.order_id });
      if (stored && stored.status !== 'captured') {
        const now = new Date();
        const subscription = await Subscription.findOneAndUpdate({ userId: stored.userId }, { userId: stored.userId, plan: stored.plan, status: 'active', provider: 'razorpay', providerOrderId: payment.order_id, providerPaymentId: payment.id, startedAt: now, currentPeriodStart: now, currentPeriodEnd: addOneMonth(now) }, { upsert: true, new: true, setDefaultsOnInsert: true });
        stored.subscriptionId = subscription._id;
        stored.providerPaymentId = payment.id;
        stored.razorpayPaymentId = payment.id;
        stored.status = 'captured';
        await stored.save();
      }
    }
  }

  if (event.event === 'payment.failed') {
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id) await Payment.findOneAndUpdate({ providerOrderId: payment.order_id }, { status: 'failed' });
  }

  if (event.event === 'subscription.cancelled') {
    const sub = event.payload?.subscription?.entity;
    if (sub?.id) {
      await Subscription.findOneAndUpdate({ $or: [{ razorpaySubscriptionId: sub.id }, { providerOrderId: sub.id }] }, { status: 'cancelled', cancelledAt: new Date() });
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
