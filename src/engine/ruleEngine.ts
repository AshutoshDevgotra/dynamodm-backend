import { Automation, IAutomation } from '../models/AutomationRule';
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
  id: string;
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

export async function processWebhookEvent(payload: WebhookPayload): Promise<void> {
  const isInstagram = payload.object === 'instagram';
  logger.info(`🔄 Processing webhook event — object: ${payload.object}`);

  for (const entry of payload.entry) {
    const entryId = entry.id;
    const query = isInstagram 
      ? { instagramBusinessId: entryId, isConnected: true }
      : { pageId: entryId, isConnected: true };

    const creatorAccount = await CreatorAccount.findOne(query);
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
            await handleComment(creatorId, creatorAccount.instagramBusinessId!, comment);
          }
        }
      }
    }

    // Process messaging changes
    if (entry.messaging) {
      for (const msg of entry.messaging) {
        if (!msg.message || msg.message.is_echo || !msg.message.text) continue;
        await handleDM(creatorId, creatorAccount.instagramBusinessId!, msg);
      }
    }
  }
}

async function handleComment(creatorId: string, igBusinessId: string, comment: CommentEvent): Promise<void> {
  await AnalyticsEvent.create({
    creatorId,
    eventType: 'comment_received',
    metadata: { commentId: comment.id, from: comment.from, text: comment.text },
    timestamp: new Date(),
  });

  const rules = await Automation.find({ creatorId, isActive: true, 'trigger.type': 'COMMENT' });
  logger.info(`🔍 Found ${rules.length} active COMMENT automation(s) for creator ${creatorId}`);

  for (const rule of rules) {
    // Normalise postId comparison — Meta can return numeric strings
    const rulePostId = rule.trigger.postId ? String(rule.trigger.postId) : null;
    const commentPostId = comment.media?.id ? String(comment.media.id) : null;
    if (rulePostId && commentPostId && rulePostId !== commentPostId) {
      logger.info(`⏭️ Skipping rule ${rule._id} — postId mismatch (rule: ${rulePostId}, comment: ${commentPostId})`);
      continue;
    }

    if (!matchesKeyword(comment.text, rule.trigger.keywords)) {
      logger.info(`⏭️ Skipping rule ${rule._id} — keyword not matched (keywords: ${rule.trigger.keywords}, text: "${comment.text}")`);
      continue;
    }

    logger.info(`✅ Rule ${rule._id} matched for comment from ${comment.from.id}`);

    // ── Redis dedup / cooldown (non-fatal — if Redis is down, proceed anyway) ──
    const redis = getRedis();
    const cooldownKey = `cooldown:${creatorId}:${rule._id}:${comment.from.id}`;
    const duplicateKey = `duplicate:${creatorId}:${comment.id}`;

    try {
      if (await redis.get(duplicateKey)) {
        logger.info(`⏭️ Skipping rule ${rule._id} — duplicate comment ${comment.id}`);
        continue;
      }
      await redis.setex(duplicateKey, 3600, '1');

      if (await redis.get(cooldownKey)) {
        logger.info(`⏭️ Skipping rule ${rule._id} — user ${comment.from.id} is in cooldown`);
        continue;
      }
      await redis.setex(cooldownKey, 60 * 60, '1');
    } catch (redisErr: any) {
      // Redis failure must not block DM delivery — log and continue
      logger.warn(`⚠️ Redis error during cooldown check for rule ${rule._id} — proceeding without dedup`, {
        message: redisErr?.message,
        code: redisErr?.code,
      });
    }

    const sendDmStep = rule.flow.find(step => step.type === 'SEND_DM');
    if (!sendDmStep || !sendDmStep.content) {
      logger.warn(`⚠️ Rule ${rule._id} has no SEND_DM step with content — skipping`);
      continue;
    }

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

    if (!dmQueue) {
      logger.warn('⚠️ DM queue not available (REDIS_URL not set) — skipping DM');
      continue;
    }

    const dmLog = await DMLog.create({
      creatorId, leadId: lead._id, automationRuleId: rule._id,
      instagramUserId: comment.from.id, instagramUsername: comment.from.username,
      messageText: sendDmStep.content, status: 'queued',
    });

    const job = await dmQueue.add('send-dm', {
      dmLogId: dmLog._id.toString(),
      creatorId, igBusinessId,
      recipientId: comment.from.id,
      message: sendDmStep.content,
      attachmentUrl: sendDmStep.attachment,
      automationRuleId: rule._id.toString(),
    }, {
      delay: sendDmStep.delaySeconds ? sendDmStep.delaySeconds * 1000 : 0,
    });

    await DMLog.findByIdAndUpdate(dmLog._id, { jobId: job.id });
    logger.info(`📤 DM job ${job.id} queued for ${comment.from.id} (rule ${rule._id})`);

    await AnalyticsEvent.create({
      creatorId, eventType: 'automation_triggered',
      automationRuleId: rule._id, leadId: lead._id,
      metadata: { keywords: rule.trigger.keywords, commentText: comment.text },
      timestamp: new Date(),
    });
  }
}

async function handleDM(creatorId: string, igBusinessId: string, msg: DMMessage): Promise<void> {
  const fromId = msg.sender.id;
  const messageText = msg.message.text!;
  const messageId = msg.message.mid;

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

    // ── Redis dedup / cooldown (non-fatal) ────────────────────────────────────
    const redis = getRedis();
    const cooldownKey = `cooldown:${creatorId}:${rule._id}:${fromId}`;
    const duplicateKey = `duplicate:${creatorId}:${messageId}`;

    try {
      if (await redis.get(duplicateKey)) {
        logger.info(`⏭️ Skipping rule ${rule._id} — duplicate message ${messageId}`);
        continue;
      }
      await redis.setex(duplicateKey, 3600, '1');

      if (await redis.get(cooldownKey)) {
        logger.info(`⏭️ Skipping rule ${rule._id} — user ${fromId} is in cooldown`);
        continue;
      }
      await redis.setex(cooldownKey, 60 * 60, '1');
    } catch (redisErr: any) {
      logger.warn(`⚠️ Redis error during cooldown check for rule ${rule._id} — proceeding without dedup`, {
        message: redisErr?.message,
        code: redisErr?.code,
      });
    }

    const sendDmStep = rule.flow.find(step => step.type === 'SEND_DM');
    if (!sendDmStep || !sendDmStep.content) {
      logger.warn(`⚠️ Rule ${rule._id} has no SEND_DM step with content — skipping`);
      continue;
    }

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

    if (!dmQueue) {
      logger.warn('⚠️ DM queue not available (REDIS_URL not set) — skipping DM');
      continue;
    }

    const dmLog = await DMLog.create({
      creatorId, leadId: lead._id, automationRuleId: rule._id,
      instagramUserId: fromId, instagramUsername: 'Unknown',
      messageText: sendDmStep.content, status: 'queued',
    });

    const job = await dmQueue.add('send-dm', {
      dmLogId: dmLog._id.toString(),
      creatorId, igBusinessId,
      recipientId: fromId,
      message: sendDmStep.content,
      attachmentUrl: sendDmStep.attachment,
      automationRuleId: rule._id.toString(),
    }, {
      delay: sendDmStep.delaySeconds ? sendDmStep.delaySeconds * 1000 : 0,
    });

    await DMLog.findByIdAndUpdate(dmLog._id, { jobId: job.id });
    logger.info(`📤 DM job ${job.id} queued for ${fromId} (rule ${rule._id})`);

    await AnalyticsEvent.create({
      creatorId, eventType: 'automation_triggered',
      automationRuleId: rule._id, leadId: lead._id,
      metadata: { keywords: rule.trigger.keywords, messageText },
      timestamp: new Date(),
    });
  }
}
