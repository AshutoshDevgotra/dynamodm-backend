import { Router, Response } from 'express';
import { authenticate, requireActiveSubscription, AuthRequest } from '../../middleware/auth';
import { Automation, IFlowStep } from '../../models/AutomationRule';
import { Subscription } from '../../models/Subscription';
import { AppError } from '../../middleware/errorHandler';
import { PLANS } from '../../config/plans';
import { CreatorAccount } from '../../models/CreatorAccount';
import crypto from 'crypto';

// Local type aliases to keep the POST handler readable
type IAutomationTrigger = {
  type: 'COMMENT' | 'KEYWORD' | 'STORY_REPLY' | 'LIVE_COMMENT' | 'DM';
  keywords: string[];
  postId?: string;
};
type IAutomationFlowStep = IFlowStep;
type IAutomationPublicReply = { enabled: boolean; message?: string; messages?: string[] };
type IAutomationParsed = {
  trigger: IAutomationTrigger; flow: IAutomationFlowStep[]; publicReply: IAutomationPublicReply;
  aiFallback?: { enabled: boolean; instruction?: string }; excludedKeywords?: string[]; delaySeconds?: number;
  preDms?: { type: 'FOLLOW' | 'EMAIL'; message: string }[];
  primaryDm?: { type: 'TEXT' | 'TEXT_BUTTON'; buttonLabel?: string; buttonUrl?: string; trackButtonClicks?: boolean };
};

const router = Router();
router.use(authenticate, requireActiveSubscription);

const parseAutomationPayload = (body: any): IAutomationParsed => {
  const {
    name: _name,
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
    requireFollow,
    followRequiredMessage,
    aiFallback,
    aiFallbackInstruction,
    excludedKeywords,
    preDms,
    primaryDmType,
    buttonLabel,
    buttonUrl,
    trackButtonClicks,
  } = body;

  if (triggerFromBody && flowFromBody) {
    const flow = (flowFromBody as IAutomationFlowStep[]).map((step) => ({
      ...step,
      ...(step.delaySeconds !== undefined
        ? { delaySeconds: Math.min(60, Math.max(0, Math.floor(Number(step.delaySeconds) || 0))) }
        : {}),
    }));
    return {
      trigger: triggerFromBody,
      flow,
      publicReply: {
        enabled: Boolean(body.publicReply?.enabled ?? sendPublicReply),
        message: String(body.publicReply?.message ?? publicReplyMessage ?? '').trim(),
        messages: Array.isArray(body.publicReply?.messages ?? body.publicReplyMessages)
          ? (body.publicReply?.messages ?? body.publicReplyMessages).map((message: unknown) => String(message).trim()).filter(Boolean).slice(0, 3)
          : String(body.publicReply?.message ?? publicReplyMessage ?? '').split(/\r?\n/).map((message) => message.trim()).filter(Boolean).slice(0, 3),
      },
    };
  }

  if (!triggerType) {
    throw new AppError('triggerType is required (e.g. "comment", "dm", "story_reply", "keyword").', 400);
  }

  const triggerAlias: Record<string, IAutomationTrigger['type']> = { post_comment: 'COMMENT', comment: 'COMMENT', reel: 'COMMENT', story: 'STORY_REPLY', story_reply: 'STORY_REPLY', live: 'LIVE_COMMENT', live_comment: 'LIVE_COMMENT', dm: 'DM' };
  const triggerTypeUpper = (triggerAlias[String(triggerType).toLowerCase()] || String(triggerType).toUpperCase()) as IAutomationTrigger['type'];
  const validTriggerTypes: IAutomationTrigger['type'][] = ['COMMENT', 'KEYWORD', 'STORY_REPLY', 'LIVE_COMMENT', 'DM'];
  if (!validTriggerTypes.includes(triggerTypeUpper)) {
    throw new AppError(`Invalid triggerType "${triggerType}". Must be one of: comment, keyword, story_reply, dm.`, 400);
  }

  if ((triggerTypeUpper === 'KEYWORD' || triggerTypeUpper === 'LIVE_COMMENT') && !keyword) {
    throw new AppError(`keyword is required when triggerType is "${triggerType}".`, 400);
  }

  if (!responseMessage) {
    throw new AppError('responseMessage is required.', 400);
  }

  const publicReplyEnabled = Boolean(body.publicReply?.enabled ?? sendPublicReply);
  const publicReplyMessages = Array.isArray(body.publicReplyMessages)
    ? body.publicReplyMessages.map((message: unknown) => String(message).trim()).filter(Boolean).slice(0, 3)
    : String(publicReplyMessage ?? (triggerTypeUpper === 'COMMENT' ? 'Check your DM. Link has been sent.' : '')).split(/\r?\n/).map((message) => message.trim()).filter(Boolean).slice(0, 3);
  const publicReplyText = publicReplyMessages[0] || '';
  if (publicReplyEnabled && publicReplyMessages.length < 2) {
    throw new AppError('Add at least 2 public reply variants when public replies are enabled.', 400);
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
  const requestedDelay = Number(delaySeconds);
  const delay = Number.isFinite(requestedDelay) ? Math.min(60, Math.max(0, Math.floor(requestedDelay))) : 0;
  if (delay > 0) {
    flowSteps.push({ step: 1, type: 'DELAY', delaySeconds: delay });
  }

  if (requireFollow ?? true) {
    flowSteps.push({
      step: flowSteps.length + 1,
      type: 'CHECK_FOLLOW',
      content: 'Follow us.',
      fallbackAction: 'SEND_FOLLOW_REQUIRED_DM',
    });
  }

  flowSteps.push({
    step: flowSteps.length + 1,
    type: 'SEND_DM',
    content: dmContent,
    ...(delay > 0 ? { delaySeconds: delay } : {}),
    role: 'PRIMARY',
  });

  return {
    trigger,
    flow: flowSteps,
    publicReply: { enabled: publicReplyEnabled, message: publicReplyText, messages: publicReplyMessages },
    aiFallback: { enabled: Boolean(aiFallback), instruction: String(aiFallbackInstruction || '').trim() },
    excludedKeywords: String(excludedKeywords || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
    delaySeconds: delay,
    preDms: Array.isArray(preDms) ? preDms.slice(0, 2).map((item: any) => ({ type: (item.type === 'EMAIL' ? 'EMAIL' : 'FOLLOW') as 'FOLLOW' | 'EMAIL', message: String(item.message || '').trim() })).filter((item: any) => item.message) : [],
    primaryDm: { type: primaryDmType === 'TEXT_BUTTON' ? 'TEXT_BUTTON' : 'TEXT', buttonLabel: String(buttonLabel || '').trim(), buttonUrl: String(buttonUrl || '').trim(), trackButtonClicks: Boolean(trackButtonClicks) },
  };
};

const AUTOMATION_NAME_PARTS = ['Welcome', 'Growth', 'Inbox', 'Connect', 'Engage', 'Creator', 'Reply', 'Launch'];

async function generateAutomationName(account: { _id: unknown; igUsername?: string }, creatorId: string): Promise<string> {
  const count = await Automation.countDocuments({ creatorId, instagramAccountId: account._id });
  const sequence = String(count + 1).padStart(3, '0');
  const part = AUTOMATION_NAME_PARTS[crypto.randomInt(AUTOMATION_NAME_PARTS.length)];
  return `@${account.igUsername || 'Instagram'} · ${part} Flow ${sequence}`;
}

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
    publicReplyMessages: doc.publicReply?.messages || (doc.publicReply?.message ? [doc.publicReply.message] : []),
    requireFollow: Boolean(doc.flow?.some((s: any) => s.type === 'CHECK_FOLLOW')),
    followRequiredMessage: doc.flow?.find((s: any) => s.type === 'CHECK_FOLLOW')?.content || '',
    aiFallback: Boolean(doc.aiFallback?.enabled),
    aiFallbackInstruction: doc.aiFallback?.instruction || '',
    excludedKeywords: doc.excludedKeywords || [],
    preDms: doc.preDms || [],
    primaryDm: doc.primaryDm || { type: 'TEXT' },
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
  const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('_id igUserId');
  if (!account?.igUserId) {
    res.json({ success: true, data: { automations: [] } });
    return;
  }
  // One-time compatibility migration for rules created before Instagram
  // account binding was stored. It is scoped to this authenticated user, so
  // it cannot expose another user's rules; once bound, account switching will
  // keep the rule attached to its original Instagram account.
  await Automation.updateMany(
    { creatorId: req.user!.id, instagramAccountId: { $exists: false } },
    { $set: { instagramAccountId: account._id, instagramUserId: account.igUserId } },
  );
  const filter: Record<string, unknown> = { creatorId: req.user!.id };
  filter.instagramAccountId = account._id;
  filter.instagramUserId = account.igUserId;
  const automations = await Automation.find(filter).sort({ createdAt: -1 });
  res.json({ success: true, data: { automations: automations.map(formatAutomation) } });
});

// POST /api/automations
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const instagramAccount = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('_id igUserId igUsername');
  if (!instagramAccount) {
    throw new AppError('Connect your Instagram account before creating an automation.', 409);
  }

  const subscription = await Subscription.findOne({ userId: req.user!.id, status: 'active' });

  // Free tier: 1 automation max (no paid subscription)
  const maxAutomations = subscription ? PLANS[subscription.plan].automationLimit : 1;
  const count = await Automation.countDocuments({ creatorId: req.user!.id });

  if (maxAutomations !== -1 && count >= maxAutomations) {
    if (!subscription) {
      throw new AppError('Free plan allows 1 automation. Upgrade to Pro or Premium to add more.', 402);
    }
    throw new AppError(`Your ${subscription.plan} plan allows ${maxAutomations} automation(s). Upgrade to add more.`, 403);
  }

  const parsed = parseAutomationPayload(req.body);

  const automation = await Automation.create({
    creatorId: req.user!.id,
    instagramAccountId: instagramAccount._id,
    instagramUserId: instagramAccount.igUserId,
    name: await generateAutomationName(instagramAccount, req.user!.id),
    ...parsed,
  });

  res.status(201).json({ success: true, data: { automation: formatAutomation(automation) } });
});

// GET /api/automations/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('_id igUserId');
  const automation = await Automation.findOne({ _id: req.params.id, creatorId: req.user!.id, instagramAccountId: account?._id, instagramUserId: account?.igUserId });
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, data: { automation: formatAutomation(automation) } });
});

// PUT /api/automations/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = parseAutomationPayload(req.body);
  const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('_id igUserId');

  const automation = await Automation.findOneAndUpdate(
    { _id: req.params.id, creatorId: req.user!.id, instagramAccountId: account?._id, instagramUserId: account?.igUserId },
    { $set: { ...parsed, ...(account ? { instagramAccountId: account._id, instagramUserId: account.igUserId } : {}) } },
    { new: true, runValidators: true }
  );
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, data: { automation: formatAutomation(automation) } });
});

// PATCH /api/automations/:id/toggle
router.patch('/:id/toggle', async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('_id igUserId');
  const automation = await Automation.findOne({ _id: req.params.id, creatorId: req.user!.id, instagramAccountId: account?._id, instagramUserId: account?.igUserId });
  if (!automation) throw new AppError('Automation not found.', 404);
  automation.isActive = !automation.isActive;
  await automation.save();
  res.json({ success: true, data: { automation, isActive: automation.isActive } });
});

// DELETE /api/automations/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  // Deletion is owned by the authenticated workspace, not by the current
  // Instagram connection. This keeps deletion available after disconnecting
  // or switching the connected Instagram account.
  const automation = await Automation.findOneAndDelete({ _id: req.params.id, creatorId: req.user!.id });
  if (!automation) throw new AppError('Automation not found.', 404);
  res.json({ success: true, message: 'Automation deleted successfully.' });
});

export default router;
