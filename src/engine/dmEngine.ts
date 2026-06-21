import axios from 'axios';
import { DMLog } from '../models/DMLog';
import { AutomationRule } from '../models/AutomationRule';
import { AnalyticsEvent } from '../models/AnalyticsEvent';
import { CreatorAccount } from '../models/CreatorAccount';
import { decryptToken } from '../routes/meta';
import { logger } from '../utils/logger';

const META_API = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v20.0'}`;

interface DMJobData {
  dmLogId: string;
  creatorId: string;
  igBusinessId: string;
  recipientId: string;
  message: string;
  ctaLink?: string;
  attachmentUrl?: string;
  automationRuleId: string;
}

export async function sendInstagramDM(data: DMJobData): Promise<void> {
  const { dmLogId, creatorId, igBusinessId, recipientId, message, ctaLink, automationRuleId } = data;

  logger.info(`📤 sendInstagramDM called`, {
    dmLogId, creatorId, igBusinessId, recipientId, automationRuleId,
    messagePreview: message.slice(0, 100),
  });

  // Get creator access token
  const account = await CreatorAccount.findOne({ userId: creatorId, isConnected: true }).select('+accessToken');
  if (!account?.accessToken) {
    logger.error(`❌ Creator ${creatorId} has no connected account or token is missing`);
    throw new Error('Creator Instagram account not connected or token missing.');
  }

  const accessToken = decryptToken(account.accessToken);
  logger.info(`🔑 Token decrypted for creator ${creatorId} (token length: ${accessToken.length})`);

  // Build message text
  let messageText = message;
  if (ctaLink) messageText += `\n\n${ctaLink}`;

  const apiUrl = `${META_API}/${igBusinessId}/messages`;
  const payload = {
    recipient: { id: recipientId },
    message: { text: messageText },
  };

  logger.info(`📡 Sending DM via Meta API`, {
    url: apiUrl,
    recipientId,
    messageLength: messageText.length,
  });

  try {
    // Send DM via Instagram Messaging API
    const response = await axios.post(apiUrl, payload, {
      params: { access_token: accessToken },
      headers: { 'Content-Type': 'application/json' },
    });

    logger.info(`✅ Meta API DM response`, {
      status: response.status,
      data: JSON.stringify(response.data).slice(0, 300),
    });

    // Update DM log
    await DMLog.findByIdAndUpdate(dmLogId, { status: 'sent', sentAt: new Date() });

    // Update automation stats
    await AutomationRule.findByIdAndUpdate(automationRuleId, { $inc: { 'stats.dmsSent': 1 } });

    // Track analytics
    await AnalyticsEvent.create({
      creatorId, eventType: 'dm_sent',
      automationRuleId,
      metadata: { recipientId },
      timestamp: new Date(),
    });

    logger.info(`✅ DM successfully sent to ${recipientId}`);
  } catch (err: unknown) {
    const axiosErr = err as any;
    const errorMessage = axiosErr?.response?.data?.error?.message || axiosErr?.message || 'Unknown error';
    const errorCode = axiosErr?.response?.data?.error?.code;
    const errorSubcode = axiosErr?.response?.data?.error?.error_subcode;
    const httpStatus = axiosErr?.response?.status;

    logger.error(`❌ DM send failed`, {
      recipientId,
      httpStatus,
      errorCode,
      errorSubcode,
      errorMessage,
      responseData: JSON.stringify(axiosErr?.response?.data).slice(0, 500),
    });

    await DMLog.findByIdAndUpdate(dmLogId, {
      status: 'failed',
      errorMessage: `[${httpStatus}] ${errorMessage} (code: ${errorCode}, subcode: ${errorSubcode})`,
      $inc: { retryCount: 1 },
    });

    await AutomationRule.findByIdAndUpdate(automationRuleId, { $inc: { 'stats.failed': 1 } });

    await AnalyticsEvent.create({
      creatorId, eventType: 'dm_failed',
      automationRuleId,
      metadata: { recipientId, error: errorMessage, errorCode, errorSubcode },
      timestamp: new Date(),
    });

    throw err; // re-throw so BullMQ retries the job
  }
}

