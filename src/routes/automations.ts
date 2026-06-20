import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AutomationRule } from '../models/AutomationRule';
import { Subscription } from '../models/Subscription';
import { AppError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// GET /api/automations
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const automations = await AutomationRule.find({ creatorId: req.user!.id }).sort({ createdAt: -1 });
  res.json({ success: true, data: { automations } });
});

// POST /api/automations
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const subscription = await Subscription.findOne({ userId: req.user!.id });
  const count = await AutomationRule.countDocuments({ creatorId: req.user!.id });
  const maxAutomations = subscription?.features.maxAutomations ?? 1;

  if (maxAutomations !== -1 && count >= maxAutomations) {
    throw new AppError(`Your ${subscription?.plan || 'free'} plan allows ${maxAutomations} automation(s). Upgrade to add more.`, 403);
  }

  let parsedKeywords: string[] = [];
  if (req.body.keywords && Array.isArray(req.body.keywords)) {
    parsedKeywords = req.body.keywords;
  } else if (req.body.keyword) {
    parsedKeywords = req.body.keyword.split(',').map((k: string) => k.trim()).filter(Boolean);
  }

  const { name, matchType, triggerType, targetPosts, responseMessage, ctaLink, attachmentUrl, attachmentType, cooldownMinutes, delaySeconds, sendPublicReply, publicReplyMessage } = req.body;

  if (!name || parsedKeywords.length === 0 || !responseMessage) {
    throw new AppError('Name, keywords, and response message are required.', 400);
  }

  if (triggerType !== 'dm' && (!targetPosts || targetPosts.length === 0)) {
    throw new AppError('Target posts are required for comment automations.', 400);
  }

  const automation = await AutomationRule.create({
    creatorId: req.user!.id,
    name, keywords: parsedKeywords, matchType, triggerType: triggerType || 'comment', targetPosts: targetPosts || [], responseMessage,
    ctaLink, attachmentUrl, attachmentType,
    cooldownMinutes: cooldownMinutes || 60,
    delaySeconds: delaySeconds || 0,
    sendPublicReply: sendPublicReply || false,
    publicReplyMessage,
  });

  res.status(201).json({ success: true, data: { automation } });
});

// GET /api/automations/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const automation = await AutomationRule.findOne({ _id: req.params.id, creatorId: req.user!.id });
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, data: { automation } });
});

// PUT /api/automations/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  let parsedKeywords: string[] | undefined;
  if (req.body.keywords && Array.isArray(req.body.keywords)) {
    parsedKeywords = req.body.keywords;
  } else if (req.body.keyword) {
    parsedKeywords = req.body.keyword.split(',').map((k: string) => k.trim()).filter(Boolean);
  }

  const updateData = { ...req.body };
  if (parsedKeywords) {
    updateData.keywords = parsedKeywords;
  }

  if (updateData.triggerType !== 'dm' && (!updateData.targetPosts || updateData.targetPosts.length === 0)) {
    throw new AppError('Target posts are required for comment automations.', 400);
  }

  const automation = await AutomationRule.findOneAndUpdate(
    { _id: req.params.id, creatorId: req.user!.id },
    updateData,
    { new: true, runValidators: true }
  );
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, data: { automation } });
});

// PATCH /api/automations/:id/toggle
router.patch('/:id/toggle', async (req: AuthRequest, res: Response): Promise<void> => {
  const automation = await AutomationRule.findOne({ _id: req.params.id, creatorId: req.user!.id });
  if (!automation) throw new AppError('Automation not found.', 404);
  automation.isActive = !automation.isActive;
  await automation.save();
  res.json({ success: true, data: { automation, isActive: automation.isActive } });
});

// DELETE /api/automations/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const automation = await AutomationRule.findOneAndDelete({ _id: req.params.id, creatorId: req.user!.id });
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, message: 'Automation deleted successfully.' });
});

export default router;
