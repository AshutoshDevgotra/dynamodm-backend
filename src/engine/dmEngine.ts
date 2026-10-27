import { DMLog } from '../models/DMLog';
import { Automation } from '../models/AutomationRule';
import { AnalyticsEvent } from '../models/AnalyticsEvent';
import { CreatorAccount } from '../models/CreatorAccount';
import { decryptToken } from '../modules/oauth/instagram';
import { isInstagramSessionInvalidated, privateReplyToComment, sendDM } from '../lib/instagram';
import { logger } from '../utils/logger';

interface DMJobData {
  dmLogId: string;
  creatorId: string;
  igUserId: string;
  recipientId: string;
  commentId?: string;
  message: string;
  buttons?: { type: 'web_url' | 'postback'; title: string; url?: string; payload?: string }[];
  ctaLink?: string;
  attachmentUrl?: string;
  automationRuleId: string;
}

export async function sendInstagramDM(data: DMJobData): Promise<void> {
  const { dmLogId, creatorId, igUserId, recipientId, commentId, message, ctaLink, buttons, automationRuleId } = data;

  logger.info(`📤 sendInstagramDM called`, {
    dmLogId, creatorId, igUserId, recipientId, automationRuleId,
    messagePreview: message.slice(0, 100),
  });

  const account = await CreatorAccount.findOne({ userId: creatorId, isConnected: true }).select('+igAccessToken');
  if (!account?.igAccessToken) {
    logger.error(`❌ Creator ${creatorId} has no connected account or token is missing`);
    const reconnectError = new Error('Creator Instagram account not connected or token missing.');
    (reconnectError as any).requiresReconnect = true;
    throw reconnectError;
  }

  const accessToken = decryptToken(account.igAccessToken);
  logger.info(`🔑 Token decrypted for creator ${creatorId}`);

  let messageText = message;
  if (ctaLink) messageText += `\n\n${ctaLink}`;

  logger.info(`📡 Sending DM via Instagram API`, {
    igUserId,
    recipientId,
    messageLength: messageText.length,
  });

  try {
    if (commentId) {
      try {
        await privateReplyToComment(igUserId, commentId, messageText, accessToken, buttons);
      } catch (error) {
        if (!buttons?.length || isInstagramSessionInvalidated(error)) throw error;
        logger.warn('Interactive private reply failed; sending the plain-text fallback.', {
          commentId,
          recipientId,
          error: (error as Error)?.message,
        });
        const profileUrl = buttons.find((button) => button.type === 'web_url')?.url;
        await privateReplyToComment(
          igUserId,
          commentId,
          profileUrl ? `${messageText}\n${profileUrl}` : messageText,
          accessToken,
        );
      }
    } else {
      await sendDM(igUserId, recipientId, messageText, accessToken, buttons);
    }

    logger.info(`✅ DM sent successfully to ${recipientId}`);

    await DMLog.findByIdAndUpdate(dmLogId, { status: 'sent', sentAt: new Date() });
    await Automation.findByIdAndUpdate(automationRuleId, { $inc: { 'stats.dmSentCount': 1 } });

    await AnalyticsEvent.create({
      creatorId, eventType: 'dm_sent',
      automationRuleId,
      metadata: { recipientId },
      timestamp: new Date(),
    });

    logger.info(`✅ DM successfully sent to ${recipientId}`);
  } catch (err: unknown) {
    const error = err as any;
    const errorMessage = error?.message || 'Unknown error';
    const httpStatus = error?.status;

    if (isInstagramSessionInvalidated(error)) {
      await CreatorAccount.findOneAndUpdate(
        { userId: creatorId },
        {
          $set: {
            isConnected: false,
            reconnectRequired: true,
            reconnectReason: 'Instagram session expired or was invalidated. Reconnect your Instagram account to resume automations.',
          },
          $unset: { igAccessToken: '', igTokenExpiresAt: '' },
        },
      );
      logger.warn('Instagram session invalidated; reconnect is required.', { creatorId });
      error.requiresReconnect = true;
    }

    logger.error(`❌ DM send failed`, {
      recipientId,
      httpStatus,
      errorMessage,
    });

    await DMLog.findByIdAndUpdate(dmLogId, {
      status: 'failed',
      errorMessage: `[${httpStatus}] ${errorMessage}`,
      $inc: { retryCount: 1 },
    });

    await AnalyticsEvent.create({
      creatorId, eventType: 'dm_failed',
      automationRuleId,
      metadata: { recipientId, error: errorMessage },
      timestamp: new Date(),
    });

    throw err; // MongoDB worker records the failure and schedules a retry
  }
}

