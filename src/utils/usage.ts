import { DMLog } from '../models/DMLog';
import { Lead } from '../models/Lead';
import { Subscription } from '../models/Subscription';
import { PLANS } from '../config/plans';
import { AppError } from '../middleware/errorHandler';

type UsageKind = 'leads' | 'dms';

export async function assertUsageAvailable(userId: string, kind: UsageKind): Promise<void> {
  const subscription = await Subscription.findOne({ userId, status: 'active' });
  if (!subscription || (subscription.currentPeriodEnd && subscription.currentPeriodEnd.getTime() <= Date.now())) {
    throw new AppError('An active subscription is required to use this feature.', 402);
  }
  // Read the entitlement stored on the activated subscription. This keeps
  // enforcement aligned with the exact plan purchased, while the PLANS
  // fallback also supports older subscription documents created before the
  // feature snapshot was introduced.
  const limit = kind === 'leads'
    ? (subscription.features?.maxLeads ?? PLANS[subscription.plan].leadsLimit)
    : (subscription.features?.maxDmsPerMonth ?? PLANS[subscription.plan].dmsLimit);
  if (limit === -1) return;

  // Free usage resets monthly even though the free subscription has no paid billing period.
  const periodStart = subscription.plan === 'free'
    ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    : (subscription.currentPeriodStart || subscription.startedAt || subscription.createdAt);
  const query = { creatorId: userId, createdAt: { $gte: periodStart } };
  const used = kind === 'leads' ? await Lead.countDocuments(query) : await DMLog.countDocuments(query);
  if (used >= limit) {
    throw new AppError(`${kind === 'leads' ? 'Lead' : 'DM'} usage limit exceeded for the current billing period.`, 429);
  }
}
