import { Router, Response } from 'express';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Subscription } from '../models/Subscription';
import { Payment } from '../models/Payment';
import { AutomationRule } from '../models/AutomationRule';
import { Lead } from '../models/Lead';
import { DMLog } from '../models/DMLog';

const router = Router();
router.use(authenticate, requireRole('admin'));

// GET /api/admin/metrics
router.get('/metrics', async (_req: AuthRequest, res: Response): Promise<void> => {
  const [totalUsers, totalCreators, activeSubscriptions, totalRevenue, totalDMs, totalLeads] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'creator' }),
    Subscription.countDocuments({ status: 'active', plan: { $ne: 'free' } }),
    Payment.aggregate([{ $match: { status: 'captured' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    DMLog.countDocuments({ status: 'sent' }),
    Lead.countDocuments(),
  ]);

  res.json({
    success: true,
    data: {
      totalUsers, totalCreators, activeSubscriptions,
      totalRevenue: totalRevenue[0]?.total || 0,
      totalDMs, totalLeads,
    },
  });
});

// GET /api/admin/users
router.get('/users', async (req: AuthRequest, res: Response): Promise<void> => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const search = req.query.search as string | undefined;

  const query: Record<string, unknown> = {};
  if (search) query.$or = [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }];

  const [users, total] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(query),
  ]);

  res.json({ success: true, data: { users, pagination: { page, limit, total } } });
});

// PATCH /api/admin/users/:id/suspend
router.patch('/users/:id/suspend', async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!user) { res.status(404).json({ success: false, message: 'User not found.' }); return; }
  res.json({ success: true, message: 'User suspended.', data: { user } });
});

// PATCH /api/admin/users/:id/activate
router.patch('/users/:id/activate', async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true });
  if (!user) { res.status(404).json({ success: false, message: 'User not found.' }); return; }
  res.json({ success: true, message: 'User activated.', data: { user } });
});

// GET /api/admin/subscriptions
router.get('/subscriptions', async (req: AuthRequest, res: Response): Promise<void> => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const [subs, total] = await Promise.all([
    Subscription.find().populate('userId', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Subscription.countDocuments(),
  ]);
  res.json({ success: true, data: { subscriptions: subs, pagination: { page, limit, total } } });
});

// GET /api/admin/revenue
router.get('/revenue', async (_req: AuthRequest, res: Response): Promise<void> => {
  const monthly = await Payment.aggregate([
    { $match: { status: 'captured' } },
    { $group: { _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } }, revenue: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { '_id.year': -1, '_id.month': -1 } },
    { $limit: 12 },
  ]);
  res.json({ success: true, data: { monthly } });
});

export default router;
