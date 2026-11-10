import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { authenticate, AuthRequest, requireRole } from '../../middleware/auth';
import { Subscription } from '../../models/Subscription';
import { Payment } from '../../models/Payment';
import { BrandCampaign } from '../../models/BrandCampaign';
import { Brand } from '../../models/Brand';
import { Transaction } from '../../models/Transaction';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { CheckoutPlan, PLANS, paidPlans } from '../../config/plans';
import { addOneMonth, verifyRazorpaySignature } from '../../utils/razorpay';
import { getCampaignOfferPrice, SERVER_CAMPAIGN } from '../../config/campaign';
import { createRazorpayPlan, createRazorpaySubscription } from '../../services/razorpaySubscriptions';

const router = Router();

const getRazorpayInstance = (): Razorpay => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (!keyId || !keySecret) {
    throw new AppError('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.', 503);
  }

  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

const getCreatorSubscriptionPlanId = (): string => {
  const planId = process.env.RAZORPAY_CREATOR_SUBSCRIPTION_PLAN_ID?.trim();
  if (!planId) throw new AppError('Creator subscription is not configured. Set RAZORPAY_CREATOR_SUBSCRIPTION_PLAN_ID.', 503);
  return planId;
};

const activateCreatorMandate = async (input: { userId: string; subscriptionId: string; paymentId?: string; status: 'trialing' | 'active'; startAt: Date }) => {
  const subscription = await Subscription.findOneAndUpdate(
    { userId: input.userId },
    { $set: { userId: input.userId, plan: 'starter', status: input.status, provider: 'razorpay', razorpaySubscriptionId: input.subscriptionId, providerOrderId: input.subscriptionId, providerPaymentId: input.paymentId, startedAt: new Date(), trialEnd: input.startAt, currentPeriodStart: input.startAt, currentPeriodEnd: addOneMonth(input.startAt), cancelAtPeriodEnd: false, features: getSubscriptionFeatures('starter') } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );
  if (input.paymentId) {
    await Payment.findOneAndUpdate(
      { userId: input.userId, providerOrderId: input.subscriptionId },
      { $set: { userId: input.userId, subscriptionId: subscription._id, plan: 'starter', provider: 'razorpay', providerOrderId: input.subscriptionId, razorpayOrderId: input.subscriptionId, razorpayPaymentId: input.paymentId, providerPaymentId: input.paymentId, amount: 100, currency: 'INR', status: 'captured', description: 'Creator subscription authorization' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  return subscription;
};

const getSubscriptionFeatures = (plan: CheckoutPlan) => ({
  maxAutomations: PLANS[plan].automationLimit,
  maxLeads: PLANS[plan].leadsLimit,
  maxDmsPerMonth: PLANS[plan].dmsLimit,
  instagramAccountsLimit: PLANS[plan].instagramAccountsLimit,
  analyticsRetentionDays: PLANS[plan].analyticsRetentionDays,
  prioritySupport: plan !== 'starter',
  customBranding: plan === 'premium',
});

const activateCapturedSubscription = async (input: { userId: string; plan: CheckoutPlan; orderId: string; paymentId: string; signature?: string; amount: number; currency: string; campaignId?: string; introductoryPriceInr?: number; regularPriceInr?: number; introductoryCycles?: number }) => {
  // Razorpay can deliver the browser callback and payment.captured webhook at
  // the same time. Preserve the original period for the same order so a retry
  // cannot grant an extra month.
  const existingSubscription = await Subscription.findOne({ userId: input.userId });
  const isSameOrder = existingSubscription?.providerOrderId === input.orderId;
  const now = isSameOrder && existingSubscription?.startedAt ? existingSubscription.startedAt : new Date();
  const currentPeriodStart = isSameOrder && existingSubscription?.currentPeriodStart
    ? existingSubscription.currentPeriodStart
    : now;
  const currentPeriodEnd = isSameOrder && existingSubscription?.currentPeriodEnd
    ? existingSubscription.currentPeriodEnd
    : addOneMonth(now);

  // Track introductory cycle completion — only increment if this is a new order
  const previousCycles = existingSubscription?.completedCycles ?? 0;
  const completedCycles = isSameOrder ? previousCycles : previousCycles + 1;

  const campaignFields = input.campaignId ? {
    campaignId: input.campaignId,
    introductoryPriceInr: input.introductoryPriceInr,
    regularPriceInr: input.regularPriceInr,
    introductoryCycles: input.introductoryCycles,
    completedCycles,
  } : {};

  const subscription = await Subscription.findOneAndUpdate(
    { userId: input.userId },
    { $set: { userId: input.userId, plan: input.plan, status: 'active', provider: 'razorpay', providerOrderId: input.orderId, providerPaymentId: input.paymentId, startedAt: now, currentPeriodStart, currentPeriodEnd, cancelledAt: null, cancelAtPeriodEnd: false, features: getSubscriptionFeatures(input.plan), ...campaignFields } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );

  await Payment.findOneAndUpdate(
    { userId: input.userId, providerOrderId: input.orderId },
    { $set: { userId: input.userId, subscriptionId: subscription._id, plan: input.plan, provider: 'razorpay', providerOrderId: input.orderId, razorpayOrderId: input.orderId, razorpayPaymentId: input.paymentId, providerPaymentId: input.paymentId, ...(input.signature ? { razorpaySignature: input.signature } : {}), amount: input.amount, currency: input.currency, status: 'captured' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return subscription;
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
        { ...planDetails('free', 'Starter'), publicName: 'Starter', description: 'Forever free for creators getting started.' },
        { ...planDetails('starter', 'Creator'), publicName: 'Creator', description: '₹0 for the first month, then ₹99/month.', mandateRequired: true },
        { id: 'enterprise', name: 'Pro', publicName: 'Pro', price: null, currency: 'INR', interval: 'month', description: 'Tailored solutions for growing teams.', limits: { automations: -1, leads: -1, dms: -1, analyticsRetentionDays: 365 }, features: ['Custom landing pages', 'Dedicated Growth Manager', 'Dedicated Ads Manager', 'Dedicated WhatsApp support'], selfServeCheckout: false },
      ],
    },
  });
});

// POST /api/payments/plans/create — one-time admin operation to create and log a Razorpay Plan ID.
router.post('/plans/create', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const planId = String(req.body?.planId || 'starter') as keyof typeof PLANS;
  if (!['starter', 'pro', 'premium'].includes(planId)) throw new AppError('Only billable plan tiers can be created in Razorpay.', 400);
  const plan = await createRazorpayPlan({ planId });
  res.status(201).json({ success: true, data: { planId, razorpayPlanId: plan.id, message: 'Store this Razorpay plan ID as RAZORPAY_CREATOR_SUBSCRIPTION_PLAN_ID when using the Creator plan.' } });
});

// POST /api/payments/create-subscription — ₹1 authorization + one-month trial, then ₹99/month.
router.post('/create-subscription', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await Subscription.findOne({ userId: req.user!.id, status: { $in: ['trialing', 'active'] }, razorpaySubscriptionId: { $exists: true } });
  if (existing?.razorpaySubscriptionId && existing.status === 'active') throw new AppError('A Creator subscription is already active.', 409);
  if (existing?.razorpaySubscriptionId && existing.status === 'trialing') {
    res.json({ success: true, data: { subscriptionId: existing.razorpaySubscriptionId, keyId: process.env.RAZORPAY_KEY_ID, planName: 'Creator', recurringAmountInr: 99, authorizationAmountInr: 1, trialEnd: existing.trialEnd } });
    return;
  }
  const startAt = addOneMonth(new Date());
  let razorpaySubscription: any;
  try {
    razorpaySubscription = await createRazorpaySubscription({
      planId: getCreatorSubscriptionPlanId(), totalCount: 1200, quantity: 1, startAt,
      addons: [{ item: { name: 'Creator subscription authorization', amount: 100, currency: 'INR', description: 'One-time authorization payment for the free first month' } }],
      notes: { userId: req.user!.id, plan: 'starter', trialEnd: startAt.toISOString(), recurringAmountInr: '99' },
    });
  } catch (error: any) {
    const errMsg = error?.error?.description || error?.message || 'Razorpay subscription creation failed';
    logger.error(`Razorpay subscription creation error: ${errMsg}`, error?.error);
    throw new AppError(`Subscription setup failed: ${errMsg}`, 502);
  }
  await activateCreatorMandate({ userId: req.user!.id, subscriptionId: razorpaySubscription.id, status: 'trialing', startAt });
  res.json({ success: true, data: { subscriptionId: razorpaySubscription.id, keyId: process.env.RAZORPAY_KEY_ID, planName: 'Creator', recurringAmountInr: 99, authorizationAmountInr: 1, trialEnd: startAt.toISOString() } });
});

// POST /api/payments/verify-subscription
router.post('/verify-subscription', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body || {};
  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) throw new AppError('Missing subscription verification fields.', 400);
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${razorpay_payment_id}|${razorpay_subscription_id}`).digest('hex');
  if (expected.length !== razorpay_signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature))) throw new AppError('Invalid subscription signature.', 400);
  const razorpaySubscription = await (getRazorpayInstance() as any).subscriptions.fetch(razorpay_subscription_id);
  if (razorpaySubscription?.notes?.userId !== req.user!.id || razorpaySubscription?.plan_id !== getCreatorSubscriptionPlanId()) throw new AppError('Subscription does not belong to this account.', 403);
  const startAt = new Date(Number(razorpaySubscription.start_at) * 1000);
  const subscription = await activateCreatorMandate({ userId: req.user!.id, subscriptionId: razorpay_subscription_id, paymentId: razorpay_payment_id, status: 'trialing', startAt });
  res.json({ success: true, data: { plan: subscription.plan, status: subscription.status, trialEnd: subscription.trialEnd, currentPeriodEnd: subscription.currentPeriodEnd } });
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

  // Apply campaign introductory pricing if eligible
  const campaignOffer = getCampaignOfferPrice(plan);
  const amount = campaignOffer
    ? campaignOffer.offerPriceInr * 100
    : (planConfig.monthlyPriceInr as number) * 100;

  let order: any;
  try {
    order = await (getRazorpayInstance().orders.create as Function)({
      amount,
      currency: 'INR',
      receipt: `rcpt_${req.user!.id.slice(-8)}_${Date.now().toString().slice(-8)}`,
      notes: {
        userId: req.user!.id,
        plan,
        ...(campaignOffer ? {
          campaignId: SERVER_CAMPAIGN.campaignId,
          introductoryPriceInr: String(campaignOffer.offerPriceInr),
          regularPriceInr: String(campaignOffer.regularPriceInr),
          introductoryCycles: String(campaignOffer.introductoryCycles),
        } : {}),
      },
    });
  } catch (razorErr: any) {
    const errMsg = razorErr?.error?.description || razorErr?.message || 'Razorpay order creation failed';
    logger.error(`❌ Razorpay create order error: ${errMsg}`, razorErr?.error);
    throw new AppError(`Payment gateway error: ${errMsg}`, 502);
  }

  res.json({
    success: true,
    data: {
      orderId: order.id,
      amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
      planName: plan[0].toUpperCase() + plan.slice(1),
      // Expose campaign pricing details so the frontend can display correct terms
      campaign: campaignOffer ? {
        campaignId: SERVER_CAMPAIGN.campaignId,
        offerPriceInr: campaignOffer.offerPriceInr,
        regularPriceInr: campaignOffer.regularPriceInr,
        introductoryCycles: campaignOffer.introductoryCycles,
      } : null,
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

  const rzp = getRazorpayInstance() as any;
  const order = await rzp.orders.fetch(razorpay_order_id);
  const plan = order?.notes?.plan as CheckoutPlan;
  if (order?.notes?.userId !== req.user!.id || !paidPlans.includes(plan)) throw new AppError('Payment order does not belong to this account.', 403);
  const settledPayment = await rzp.payments.fetch(razorpay_payment_id);
  if (order?.currency !== 'INR' || settledPayment?.order_id !== razorpay_order_id || settledPayment?.status !== 'captured' || settledPayment?.amount !== order.amount || settledPayment?.currency !== 'INR') {
    throw new AppError('Payment has not been captured and settled by Razorpay.', 402);
  }

  // Extract campaign fields from order notes (set during create-order)
  const campaignArgs = order?.notes?.campaignId ? {
    campaignId: order.notes.campaignId as string,
    introductoryPriceInr: Number(order.notes.introductoryPriceInr),
    regularPriceInr: Number(order.notes.regularPriceInr),
    introductoryCycles: Number(order.notes.introductoryCycles),
  } : {};

  const subscription = await activateCapturedSubscription({ userId: req.user!.id, plan, orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature, amount: order.amount, currency: order.currency, ...campaignArgs });

  logger.info(`✅ Payment verified and subscription activated for user ${req.user!.id} (plan: ${subscription.plan})`);
  res.json({ success: true, data: { plan: subscription.plan, status: 'active', currentPeriodEnd: subscription.currentPeriodEnd } });
});

// POST /api/payments/webhook (Razorpay webhooks — server-side events)
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  const body = (req as any).rawBody || JSON.stringify(req.body);
  const expected = webhookSecret ? crypto.createHmac('sha256', webhookSecret).update(body).digest('hex') : '';

  if (!webhookSecret || !signature || expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
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
      const order = await (getRazorpayInstance() as any).orders.fetch(payment.order_id);
      const plan = order?.notes?.plan as CheckoutPlan;
      const userId = order?.notes?.userId;
      if (userId && paidPlans.includes(plan) && payment.status === 'captured' && payment.amount === order.amount && payment.currency === 'INR') {
        const campaignArgs = order?.notes?.campaignId ? {
          campaignId: order.notes.campaignId as string,
          introductoryPriceInr: Number(order.notes.introductoryPriceInr),
          regularPriceInr: Number(order.notes.regularPriceInr),
          introductoryCycles: Number(order.notes.introductoryCycles),
        } : {};
        await activateCapturedSubscription({ userId, plan, orderId: payment.order_id, paymentId: payment.id, amount: payment.amount, currency: payment.currency, ...campaignArgs });
      }
    }
  }

  if (event.event === 'payment.failed') {
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id) await Payment.findOneAndUpdate({ providerOrderId: payment.order_id }, { status: 'failed' });
  }

  if (['subscription.activated', 'subscription.pending', 'subscription.halted', 'subscription.completed'].includes(event.event)) {
    const sub = event.payload?.subscription?.entity;
    if (sub?.id) {
      const status = event.event === 'subscription.activated' ? 'active'
        : event.event === 'subscription.halted' ? 'past_due'
          : event.event === 'subscription.completed' ? 'expired' : 'trialing';
      await Subscription.findOneAndUpdate(
        { razorpaySubscriptionId: sub.id },
        { $set: { status, ...(sub.current_start ? { currentPeriodStart: new Date(sub.current_start * 1000) } : {}), ...(sub.current_end ? { currentPeriodEnd: new Date(sub.current_end * 1000) } : {}) } },
      );
    }
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
