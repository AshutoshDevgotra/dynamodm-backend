import { DMLog } from '../models/DMLog';
import { Lead } from '../models/Lead';
import { Subscription } from '../models/Subscription';
import { PLANS } from '../config/plans';
import { AppError } from '../middleware/errorHandler';

type UsageKind = 'leads' | 'dms';

export async function assertUsageAvailable(userId: string, kind: UsageKind): Promise<void> {
  const subscription = await Subscription.findOne({ userId, status: 'active' });
  if (!subscription || !['pro', 'premium', 'enterprise'].includes(subscription.plan) || (subscription.currentPeriodEnd && subscription.currentPeriodEnd.getTime() <= Date.now())) {
    throw new AppError('An active paid subscription is required to use this feature.', 402);
  }
  const limit = kind === 'leads' ? PLANS[subscription.plan].leadsLimit : PLANS[subscription.plan].dmsLimit;
  if (limit === -1) return;

  const periodStart = subscription.currentPeriodStart || subscription.startedAt || subscription.createdAt;
  const query = { creatorId: userId, createdAt: { $gte: periodStart } };
  const used = kind === 'leads' ? await Lead.countDocuments(query) : await DMLog.countDocuments(query);
  if (used >= limit) {
    throw new AppError(`${kind === 'leads' ? 'Lead' : 'DM'} usage limit exceeded for the current billing period.`, 429);
  }
}
