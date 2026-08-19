import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { Automation } from '../../models/AutomationRule';
import { Subscription } from '../../models/Subscription';
import { AppError } from '../../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// GET /api/automations
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const automations = await Automation.find({ creatorId: req.user!.id }).sort({ createdAt: -1 });
  res.json({ success: true, data: { automations } });
});

// POST /api/automations
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const subscription = await Subscription.findOne({ userId: req.user!.id, status: 'active' });

  // Free tier: 1 automation max (no paid subscription)
  const maxAutomations = subscription?.features?.maxAutomations ?? 1;
  const count = await Automation.countDocuments({ creatorId: req.user!.id });

  if (maxAutomations !== -1 && count >= maxAutomations) {
    if (!subscription) {
      throw new AppError('Free plan allows 1 automation. Upgrade to Pro or Premium to add more.', 402);
    }
    throw new AppError(`Your ${subscription.plan} plan allows ${maxAutomations} automation(s). Upgrade to add more.`, 403);
  }

  const { name, trigger, flow } = req.body;

  if (!name || !trigger || !flow) {
    throw new AppError('Name, trigger, and flow are required.', 400);
  }

  const automation = await Automation.create({
    creatorId: req.user!.id,
    name,
    trigger,
    flow
  });

  res.status(201).json({ success: true, data: { automation } });
});

// GET /api/automations/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const automation = await Automation.findOne({ _id: req.params.id, creatorId: req.user!.id });
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, data: { automation } });
});

// PUT /api/automations/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, trigger, flow } = req.body;

  const automation = await Automation.findOneAndUpdate(
    { _id: req.params.id, creatorId: req.user!.id },
    { name, trigger, flow },
    { new: true, runValidators: true }
  );
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, data: { automation } });
});

// PATCH /api/automations/:id/toggle
router.patch('/:id/toggle', async (req: AuthRequest, res: Response): Promise<void> => {
  const automation = await Automation.findOne({ _id: req.params.id, creatorId: req.user!.id });
  if (!automation) throw new AppError('Automation not found.', 404);
  automation.isActive = !automation.isActive;
  await automation.save();
  res.json({ success: true, data: { automation, isActive: automation.isActive } });
});

// DELETE /api/automations/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const automation = await Automation.findOneAndDelete({ _id: req.params.id, creatorId: req.user!.id });
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, message: 'Automation deleted successfully.' });
});

export default router;
