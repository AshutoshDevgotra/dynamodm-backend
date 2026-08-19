import { Router, Response } from 'express';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth';
import { User } from '../../models/User';
import { Subscription } from '../../models/Subscription';
import { Payment } from '../../models/Payment';
import { Automation } from '../../models/AutomationRule';
import { Lead } from '../../models/Lead';
import { DMLog } from '../../models/DMLog';

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

router.get('/metrics', async (_req: AuthRequest, res: Response): Promise<void> => {
  const [totalUsers, totalCreators, activeSubscriptions, totalRevenue, totalDMs, totalLeads] = await Promise.all([
    User.countDocuments(), User.countDocuments({ role: 'CREATOR' }), Subscription.countDocuments({ status: 'active', plan: { $ne: 'free' } }),
    Payment.aggregate([{ $match: { status: 'captured' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]), DMLog.countDocuments({ status: 'sent' }), Lead.countDocuments(),
  ]);
  res.json({ success: true, data: { totalUsers, totalCreators, activeSubscriptions, totalRevenue: totalRevenue[0]?.total || 0, totalDMs, totalLeads } });
});

router.get('/users', async (req: AuthRequest, res: Response): Promise<void> => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1); const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20)); const search = req.query.search as string | undefined;
  const query: Record<string, unknown> = {}; if (search) { const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); query.$or = [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }]; }
  const [users, total] = await Promise.all([User.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), User.countDocuments(query)]);
  res.json({ success: true, data: { users, pagination: { page, limit, total } } });
});

router.patch('/users/:id/suspend', async (req: AuthRequest, res: Response): Promise<void> => { const user = await User.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true }); if (!user) { res.status(404).json({ success: false, message: 'User not found.' }); return; } res.json({ success: true, message: 'User suspended.', data: { user } }); });
router.patch('/users/:id/activate', async (req: AuthRequest, res: Response): Promise<void> => { const user = await User.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true }); if (!user) { res.status(404).json({ success: false, message: 'User not found.' }); return; } res.json({ success: true, message: 'User activated.', data: { user } }); });
router.get('/subscriptions', async (req: AuthRequest, res: Response): Promise<void> => { const page = Math.max(1, parseInt(req.query.page as string) || 1); const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20)); const [subs, total] = await Promise.all([Subscription.find().populate('userId', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), Subscription.countDocuments()]); res.json({ success: true, data: { subscriptions: subs, pagination: { page, limit, total } } }); });
router.get('/revenue', async (_req: AuthRequest, res: Response): Promise<void> => { const monthly = await Payment.aggregate([{ $match: { status: 'captured' } }, { $group: { _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } }, revenue: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { '_id.year': -1, '_id.month': -1 } }, { $limit: 12 }]); res.json({ success: true, data: { monthly } }); });
export default router;
