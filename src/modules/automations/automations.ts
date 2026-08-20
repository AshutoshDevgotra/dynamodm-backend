import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { Automation, IFlowStep } from '../../models/AutomationRule';
import { Subscription } from '../../models/Subscription';
import { AppError } from '../../middleware/errorHandler';

// Local type aliases to keep the POST handler readable
type IAutomationTrigger = {
  type: 'COMMENT' | 'KEYWORD' | 'STORY_REPLY' | 'DM';
  keywords: string[];
  postId?: string;
};
type IAutomationFlowStep = IFlowStep;

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

  let trigger: IAutomationTrigger;
  let flow: IAutomationFlowStep[];

  const {
    name,
    // Flat frontend payload fields
    keyword,
    triggerType,
    targetPosts,
    cooldownMinutes,
    ctaLink,
    delaySeconds,
    matchType,
    publicReplyMessage,
    responseMessage,
    sendPublicReply,
    // Legacy internal format (passed through as-is when present)
    trigger: triggerFromBody,
    flow: flowFromBody,
  } = req.body;

  if (!name) {
    throw new AppError('Automation name is required.', 400);
  }

  if (triggerFromBody && flowFromBody) {
    // ── Legacy internal format: { name, trigger, flow } ──────────────────────
    trigger = triggerFromBody;
    flow = flowFromBody;
  } else {
    // ── Current flat frontend format ─────────────────────────────────────────
    if (!triggerType) {
      throw new AppError('triggerType is required (e.g. "comment", "dm", "story_reply", "keyword").', 400);
    }

    const triggerTypeUpper = (triggerType as string).toUpperCase() as IAutomationTrigger['type'];
    const validTriggerTypes: IAutomationTrigger['type'][] = ['COMMENT', 'KEYWORD', 'STORY_REPLY', 'DM'];
    if (!validTriggerTypes.includes(triggerTypeUpper)) {
      throw new AppError(`Invalid triggerType "${triggerType}". Must be one of: comment, keyword, story_reply, dm.`, 400);
    }

    // keyword is required for COMMENT and KEYWORD trigger types
    if ((triggerTypeUpper === 'COMMENT' || triggerTypeUpper === 'KEYWORD') && !keyword) {
      throw new AppError(`keyword is required when triggerType is "${triggerType}".`, 400);
    }

    if (!responseMessage) {
      throw new AppError('responseMessage is required.', 400);
    }

    // Build trigger from flat fields
    trigger = {
      type: triggerTypeUpper,
      keywords: keyword ? [keyword] : [],
      ...(targetPosts && Array.isArray(targetPosts) && targetPosts.length > 0
        ? { postId: targetPosts[0] }
        : {}),
    };

    // Build the DM message content — append CTA link here so the engine
    // delivers it in the message body (matches dmEngine.ts behaviour)
    let dmContent = responseMessage as string;
    if (ctaLink) dmContent += `\n\n${ctaLink}`;

    // Build flow from flat fields
    const flowSteps: IAutomationFlowStep[] = [];

    // Optional delay step (placed before the DM send)
    const delay = typeof delaySeconds === 'number' ? delaySeconds : 0;
    if (delay > 0) {
      flowSteps.push({ step: 1, type: 'DELAY', delaySeconds: delay });
    }

    flowSteps.push({
      step: flowSteps.length + 1,
      type: 'SEND_DM',
      content: dmContent,
      ...(delay > 0 ? { delaySeconds: delay } : {}),
    });

    flow = flowSteps;
  }

  const automation = await Automation.create({
    creatorId: req.user!.id,
    name,
    trigger,
    flow,
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
