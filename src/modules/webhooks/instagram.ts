import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { getRedis } from '../../config/redis';
import { processWebhookEvent } from '../../engine/ruleEngine';

const router = Router();

router.get('/', (req: Request, res: Response): void => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('✅ Instagram webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn(`⚠️ Webhook verification failed — mode=${mode}, tokenMatch=${token === verifyToken}`);
    res.status(403).json({ success: false, message: 'Webhook verification failed.' });
  }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const receivedAt = new Date().toISOString();
  logger.info(`📩 Instagram webhook POST received at ${receivedAt}`, {
    bodyObject: (req.body as any)?.object,
    entryCount: (req.body as any)?.entry?.length,
  });

  const body = req.body as { object: string; entry: Array<{ id: string; changes?: any[]; messaging?: any[] }> };

  try {
    const redis = getRedis();
    const debugPayload = JSON.stringify({ receivedAt, object: body.object, body });
    await redis.lpush('debug:webhook:payloads', debugPayload);
    await redis.ltrim('debug:webhook:payloads', 0, 49);
  } catch (debugErr) {
    logger.warn('Failed to store debug webhook payload in Redis', debugErr);
  }

  res.status(200).send('EVENT_RECEIVED');

  if (body.object === 'instagram') {
    const hasChanges = body.entry?.some(e => e.changes && e.changes.length > 0);
    const hasMessaging = body.entry?.some(e => e.messaging && e.messaging.length > 0);

    if (hasChanges || hasMessaging) {
      logger.info('🚀 Processing Instagram webhook inline', { object: body.object, hasChanges, hasMessaging });
      processWebhookEvent(body).catch((err: Error) => {
        logger.error('❌ Webhook processing error', { message: err.message, stack: err.stack });
      });
    } else {
      logger.info('ℹ️ Webhook has no changes or messaging to process — skipping');
    }
  } else {
    logger.info(`ℹ️ Ignoring webhook object type: ${body.object}`);
  }
});

export default router;
