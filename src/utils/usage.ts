import { DMLog } from '../models/DMLog';
import { Lead } from '../models/Lead';
import { Subscription } from '../models/Subscription';
import { PLANS } from '../config/plans';
import { AppError } from '../middleware/errorHandler';
import { User } from '../models/User';
import { hasUnlimitedAccess } from '../config/access';

type UsageKind = 'leads' | 'dms';

export async function assertUsageAvailable(userId: string, kind: UsageKind): Promise<void> {
  const user = await User.findById(userId).select('email role').lean();
  if (hasUnlimitedAccess(user || undefined)) return;

  const subscription = await Subscription.findOne({ userId, status: 'active' });
  if (!subscription || (subscription.currentPeriodEnd && subscription.currentPeriodEnd.getTime() <= Date.now())) {
    throw new AppError('An active subscription is required to use this feature.', 402);
  }
  // Free-plan changes apply to existing accounts; paid plans retain their purchased entitlement snapshots.
  const plan = PLANS[subscription.plan];
  const features = subscription.plan === 'free' ? undefined : subscription.features;
  const limit = kind === 'leads'
    ? (features?.maxLeads ?? plan.leadsLimit)
    : (features?.maxDmsPerMonth ?? plan.dmsLimit);
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
