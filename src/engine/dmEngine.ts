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

  // Get creator access token
  const account = await CreatorAccount.findOne({ userId: creatorId, isConnected: true }).select('+accessToken');
  if (!account?.accessToken) {
    throw new Error('Creator Instagram account not connected or token missing.');
  }

  const accessToken = decryptToken(account.accessToken);

  // Build message text
  let messageText = message;
  if (ctaLink) messageText += `\n\n${ctaLink}`;

  try {
    // Send DM via Instagram Messaging API
    await axios.post(`${META_API}/${igBusinessId}/messages`, {
      recipient: { id: recipientId },
      message: { text: messageText },
    }, {
      params: { access_token: accessToken },
      headers: { 'Content-Type': 'application/json' },
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

    logger.info(`✅ DM sent to ${recipientId}`);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await DMLog.findByIdAndUpdate(dmLogId, {
      status: 'failed',
      errorMessage,
      $inc: { retryCount: 1 },
    });

    await AutomationRule.findByIdAndUpdate(automationRuleId, { $inc: { 'stats.failed': 1 } });

    await AnalyticsEvent.create({
      creatorId, eventType: 'dm_failed',
      automationRuleId,
      metadata: { recipientId, error: errorMessage },
      timestamp: new Date(),
    });

    throw err; // re-throw so BullMQ retries the job
  }
}
