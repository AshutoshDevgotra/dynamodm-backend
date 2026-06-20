import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { Lead } from '../models/Lead';

const router = Router();
router.use(authenticate);

// GET /api/leads?page=1&limit=20&source=comment
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const source = req.query.source as string | undefined;
  const search = req.query.search as string | undefined;

  const query: Record<string, unknown> = { creatorId: req.user!.id };
  if (source) query.source = source;
  if (search) query.$or = [{ username: new RegExp(search, 'i') }, { name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }];

  const [leads, total] = await Promise.all([
    Lead.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Lead.countDocuments(query),
  ]);

  res.json({ success: true, data: { leads, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

// GET /api/leads/export
router.get('/export', async (req: AuthRequest, res: Response): Promise<void> => {
  const leads = await Lead.find({ creatorId: req.user!.id }).sort({ createdAt: -1 }).limit(10000);
  const csv = [
    'Username,Name,Email,Phone,Source,Comment,Converted,Date',
    ...leads.map((l) =>
      [l.username, l.name, l.email, l.phone, l.source, l.commentText, l.isConverted, l.createdAt.toISOString()].join(',')
    ),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
  res.send(csv);
});

// GET /api/leads/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const lead = await Lead.findOne({ _id: req.params.id, creatorId: req.user!.id });
  if (!lead) { res.status(404).json({ success: false, message: 'Lead not found.' }); return; }
  res.json({ success: true, data: { lead } });
});

// PUT /api/leads/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, creatorId: req.user!.id },
    { email: req.body.email, notes: req.body.notes, tags: req.body.tags, isConverted: req.body.isConverted },
    { new: true }
  );
  if (!lead) { res.status(404).json({ success: false, message: 'Lead not found.' }); return; }
  res.json({ success: true, data: { lead } });
});

export default router;
