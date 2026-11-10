import Razorpay from 'razorpay';
import { AppError } from '../middleware/errorHandler';
import { PLANS, PlanId } from '../config/plans';
import { logger } from '../utils/logger';

const getClient = (): Razorpay => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) throw new AppError('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.', 503);
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
};

export interface CreatePlanOptions {
  planId: PlanId;
  notes?: Record<string, string | number>;
}

/** Creates a Razorpay Plan using the authoritative application pricing config. */
export async function createRazorpayPlan({ planId, notes }: CreatePlanOptions) {
  const config = PLANS[planId];
  if (config.monthlyPriceInr === null || config.monthlyPriceInr <= 0) throw new AppError(`Plan ${planId} does not have a billable Razorpay price.`, 400);
  try {
    const plan = await (getClient() as any).plans.create({
      period: config.razorpayPeriod,
      interval: config.razorpayInterval,
      item: { name: config.publicName, amount: config.monthlyPriceInr * 100, currency: 'INR', description: config.publicDescription },
      notes: { orangeflowPlanId: planId, ...(notes || {}) },
    });
    logger.info(`Razorpay plan created: ${plan.id} (${config.publicName})`);
    return plan;
  } catch (error: any) {
    logger.error('Razorpay plan creation failed:', error?.error || error);
    throw new AppError(`Razorpay plan creation failed: ${error?.error?.description || error?.message || 'Unknown error'}`, 502);
  }
}

export interface CreateSubscriptionOptions {
  planId: string;
  totalCount: number;
  quantity?: number;
  startAt: Date;
  addons?: Array<{ item: { name: string; amount: number; currency: 'INR'; description?: string }; quantity?: number }>;
  notes?: Record<string, string | number>;
  expireBy?: Date;
  notifyInfo?: { notify_phone?: string; notify_email?: string };
}

/** Creates a Razorpay Subscription and logs the returned subscription ID. */
export async function createRazorpaySubscription(options: CreateSubscriptionOptions) {
  if (!options.planId || options.totalCount < 1 || !Number.isInteger(options.totalCount)) throw new AppError('A valid Razorpay plan ID and billing cycle count are required.', 400);
  try {
    const subscription = await (getClient() as any).subscriptions.create({
      plan_id: options.planId,
      total_count: options.totalCount,
      quantity: options.quantity ?? 1,
      customer_notify: true,
      start_at: Math.floor(options.startAt.getTime() / 1000),
      ...(options.addons?.length ? { addons: options.addons } : {}),
      ...(options.notes ? { notes: options.notes } : {}),
      ...(options.expireBy ? { expire_by: Math.floor(options.expireBy.getTime() / 1000) } : {}),
      ...(options.notifyInfo ? { notify_info: options.notifyInfo } : {}),
    });
    logger.info(`Razorpay subscription created: ${subscription.id} (plan ${options.planId})`);
    return subscription;
  } catch (error: any) {
    logger.error('Razorpay subscription creation failed:', error?.error || error);
    throw new AppError(`Razorpay subscription creation failed: ${error?.error?.description || error?.message || 'Unknown error'}`, 502);
  }
}
