import { AutomationRule, IAutomationRule } from '../models/AutomationRule';
import { CreatorAccount } from '../models/CreatorAccount';
import { Lead } from '../models/Lead';
import { DMLog } from '../models/DMLog';
import { AnalyticsEvent } from '../models/AnalyticsEvent';
import { dmQueue } from '../workers/queues';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';

interface CommentEvent {
  from: { id: string; username?: string };
  text: string;
  id: string; // comment ID
  media?: { id: string };
}

export interface DMMessage {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message: { mid: string; text?: string; is_echo?: boolean };
}

interface WebhookPayload {
  object: string;
  entry: Array<{
    id: string; // Page/IGSID
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

function matchesKeyword(text: string, keywords: string[], matchType: string): boolean {
  const normalizedText = text.toLowerCase().trim();
  
  return keywords.some(keyword => {
    const normalizedKeyword = keyword.toLowerCase().trim();

    switch (matchType) {
      case 'exact':
        return normalizedText === normalizedKeyword;
      case 'contains':
        return normalizedText.includes(normalizedKeyword);
      case 'starts_with':
        return normalizedText.startsWith(normalizedKeyword);
      case 'regex':
        try {
          return new RegExp(keyword, 'i').test(text);
        } catch {
          return false;
        }
      default:
        return normalizedText.includes(normalizedKeyword);
    }
  });
}

export async function processWebhookEvent(payload: WebhookPayload): Promise<void> {
  for (const entry of payload.entry) {
    const pageId = entry.id;

    // Find which creator owns this page
    const creatorAccount = await CreatorAccount.findOne({ pageId, isConnected: true });
    if (!creatorAccount) {
      logger.debug(`No creator found for page ${pageId}`);
      continue;
    }

    const creatorId = creatorAccount.userId.toString();

    // Process comment changes
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field === 'comments' || change.field === 'feed') {
          const commentData = change.value;
          // Instagram comments don't have a 'verb' field, Facebook feeds use 'verb === add'
          if ((!commentData.verb || commentData.verb === 'add') && commentData.from && commentData.text) {
            const comment: CommentEvent = {
              from: commentData.from,
              text: commentData.text,
              id: commentData.id || '',
              media: commentData.media,
            };
            await handleComment(creatorId, creatorAccount.instagramBusinessId!, comment);
          }
        }
      }
    }

    // Process messaging changes (DMs)
    if (entry.messaging) {
      for (const msg of entry.messaging) {
        if (!msg.message || msg.message.is_echo || !msg.message.text) continue;
        
        await handleDM(creatorId, creatorAccount.instagramBusinessId!, msg);
      }
    }
  }
}

async function handleComment(creatorId: string, igBusinessId: string, comment: CommentEvent): Promise<void> {
  // Track comment received
  await AnalyticsEvent.create({
    creatorId,
    eventType: 'comment_received',
    metadata: { commentId: comment.id, from: comment.from, text: comment.text },
    timestamp: new Date(),
  });

  const rules = await AutomationRule.find({ creatorId, isActive: true, triggerType: 'comment' });

  for (const rule of rules) {
    // Filter by target post if specified (Optimization: Check this BEFORE running keyword matching)
    if (rule.targetPosts && rule.targetPosts.length > 0) {
      if (!comment.media || !rule.targetPosts.includes(comment.media.id)) continue;
    }

    // Now check if the comment matches the keywords
    if (!matchesKeyword(comment.text, rule.keywords, rule.matchType)) continue;

    const redis = getRedis();
    const cooldownKey = `cooldown:${creatorId}:${rule._id}:${comment.from.id}`;
    const duplicateKey = `duplicate:${creatorId}:${comment.id}`;

    // Duplicate check — same comment already processed
    const isDuplicate = await redis.get(duplicateKey);
    if (isDuplicate) {
      logger.debug(`Duplicate comment ${comment.id} skipped`);
      continue;
    }
    await redis.setex(duplicateKey, 3600, '1'); // 1 hour TTL

    // Cooldown check — same user within cooldown period
    const inCooldown = await redis.get(cooldownKey);
    if (inCooldown) {
      await DMLog.create({
        creatorId, automationRuleId: rule._id, instagramUserId: comment.from.id,
        instagramUsername: comment.from.username, messageText: rule.responseMessage,
        status: 'skipped_cooldown',
      });
      continue;
    }

    // Set cooldown
    await redis.setex(cooldownKey, rule.cooldownMinutes * 60, '1');

    // Upsert lead
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

    // Create DM log entry
    const dmLog = await DMLog.create({
      creatorId, leadId: lead._id, automationRuleId: rule._id,
      instagramUserId: comment.from.id, instagramUsername: comment.from.username,
      messageText: rule.responseMessage, status: 'queued',
    });

    // Enqueue DM job
    const job = await dmQueue.add('send-dm', {
      dmLogId: dmLog._id.toString(),
      creatorId, igBusinessId,
      recipientId: comment.from.id,
      message: rule.responseMessage,
      ctaLink: rule.ctaLink,
      attachmentUrl: rule.attachmentUrl,
      automationRuleId: rule._id.toString(),
    }, {
      delay: rule.delaySeconds ? rule.delaySeconds * 1000 : 0
    });

    await DMLog.findByIdAndUpdate(dmLog._id, { jobId: job.id });

    // Track automation trigger
    await AnalyticsEvent.create({
      creatorId, eventType: 'automation_triggered',
      automationRuleId: rule._id, leadId: lead._id,
      metadata: { keywords: rule.keywords, commentText: comment.text },
      timestamp: new Date(),
    });

    logger.info(`✅ DM job queued for ${comment.from.username} (rule: ${rule.name})`);
  }
}

async function handleDM(creatorId: string, igBusinessId: string, msg: DMMessage): Promise<void> {
  const fromId = msg.sender.id;
  const messageText = msg.message.text!;
  const messageId = msg.message.mid;

  // Track DM received
  await AnalyticsEvent.create({
    creatorId,
    eventType: 'dm_received',
    metadata: { messageId, from: fromId, text: messageText },
    timestamp: new Date(),
  });

  const rules = await AutomationRule.find({ creatorId, isActive: true, triggerType: 'dm' });

  for (const rule of rules) {
    if (!matchesKeyword(messageText, rule.keywords, rule.matchType)) continue;

    const redis = getRedis();
    const cooldownKey = `cooldown:${creatorId}:${rule._id}:${fromId}`;
    const duplicateKey = `duplicate:${creatorId}:${messageId}`;

    const isDuplicate = await redis.get(duplicateKey);
    if (isDuplicate) {
      logger.debug(`Duplicate DM ${messageId} skipped`);
      continue;
    }
    await redis.setex(duplicateKey, 3600, '1');

    const inCooldown = await redis.get(cooldownKey);
    if (inCooldown) {
      await DMLog.create({
        creatorId, automationRuleId: rule._id, instagramUserId: fromId,
        instagramUsername: 'Unknown', messageText: rule.responseMessage,
        status: 'skipped_cooldown',
      });
      continue;
    }

    await redis.setex(cooldownKey, rule.cooldownMinutes * 60, '1');

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
      messageText: rule.responseMessage, status: 'queued',
    });

    const job = await dmQueue.add('send-dm', {
      dmLogId: dmLog._id.toString(),
      creatorId, igBusinessId,
      recipientId: fromId,
      message: rule.responseMessage,
      ctaLink: rule.ctaLink,
      attachmentUrl: rule.attachmentUrl,
      automationRuleId: rule._id.toString(),
    }, {
      delay: rule.delaySeconds ? rule.delaySeconds * 1000 : 0
    });

    await DMLog.findByIdAndUpdate(dmLog._id, { jobId: job.id });

    await AnalyticsEvent.create({
      creatorId, eventType: 'automation_triggered',
      automationRuleId: rule._id, leadId: lead._id,
      metadata: { keywords: rule.keywords, messageText },
      timestamp: new Date(),
    });

    logger.info(`✅ DM job queued for ${fromId} (rule: ${rule.name})`);
  }
}
