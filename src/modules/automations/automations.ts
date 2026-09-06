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
type IAutomationPublicReply = { enabled: boolean; message?: string };

const router = Router();
router.use(authenticate);

const parseAutomationPayload = (body: any): { name: string; trigger: IAutomationTrigger; flow: IAutomationFlowStep[]; publicReply: IAutomationPublicReply } => {
  const {
    name,
    keyword,
    triggerType,
    targetPosts,
    ctaLink,
    delaySeconds,
    responseMessage,
    trigger: triggerFromBody,
    flow: flowFromBody,
    sendPublicReply,
    publicReplyMessage,
  } = body;

  if (!name) {
    throw new AppError('Automation name is required.', 400);
  }

  if (triggerFromBody && flowFromBody) {
    return {
      name,
      trigger: triggerFromBody,
      flow: flowFromBody,
      publicReply: { enabled: Boolean(sendPublicReply), message: publicReplyMessage || '' },
    };
  }

  if (!triggerType) {
    throw new AppError('triggerType is required (e.g. "comment", "dm", "story_reply", "keyword").', 400);
  }

  const triggerTypeUpper = (triggerType as string).toUpperCase() as IAutomationTrigger['type'];
  const validTriggerTypes: IAutomationTrigger['type'][] = ['COMMENT', 'KEYWORD', 'STORY_REPLY', 'DM'];
  if (!validTriggerTypes.includes(triggerTypeUpper)) {
    throw new AppError(`Invalid triggerType "${triggerType}". Must be one of: comment, keyword, story_reply, dm.`, 400);
  }

  if ((triggerTypeUpper === 'COMMENT' || triggerTypeUpper === 'KEYWORD') && !keyword) {
    throw new AppError(`keyword is required when triggerType is "${triggerType}".`, 400);
  }

  if (!responseMessage) {
    throw new AppError('responseMessage is required.', 400);
  }

  if (sendPublicReply && !publicReplyMessage?.trim()) {
    throw new AppError('publicReplyMessage is required when public replies are enabled.', 400);
  }

  const trigger: IAutomationTrigger = {
    type: triggerTypeUpper,
    keywords: keyword ? (Array.isArray(keyword) ? keyword : [keyword]) : [],
    ...(targetPosts && Array.isArray(targetPosts) && targetPosts.length > 0
      ? { postId: targetPosts[0] }
      : {}),
  };

  let dmContent = responseMessage as string;
  if (ctaLink) dmContent += `\n\n${ctaLink}`;

  const flowSteps: IAutomationFlowStep[] = [];
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

  return {
    name,
    trigger,
    flow: flowSteps,
    publicReply: { enabled: Boolean(sendPublicReply), message: publicReplyMessage || '' },
  };
};

const formatAutomation = (auto: any) => {
  const doc = auto && auto.toObject ? auto.toObject() : auto;
  if (!doc) return auto;
  const sendDmStep = doc.flow?.find((s: any) => s.type === 'SEND_DM');
  const delayStep = doc.flow?.find((s: any) => s.type === 'DELAY' || (s.delaySeconds && s.delaySeconds > 0));

  return {
    ...doc,
    keywords: doc.trigger?.keywords || [],
    triggerType: doc.trigger?.type?.toLowerCase() || 'comment',
    targetPosts: doc.trigger?.postId ? [doc.trigger.postId] : [],
    responseMessage: sendDmStep?.content || '',
    delaySeconds: delayStep?.delaySeconds || 0,
    sendPublicReply: Boolean(doc.publicReply?.enabled),
    publicReplyMessage: doc.publicReply?.message || '',
    matchType: 'contains',
    stats: {
      triggered: doc.stats?.triggeredCount ?? doc.stats?.triggered ?? 0,
      dmsSent: doc.stats?.dmSentCount ?? doc.stats?.dmsSent ?? 0,
      failed: doc.stats?.failed ?? 0,
    },
  };
};

// GET /api/automations
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const automations = await Automation.find({ creatorId: req.user!.id }).sort({ createdAt: -1 });
  res.json({ success: true, data: { automations: automations.map(formatAutomation) } });
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

  const { name, trigger, flow, publicReply } = parseAutomationPayload(req.body);

  const automation = await Automation.create({
    creatorId: req.user!.id,
    name,
    trigger,
    flow,
    publicReply,
  });

  res.status(201).json({ success: true, data: { automation: formatAutomation(automation) } });
});

// GET /api/automations/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const automation = await Automation.findOne({ _id: req.params.id, creatorId: req.user!.id });
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, data: { automation: formatAutomation(automation) } });
});

// PUT /api/automations/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, trigger, flow, publicReply } = parseAutomationPayload(req.body);

  const automation = await Automation.findOneAndUpdate(
    { _id: req.params.id, creatorId: req.user!.id },
    { name, trigger, flow, publicReply },
    { new: true, runValidators: true }
  );
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, data: { automation: formatAutomation(automation) } });
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
