import { Router, Response } from 'express';
import multer from 'multer';
import { authenticate, requireActiveSubscription, AuthRequest } from '../../middleware/auth';
import { Automation, IFlowStep } from '../../models/AutomationRule';
import { AutomationAttachment } from '../../models/AutomationAttachment';
import { Subscription } from '../../models/Subscription';
import { AppError } from '../../middleware/errorHandler';
import { PLANS } from '../../config/plans';
import { CreatorAccount } from '../../models/CreatorAccount';
import crypto from 'crypto';
import { hasUnlimitedAccess } from '../../config/access';

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || 'https://api.v1.orangeflow.in').replace(/\/+$/, '');

function publicAttachmentUrl(id: string, originalName: string): string {
  return `${PUBLIC_API_URL}/api/automations/attachment/public/${id}/${encodeURIComponent(originalName)}`;
}

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
  primaryDm?: {
    type: 'TEXT' | 'TEXT_BUTTON';
    buttonLabel?: string;
    buttonUrl?: string;
    trackButtonClicks?: boolean;
    buttons?: { type: 'web_url'; title: string; url: string }[];
  };
};

const postTargetTriggerTypes: IAutomationTrigger['type'][] = ['COMMENT'];

const normalizeKeywords = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item ?? '').split(','))
    .map((item) => item.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim())
    .filter(Boolean);
};

const router = Router();
// Instagram must be able to fetch media without an Authorization header. The
// id is an unguessable Mongo ObjectId and the route only exposes the uploaded
// attachment itself; automation management and upload remain protected below.
router.get('/attachment/public/:id/:filename?', async (req: AuthRequest, res: Response): Promise<void> => {
  const attachment = await AutomationAttachment.findById(req.params.id);
  if (!attachment) throw new AppError('Attachment not found.', 404);
  res.set('Content-Type', attachment.mimeType);
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(attachment.data);
});

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
    attachmentUrl,
    buttons,
    primaryDm: primaryDmFromBody,
  } = body;

  // Normalise buttons array — up to 3 web_url buttons from the form
  type ButtonDef = { type: 'web_url'; title: string; url: string };
  // Some clients send the composer fields at the top level while older
  // clients send them inside `primaryDm`. Read both shapes before persisting
  // so a DM-triggered rule cannot silently lose its CTA buttons.
  const primaryDmInput = primaryDmFromBody && typeof primaryDmFromBody === 'object' ? primaryDmFromBody : {};
  const rawButtons = Array.isArray(buttons) && buttons.length > 0 ? buttons : primaryDmInput.buttons;
  const rawButtonLabel = buttonLabel ?? primaryDmInput.buttonLabel;
  const rawButtonUrl = buttonUrl ?? primaryDmInput.buttonUrl;
  const rawPrimaryDmType = primaryDmType ?? primaryDmInput.type;
  const normalizedButtons: ButtonDef[] = Array.isArray(rawButtons)
    ? (rawButtons as any[])
        .filter((b) => b?.title?.trim() && b?.url?.trim())
        .slice(0, 3)
        .map((b) => ({ type: 'web_url' as const, title: String(b.title).trim().substring(0, 20), url: String(b.url).trim() }))
    : rawButtonUrl?.trim() && rawButtonLabel?.trim()
    ? [{ type: 'web_url' as const, title: String(rawButtonLabel).trim().substring(0, 20), url: String(rawButtonUrl).trim() }]
    : ctaLink?.trim()
    ? [{ type: 'web_url' as const, title: (rawButtonLabel && String(rawButtonLabel).trim().substring(0, 20)) || 'Open Link', url: String(ctaLink).trim() }]
    : [];

  const parsedPrimaryDm = {
    type: normalizedButtons.length > 0 ? ('TEXT_BUTTON' as const) : (rawPrimaryDmType === 'TEXT_BUTTON' ? ('TEXT_BUTTON' as const) : ('TEXT' as const)),
    buttonLabel: normalizedButtons[0]?.title || String(rawButtonLabel || '').trim().substring(0, 20),
    buttonUrl: normalizedButtons[0]?.url || String(rawButtonUrl || ctaLink || '').trim(),
    trackButtonClicks: Boolean(trackButtonClicks ?? primaryDmInput.trackButtonClicks),
    buttons: normalizedButtons,
  };

  if (triggerFromBody && flowFromBody) {
    const flow = (flowFromBody as IAutomationFlowStep[]).map((step) => ({
      ...step,
      ...(step.delaySeconds !== undefined
        ? { delaySeconds: Math.min(60, Math.max(0, Math.floor(Number(step.delaySeconds) || 0))) }
        : {}),
    }));
    const triggerType = String(triggerFromBody.type || '').toUpperCase() as IAutomationTrigger['type'];
    const normalizedTrigger = {
      ...triggerFromBody,
      type: triggerType,
      keywords: normalizeKeywords(triggerFromBody.keywords),
    };
    if (!(['COMMENT', 'KEYWORD', 'STORY_REPLY', 'LIVE_COMMENT', 'DM'] as string[]).includes(triggerType)) {
      throw new AppError(`Invalid trigger type "${triggerType}".`, 400);
    }
    if (postTargetTriggerTypes.includes(triggerType) && !String(normalizedTrigger.postId || '').trim()) {
      throw new AppError('Select a target post or reel before saving this automation.', 400);
    }
    return {
      trigger: normalizedTrigger,
      flow,
      publicReply: {
        enabled: Boolean(body.publicReply?.enabled ?? sendPublicReply),
        message: String(body.publicReply?.message ?? publicReplyMessage ?? '').trim(),
        messages: Array.isArray(body.publicReply?.messages ?? body.publicReplyMessages)
          ? (body.publicReply?.messages ?? body.publicReplyMessages).map((message: unknown) => String(message).trim()).filter(Boolean).slice(0, 3)
          : String(body.publicReply?.message ?? publicReplyMessage ?? '').split(/\r?\n/).map((message) => message.trim()).filter(Boolean).slice(0, 3),
      },
      aiFallback: { enabled: Boolean(aiFallback), instruction: String(aiFallbackInstruction || '').trim() },
      excludedKeywords: String(excludedKeywords || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
      delaySeconds: Number(delaySeconds) || 0,
      preDms: Array.isArray(preDms) ? preDms.slice(0, 2).map((item: any) => ({ type: (item.type === 'EMAIL' ? 'EMAIL' : 'FOLLOW') as 'FOLLOW' | 'EMAIL', message: String(item.message || '').trim() })).filter((item: any) => item.message) : [],
      primaryDm: parsedPrimaryDm,
    };
  }

  if (!triggerType) {
    throw new AppError('triggerType is required (e.g. "comment", "dm", "story_reply", "keyword").', 400);
  }

  const triggerAlias: Record<string, IAutomationTrigger['type']> = { post_comment: 'COMMENT', comment: 'COMMENT', reel: 'COMMENT', story: 'STORY_REPLY', story_reply: 'STORY_REPLY', live: 'LIVE_COMMENT', live_comment: 'LIVE_COMMENT', dm: 'DM' };
  const triggerTypeUpper = (triggerAlias[String(triggerType).toLowerCase()] || String(triggerType).toUpperCase()) as IAutomationTrigger['type'];
  const validTriggerTypes: IAutomationTrigger['type'][] = ['COMMENT', 'KEYWORD', 'STORY_REPLY', 'LIVE_COMMENT', 'DM'];
  if (!validTriggerTypes.includes(triggerTypeUpper)) {
    throw new AppError(`Invalid triggerType "${triggerType}". Choose post/reel comments, live comments, story replies, or direct messages.`, 400);
  }

  if (normalizeKeywords(keyword).length === 0) {
    throw new AppError('Add at least one trigger word before saving this automation.', 400);
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

  const selectedTargetPost = targetPosts && Array.isArray(targetPosts) ? String(targetPosts[0] || '').trim() : '';
  if (postTargetTriggerTypes.includes(triggerTypeUpper) && !selectedTargetPost) {
    throw new AppError('Select a target post or reel before saving this automation.', 400);
  }

  const trigger: IAutomationTrigger = {
    type: triggerTypeUpper,
    keywords: normalizeKeywords(keyword),
    ...(selectedTargetPost
      ? { postId: selectedTargetPost }
      : {}),
  };

  // Only bake ctaLink into the message text when no interactive buttons are
  // configured. When buttons are present, the URL lives inside the button
  // payload — appending it to the text would cause Instagram to send the
  // URL as plain text instead of rendering the button template.
  const hasButtons = Array.isArray(buttons)
    ? (buttons as any[]).some((b) => b?.title?.trim() && b?.url?.trim())
    : Boolean(buttonUrl?.trim() && buttonLabel?.trim());
  let dmContent = responseMessage as string;
  if (ctaLink && !hasButtons) dmContent += `\n\n${ctaLink}`;

  const flowSteps: IAutomationFlowStep[] = [];
  const requestedDelay = Number(delaySeconds);
  const delay = Number.isFinite(requestedDelay) ? Math.min(60, Math.max(0, Math.floor(requestedDelay))) : 0;
  if (delay > 0) {
    flowSteps.push({ step: 1, type: 'DELAY', delaySeconds: delay });
  }

  if (Boolean(requireFollow)) {
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
    ...(attachmentUrl?.trim() ? { attachment: String(attachmentUrl).trim() } : {}),
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
    primaryDm: parsedPrimaryDm,
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
    stats: {
      triggered: doc.stats?.triggeredCount ?? doc.stats?.triggered ?? 0,
      dmsSent: doc.stats?.dmSentCount ?? doc.stats?.dmsSent ?? 0,
      failed: doc.stats?.failed ?? 0,
    },
  };
};

// GET /api/automations
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const requestedAccountId = typeof req.query.instagramAccountId === 'string' ? req.query.instagramAccountId : '';
  const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true, ...(requestedAccountId ? { _id: requestedAccountId } : {}) }).select('_id igUserId');
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
  const requestedAccountId = typeof req.body?.instagramAccountId === 'string' ? req.body.instagramAccountId : '';
  const instagramAccount = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true, ...(requestedAccountId ? { _id: requestedAccountId } : {}) }).select('_id igUserId igUsername');
  if (!instagramAccount) {
    throw new AppError('Connect your Instagram account before creating an automation.', 409);
  }

  const subscription = await Subscription.findOne({ userId: req.user!.id, status: 'active' });

  // Free tier: 1 automation max (no paid subscription)
  const maxAutomations = subscription ? PLANS[subscription.plan].automationLimit : 1;
  const count = await Automation.countDocuments({ creatorId: req.user!.id });

  if (!hasUnlimitedAccess(req.user) && maxAutomations !== -1 && count >= maxAutomations) {
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

// POST /api/automations/attachment — upload a PDF or image for use in a DM
router.post('/attachment', attachmentUpload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) throw new AppError('No file uploaded or file type not allowed (PDF, JPEG, PNG, GIF, WEBP, max 10 MB).', 400);
  const attachment = await AutomationAttachment.create({
    creatorId: req.user!.id,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    data: req.file.buffer,
  });
  res.status(201).json({
    success: true,
    data: {
      attachmentId: attachment._id.toString(),
      name: attachment.originalName,
      size: attachment.size,
      mimeType: attachment.mimeType,
      url: publicAttachmentUrl(attachment._id.toString(), attachment.originalName),
    },
  });
});

// GET /api/automations/attachment/:id — serve the file (authenticated; same creator only)
router.get('/attachment/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const attachment = await AutomationAttachment.findOne({ _id: req.params.id, creatorId: req.user!.id });
  if (!attachment) throw new AppError('Attachment not found.', 404);
  res.set('Content-Type', attachment.mimeType);
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(attachment.data);
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
