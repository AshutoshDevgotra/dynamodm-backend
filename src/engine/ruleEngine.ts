import { Automation, IAutomation } from '../models/AutomationRule';
import { CreatorAccount } from '../models/CreatorAccount';
import { Lead } from '../models/Lead';
import { DMLog } from '../models/DMLog';
import { AnalyticsEvent } from '../models/AnalyticsEvent';
import { DMJob } from '../models/DMJob';
import { logger } from '../utils/logger';
import { decryptToken } from '../modules/oauth/instagram';
import { checkFollowerRelationship, publicReplyToComment } from '../lib/instagram';
import crypto from 'crypto';
import { assertUsageAvailable } from '../utils/usage';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface CommentEvent {
  from: { id: string; username?: string };
  text: string;
  id: string;
  media?: { id: string };
}

export interface DMMessage {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: { mid: string; text?: string; is_echo?: boolean };
  postback?: { title?: string; payload: string };
}

type FollowButton = { type: 'web_url' | 'postback'; title: string; url?: string; payload?: string };

function followButtons(ruleId: string, igUsername: string): FollowButton[] {
  return [
    { type: 'web_url', title: 'Follow us', url: `https://www.instagram.com/${igUsername}/` },
    { type: 'postback', title: 'Already followed', payload: `FOLLOW_CHECK:${ruleId}` },
  ];
}

interface WebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes?: Array<{
      value: {
        from?: { id: string; username?: string };
        text?: string;
        id?: string;
        media?: { id: string };
        item?: string;
        verb?: string;
      };
      field: string;
    }>;
    messaging?: DMMessage[];
  }>;
}

function matchesKeyword(text: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return true; // match all
  const normalizedText = text.toLowerCase().trim();
  return keywords.some(keyword => normalizedText.includes(keyword.toLowerCase().trim()));
}

async function aiMatchesComment(text: string, instruction?: string): Promise<boolean> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !instruction?.trim()) return false;
  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(`Return only YES or NO. Does this Instagram comment match the creator's automation intent?\nIntent: ${instruction}\nComment: ${text}`);
    return /^yes\b/i.test(result.response.text().trim());
  } catch (error) {
    logger.warn('AI comment fallback failed; skipping unmatched comment.');
    return false;
  }
}

export async function processWebhookEvent(payload: WebhookPayload): Promise<void> {
  const isInstagram = payload.object === 'instagram';
  logger.info(`🔄 Processing webhook event — object: ${payload.object}`);

  for (const entry of payload.entry) {
    const entryId = entry.id;
    const query = { igUserId: entryId, isConnected: true };

    const creatorAccount = await CreatorAccount.findOne(query).select('+igAccessToken');
    if (!creatorAccount) continue;

    const creatorId = creatorAccount.userId.toString();

    // Process comment changes
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field === 'comments' || change.field === 'feed') {
          const commentData = change.value;
          if ((!commentData.verb || commentData.verb === 'add') && commentData.from && commentData.text) {
            const mediaId = commentData.media?.id || (commentData as any).media_id;
            const comment: CommentEvent = {
              from: commentData.from,
              text: commentData.text,
              id: commentData.id || '',
              media: mediaId ? { id: mediaId } : undefined,
            };
            await handleComment(creatorId, creatorAccount.igUserId!, comment, creatorAccount.igAccessToken, creatorAccount.igUsername);
          }
        }
      }
    }

    // Process messaging changes
    if (entry.messaging) {
      for (const msg of entry.messaging) {
        if (msg.postback?.payload) {
          await handleFollowPostback(creatorId, creatorAccount.igUserId!, msg, creatorAccount.igAccessToken, creatorAccount.igUsername);
          continue;
        }
        if (!msg.message || msg.message.is_echo || !msg.message.text) continue;
        await handleDM(creatorId, creatorAccount.igUserId!, msg, creatorAccount.igAccessToken, creatorAccount.igUsername);
      }
    }
  }
}

async function handleComment(creatorId: string, igUserId: string, comment: CommentEvent, encryptedAccessToken?: string, igUsername?: string): Promise<void> {
  await AnalyticsEvent.create({
    creatorId,
    eventType: 'comment_received',
    metadata: { commentId: comment.id, from: comment.from, text: comment.text },
    timestamp: new Date(),
  });

    const rules = await Automation.find({ creatorId, isActive: true, 'trigger.type': { $in: ['COMMENT', 'LIVE_COMMENT', 'STORY_REPLY'] } });
  logger.info(`🔍 Found ${rules.length} active COMMENT automation(s) for creator ${creatorId}`);

  for (const rule of rules) {
    // Normalise postId comparison — Meta can return numeric strings
    const rulePostId = rule.trigger.postId ? String(rule.trigger.postId) : null;
    const commentPostId = comment.media?.id ? String(comment.media.id) : null;
    if (rulePostId && commentPostId && rulePostId !== commentPostId) {
      logger.info(`⏭️ Skipping rule ${rule._id} — postId mismatch (rule: ${rulePostId}, comment: ${commentPostId})`);
      continue;
    }

    const excluded = rule.excludedKeywords || [];
    if (excluded.some((keyword) => comment.text.toLowerCase().includes(keyword))) continue;
    const keywordMatch = matchesKeyword(comment.text, rule.trigger.keywords);
    const aiMatch = !keywordMatch && rule.aiFallback?.enabled
      ? await aiMatchesComment(comment.text, rule.aiFallback.instruction)
      : false;
    if (!keywordMatch && !aiMatch) {
      logger.info(`⏭️ Skipping rule ${rule._id} — keyword not matched (keywords: ${rule.trigger.keywords}, text: "${comment.text}")`);
      continue;
    }

    logger.info(`✅ Rule ${rule._id} matched for comment from ${comment.from.id}`);

    const jobId = crypto.createHash('sha256').update(`${creatorId}:${rule._id}:${comment.id}`).digest('hex');
    if (comment.id && await DMJob.exists({ jobId })) {
      logger.info(`Skipping duplicate comment event ${comment.id}`);
      continue;
    }

    if (rule.publicReply?.enabled && rule.publicReply.message && comment.id && encryptedAccessToken) {
      try {
        const publicMessages = rule.publicReply.messages?.length ? rule.publicReply.messages : [rule.publicReply.message];
        const index = comment.id.split('').reduce((total, char) => total + char.charCodeAt(0), 0) % publicMessages.length;
        await publicReplyToComment(comment.id, publicMessages[index], decryptToken(encryptedAccessToken));
        logger.info(`✅ Public reply sent for comment ${comment.id}`);
      } catch (publicReplyError: any) {
        logger.error('Public Instagram comment reply failed', publicReplyError?.message || publicReplyError);
      }
    }

    const cooldownSince = new Date(Date.now() - 60 * 60 * 1000);
    const recentDM = await DMLog.exists({
      creatorId,
      automationRuleId: rule._id,
      instagramUserId: comment.from.id,
      status: { $in: ['queued', 'sent'] },
      createdAt: { $gte: cooldownSince },
    });
    if (recentDM) {
      logger.info(`⏭️ Skipping rule ${rule._id} — user ${comment.from.id} is in cooldown`);
      continue;
    }

    const sendDmStep = rule.flow.find(step => step.type === 'SEND_DM' && step.role !== 'PRE_DM');
    const followStep = rule.flow.find(step => step.type === 'CHECK_FOLLOW');
    if (!sendDmStep || !sendDmStep.content) {
      logger.warn(`⚠️ Rule ${rule._id} has no SEND_DM step with content — skipping`);
      continue;
    }

    if (followStep && encryptedAccessToken) {
      const followsCreator = await checkFollowerRelationship(igUserId, comment.from.id, decryptToken(encryptedAccessToken));
      if (!followsCreator) {
        await queueCommentDM({
          creatorId,
          igUserId,
          recipientId: comment.from.id,
          commentId: comment.id,
          rule,
          message: igUsername
            ? `First, follow us to receive the DM\nhttps://www.instagram.com/${igUsername}/`
            : 'First, follow us to receive the DM',
          username: comment.from.username,
          commentText: comment.text,
          postId: comment.media?.id,
          jobId,
          buttons: igUsername ? followButtons(rule._id.toString(), igUsername) : undefined,
        });
        logger.info(`Follow gate held resource DM for ${comment.from.id}`);
        continue;
      }
    }

    for (const [index, preDm] of (rule.preDms || []).entries()) {
      await queueCommentDM({ creatorId, igUserId, recipientId: comment.from.id, commentId: comment.id, rule, message: preDm.message, username: comment.from.username, commentText: comment.text, postId: comment.media?.id, jobId: `${jobId}:pre:${index}` });
    }

    const existingLead = await Lead.exists({ creatorId, instagramUserId: comment.from.id });
    if (!existingLead) await assertUsageAvailable(creatorId, 'leads');
    await assertUsageAvailable(creatorId, 'dms');
    const lead = await Lead.findOneAndUpdate(
      { creatorId, instagramUserId: comment.from.id },
      {
        $setOnInsert: {
          creatorId, instagramUserId: comment.from.id,
          username: comment.from.username, source: 'comment',
          commentText: comment.text, postId: comment.media?.id,
          automationRuleId: rule._id,
        },
      },
      { upsert: true, new: true }
    );

    const dmLog = await DMLog.create({
      creatorId, leadId: lead._id, automationRuleId: rule._id,
      instagramUserId: comment.from.id, instagramUsername: comment.from.username,
      messageText: sendDmStep.content, status: 'queued',
    });

    await DMJob.create({
      jobId,
      dmLogId: dmLog._id.toString(),
      creatorId, igUserId,
      recipientId: comment.from.id,
      commentId: comment.id,
      message: sendDmStep.content,
      attachmentUrl: sendDmStep.attachment,
      automationRuleId: rule._id.toString(),
      nextAttemptAt: new Date(Date.now() + (rule.delaySeconds || sendDmStep.delaySeconds || 0) * 1000),
    });

    await DMLog.findByIdAndUpdate(dmLog._id, { jobId });
    logger.info(`📤 DM job ${jobId} queued for ${comment.from.id} (rule ${rule._id})`);

    await AnalyticsEvent.create({
      creatorId, eventType: 'automation_triggered',
      automationRuleId: rule._id, leadId: lead._id,
      metadata: { keywords: rule.trigger.keywords, commentText: comment.text },
      timestamp: new Date(),
    });
  }
}

async function queueCommentDM(input: {
  creatorId: string;
  igUserId: string;
  recipientId: string;
  commentId?: string;
  rule: IAutomation;
  message: string;
  username?: string;
  commentText: string;
  postId?: string;
  jobId: string;
  buttons?: FollowButton[];
}): Promise<void> {
  const { creatorId, igUserId, recipientId, commentId, rule, message, username, commentText, postId, jobId, buttons } = input;
  const existingLead = await Lead.exists({ creatorId, instagramUserId: recipientId });
  if (!existingLead) await assertUsageAvailable(creatorId, 'leads');
  await assertUsageAvailable(creatorId, 'dms');
  const lead = await Lead.findOneAndUpdate(
    { creatorId, instagramUserId: recipientId },
    { $setOnInsert: { creatorId, instagramUserId: recipientId, username, source: 'comment', commentText, postId, automationRuleId: rule._id } },
    { upsert: true, new: true }
  );
  const dmLog = await DMLog.create({
    creatorId, leadId: lead._id, automationRuleId: rule._id,
    instagramUserId: recipientId, instagramUsername: username,
    messageText: message, status: 'queued',
  });
  await DMJob.create({
    jobId, dmLogId: dmLog._id.toString(), creatorId, igUserId,
    recipientId, commentId, message, buttons, automationRuleId: rule._id.toString(), nextAttemptAt: new Date(),
  });
  await DMLog.findByIdAndUpdate(dmLog._id, { jobId });
}

async function handleFollowPostback(
  creatorId: string,
  igUserId: string,
  msg: DMMessage,
  encryptedAccessToken?: string,
  igUsername?: string,
): Promise<void> {
  const match = msg.postback?.payload.match(/^FOLLOW_CHECK:([a-f0-9]{24})$/i);
  if (!match || !encryptedAccessToken) return;

  const rule = await Automation.findOne({ _id: match[1], creatorId, isActive: true });
  if (!rule || !igUsername) return;

  const followsCreator = await checkFollowerRelationship(igUserId, msg.sender.id, decryptToken(encryptedAccessToken));
  const sendDmStep = rule.flow.find(step => step.type === 'SEND_DM' && step.role !== 'PRE_DM');
  if (!sendDmStep?.content) return;

  const jobId = crypto.randomBytes(16).toString('hex');
  await queueCommentDM({
    creatorId,
    igUserId,
    recipientId: msg.sender.id,
    rule,
    message: followsCreator ? sendDmStep.content : 'You have not followed us. Kindly follow us from this button.',
    commentText: '',
    jobId,
    buttons: followsCreator ? undefined : followButtons(rule._id.toString(), igUsername),
  });
  logger.info(`${followsCreator ? '✅ Follow confirmed; primary DM' : '⏭️ Follow still missing; reminder sent'} for ${msg.sender.id}`);
}

async function handleDM(creatorId: string, igUserId: string, msg: DMMessage, encryptedAccessToken?: string, igUsername?: string): Promise<void> {
  const fromId = msg.sender.id;
  const messageText = msg.message?.text!;
  const messageId = msg.message?.mid || crypto.randomBytes(8).toString('hex');

  await AnalyticsEvent.create({
    creatorId,
    eventType: 'dm_received',
    metadata: { messageId, from: fromId, text: messageText },
    timestamp: new Date(),
  });

  const rules = await Automation.find({ creatorId, isActive: true, 'trigger.type': 'DM' });
  logger.info(`🔍 Found ${rules.length} active DM automation(s) for creator ${creatorId}`);

  for (const rule of rules) {
    if (!matchesKeyword(messageText, rule.trigger.keywords)) {
      logger.info(`⏭️ Skipping rule ${rule._id} — keyword not matched`);
      continue;
    }

      const recentDM = await DMLog.exists({
        creatorId,
        automationRuleId: rule._id,
        instagramUserId: fromId,
        status: { $in: ['queued', 'sent'] },
        createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
      });
      if (recentDM) {
        logger.info(`⏭️ Skipping rule ${rule._id} — user ${fromId} is in cooldown`);
        continue;
    }

    const sendDmStep = rule.flow.find(step => step.type === 'SEND_DM');
    if (!sendDmStep || !sendDmStep.content) {
      logger.warn(`⚠️ Rule ${rule._id} has no SEND_DM step with content — skipping`);
      continue;
    }

    let messageToSend = sendDmStep.content;
    let followsCreator = true;
    const followStep = rule.flow.find(step => step.type === 'CHECK_FOLLOW');
    if (followStep && encryptedAccessToken) {
      followsCreator = await checkFollowerRelationship(igUserId, fromId, decryptToken(encryptedAccessToken));
      if (!followsCreator) messageToSend = 'Follow us.';
    }

    const existingLead = await Lead.exists({ creatorId, instagramUserId: fromId });
    if (!existingLead) await assertUsageAvailable(creatorId, 'leads');
    await assertUsageAvailable(creatorId, 'dms');
    const lead = await Lead.findOneAndUpdate(
      { creatorId, instagramUserId: fromId },
      {
        $setOnInsert: {
          creatorId, instagramUserId: fromId,
          username: 'Unknown', source: 'dm',
          commentText: messageText, automationRuleId: rule._id,
        },
      },
      { upsert: true, new: true }
    );

    const dmLog = await DMLog.create({
      creatorId, leadId: lead._id, automationRuleId: rule._id,
      instagramUserId: fromId, instagramUsername: 'Unknown',
      messageText: messageToSend, status: 'queued',
    });

      const jobId = crypto.createHash('sha256').update(`${creatorId}:${rule._id}:${messageId}`).digest('hex');
      await DMJob.create({
        jobId,
      dmLogId: dmLog._id.toString(),
      creatorId, igUserId,
      recipientId: fromId,
      message: messageToSend,
        buttons: !followsCreator && igUsername ? followButtons(rule._id.toString(), igUsername) : undefined,
      attachmentUrl: sendDmStep.attachment,
      automationRuleId: rule._id.toString(),
        nextAttemptAt: new Date(),
    });

      await DMLog.findByIdAndUpdate(dmLog._id, { jobId });
      logger.info(`📤 DM job ${jobId} queued for ${fromId} (rule ${rule._id})`);

    await AnalyticsEvent.create({
      creatorId, eventType: 'automation_triggered',
      automationRuleId: rule._id, leadId: lead._id,
      metadata: { keywords: rule.trigger.keywords, messageText },
      timestamp: new Date(),
    });
  }
}
