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
  const isInstagram = payload.object === 'instagram';
  logger.info(`🔄 Processing webhook event — object: ${payload.object}, entries: ${payload.entry.length}`);

  for (const entry of payload.entry) {
    const entryId = entry.id;
    logger.info(`📋 Processing entry ${entryId}`, {
      hasChanges: !!(entry.changes && entry.changes.length > 0),
      changeCount: entry.changes?.length || 0,
      hasMessaging: !!(entry.messaging && entry.messaging.length > 0),
      messagingCount: entry.messaging?.length || 0,
    });

    // Find which creator owns this account
    const query = isInstagram 
      ? { instagramBusinessId: entryId, isConnected: true }
      : { pageId: entryId, isConnected: true };

    const creatorAccount = await CreatorAccount.findOne(query);
    if (!creatorAccount) {
      logger.warn(`⚠️ No creator found for entry ${entryId} (object: ${payload.object}) — query: ${JSON.stringify(query)}`);
      continue;
    }

    const creatorId = creatorAccount.userId.toString();
    logger.info(`✅ Found creator ${creatorId} (IG: ${creatorAccount.instagramBusinessId}) for entry ${entryId}`);

    // Process comment changes
    if (entry.changes) {
      for (const change of entry.changes) {
        logger.info(`📝 Processing change field: '${change.field}'`, {
          hasFrom: !!change.value?.from,
          hasText: !!change.value?.text,
          verb: change.value?.verb,
          item: change.value?.item,
          mediaId: change.value?.media?.id || (change.value as any)?.media_id,
          fullValue: JSON.stringify(change.value).slice(0, 500),
        });

        if (change.field === 'comments' || change.field === 'feed') {
          const commentData = change.value;
          // Instagram comments don't have a 'verb' field, Facebook feeds use 'verb === add'
          if ((!commentData.verb || commentData.verb === 'add') && commentData.from && commentData.text) {
            // Robust media ID extraction — handles both media.id (object) and media_id (flat string)
            const mediaId = commentData.media?.id || (commentData as any).media_id;
            const comment: CommentEvent = {
              from: commentData.from,
              text: commentData.text,
              id: commentData.id || '',
              media: mediaId ? { id: mediaId } : undefined,
            };
            logger.info(`💬 Comment detected: "${comment.text}" from ${comment.from.username || comment.from.id} on media ${mediaId || 'unknown'}`);
            await handleComment(creatorId, creatorAccount.instagramBusinessId!, comment);
          } else {
            logger.info(`⏭️ Skipping change: verb=${commentData.verb}, hasFrom=${!!commentData.from}, hasText=${!!commentData.text}`);
          }
        } else {
          logger.info(`⏭️ Ignoring change field '${change.field}' (expected 'comments' or 'feed')`);
        }
      }
    }

    // Process messaging changes (DMs)
    if (entry.messaging) {
      for (const msg of entry.messaging) {
        if (!msg.message || msg.message.is_echo || !msg.message.text) {
          logger.debug(`⏭️ Skipping messaging event: no message, is_echo, or no text`);
          continue;
        }
        
        logger.info(`📨 DM received from ${msg.sender.id}: "${msg.message.text}"`);
        await handleDM(creatorId, creatorAccount.instagramBusinessId!, msg);
      }
    }
  }
}

async function handleComment(creatorId: string, igBusinessId: string, comment: CommentEvent): Promise<void> {
  logger.info(`🔍 handleComment called for creator ${creatorId}`, {
    commentId: comment.id,
    from: comment.from,
    text: comment.text,
    mediaId: comment.media?.id,
  });

  // Track comment received
  await AnalyticsEvent.create({
    creatorId,
    eventType: 'comment_received',
    metadata: { commentId: comment.id, from: comment.from, text: comment.text },
    timestamp: new Date(),
  });

  const rules = await AutomationRule.find({ creatorId, isActive: true, triggerType: 'comment' });
  logger.info(`📋 Found ${rules.length} active comment automation rules for creator ${creatorId}`);

  if (rules.length === 0) {
    logger.warn(`⚠️ No active comment automations for creator ${creatorId} — comment will not trigger any DM`);
    return;
  }

  for (const rule of rules) {
    logger.info(`🔄 Checking rule: "${rule.name}" (ID: ${rule._id})`, {
      keywords: rule.keywords,
      matchType: rule.matchType,
      targetPosts: rule.targetPosts,
      targetPostCount: rule.targetPosts?.length || 0,
    });

    // Filter by target post if specified
    if (rule.targetPosts && rule.targetPosts.length > 0) {
      if (!comment.media) {
        logger.info(`⏭️ Rule "${rule.name}" skipped: rule targets specific posts but comment has no media ID`);
        continue;
      }
      if (!rule.targetPosts.includes(comment.media.id)) {
        logger.info(`⏭️ Rule "${rule.name}" skipped: media ${comment.media.id} not in targetPosts [${rule.targetPosts.join(', ')}]`);
        continue;
      }
      logger.info(`✅ Post match: media ${comment.media.id} found in targetPosts`);
    }

    // Now check if the comment matches the keywords
    const keywordMatched = matchesKeyword(comment.text, rule.keywords, rule.matchType);
    if (!keywordMatched) {
      logger.info(`⏭️ Rule "${rule.name}" skipped: keyword mismatch. Comment "${comment.text}" did not match [${rule.keywords.join(', ')}] (mode: ${rule.matchType})`);
      continue;
    }
    logger.info(`✅ Keyword match! "${comment.text}" matched rule "${rule.name}"`);

    const redis = getRedis();
    const cooldownKey = `cooldown:${creatorId}:${rule._id}:${comment.from.id}`;
    const duplicateKey = `duplicate:${creatorId}:${comment.id}`;

    // Duplicate check — same comment already processed
    const isDuplicate = await redis.get(duplicateKey);
    if (isDuplicate) {
      logger.info(`⏭️ Duplicate comment ${comment.id} skipped (already processed)`);
      continue;
    }
    await redis.setex(duplicateKey, 3600, '1'); // 1 hour TTL

    // Cooldown check — same user within cooldown period
    const inCooldown = await redis.get(cooldownKey);
    if (inCooldown) {
      logger.info(`⏭️ Cooldown active for user ${comment.from.id} on rule "${rule.name}" — skipping DM`);
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

    logger.info(`✅ DM job ${job.id} queued for ${comment.from.username || comment.from.id} (rule: "${rule.name}", delay: ${rule.delaySeconds || 0}s)`);
  }
}

async function handleDM(creatorId: string, igBusinessId: string, msg: DMMessage): Promise<void> {
  const fromId = msg.sender.id;
  const messageText = msg.message.text!;
  const messageId = msg.message.mid;

  logger.info(`🔍 handleDM called for creator ${creatorId}`, {
    fromId, messageText, messageId,
  });

  // Track DM received
  await AnalyticsEvent.create({
    creatorId,
    eventType: 'dm_received',
    metadata: { messageId, from: fromId, text: messageText },
    timestamp: new Date(),
  });

  const rules = await AutomationRule.find({ creatorId, isActive: true, triggerType: 'dm' });
  logger.info(`📋 Found ${rules.length} active DM automation rules for creator ${creatorId}`);

  for (const rule of rules) {
    const keywordMatched = matchesKeyword(messageText, rule.keywords, rule.matchType);
    logger.info(`🔄 Checking DM rule "${rule.name}": keyword match=${keywordMatched}`, {
      keywords: rule.keywords, matchType: rule.matchType,
    });
    if (!keywordMatched) continue;

    const redis = getRedis();
    const cooldownKey = `cooldown:${creatorId}:${rule._id}:${fromId}`;
    const duplicateKey = `duplicate:${creatorId}:${messageId}`;

    const isDuplicate = await redis.get(duplicateKey);
    if (isDuplicate) {
      logger.info(`⏭️ Duplicate DM ${messageId} skipped`);
      continue;
    }
    await redis.setex(duplicateKey, 3600, '1');

    const inCooldown = await redis.get(cooldownKey);
    if (inCooldown) {
      logger.info(`⏭️ Cooldown active for DM user ${fromId} on rule "${rule.name}"`);
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

    logger.info(`✅ DM job ${job.id} queued for ${fromId} (rule: "${rule.name}")`);
  }
}
