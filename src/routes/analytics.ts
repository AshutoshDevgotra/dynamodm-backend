import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AnalyticsEvent } from '../models/AnalyticsEvent';
import { DMLog } from '../models/DMLog';
import { Lead } from '../models/Lead';
import { AutomationRule } from '../models/AutomationRule';

const router = Router();
router.use(authenticate);

// GET /api/analytics/summary
router.get('/summary', async (req: AuthRequest, res: Response): Promise<void> => {
  const creatorId = req.user!.id;
  const days = parseInt(req.query.days as string) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [dmsSent, dmsFailed, leadsTotal, leadsNew, automationsActive] = await Promise.all([
    DMLog.countDocuments({ creatorId, status: 'sent', createdAt: { $gte: since } }),
    DMLog.countDocuments({ creatorId, status: 'failed', createdAt: { $gte: since } }),
    Lead.countDocuments({ creatorId }),
    Lead.countDocuments({ creatorId, createdAt: { $gte: since } }),
    AutomationRule.countDocuments({ creatorId, isActive: true }),
  ]);

  const commentsReceived = await AnalyticsEvent.countDocuments({
    creatorId, eventType: 'comment_received', timestamp: { $gte: since },
  });

  res.json({
    success: true,
    data: {
      dmsSent, dmsFailed, leadsTotal, leadsNew,
      commentsReceived, automationsActive,
      successRate: dmsSent + dmsFailed > 0 ? Math.round((dmsSent / (dmsSent + dmsFailed)) * 100) : 0,
    },
  });
});

// GET /api/analytics/timeseries?metric=dms_sent&days=30
router.get('/timeseries', async (req: AuthRequest, res: Response): Promise<void> => {
  const creatorId = req.user!.id;
  const days = parseInt(req.query.days as string) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const series = await AnalyticsEvent.aggregate([
    { $match: { creatorId: new Object(creatorId), timestamp: { $gte: since } } },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          eventType: '$eventType',
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.date': 1 } },
  ]);

  res.json({ success: true, data: { series } });
});

// GET /api/analytics/top-automations
router.get('/top-automations', async (req: AuthRequest, res: Response): Promise<void> => {
  const automations = await AutomationRule.find({ creatorId: req.user!.id })
    .select('name keyword stats')
    .sort({ 'stats.dmsSent': -1 })
    .limit(10);
  res.json({ success: true, data: { automations } });
});

export default router;
