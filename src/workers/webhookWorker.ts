import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { processWebhookEvent } from '../engine/ruleEngine';
import { logger } from '../utils/logger';

export const webhookWorker = new Worker(
  'webhook-queue',
  async (job: Job) => {
    logger.info(`🔄 Webhook worker processing job ${job.id} (attempt ${job.attemptsMade + 1})`, {
      payloadObject: job.data?.payload?.object,
      entryCount: job.data?.payload?.entry?.length,
    });
    await processWebhookEvent(job.data.payload);
  },
  {
    connection: redisConnection,
    concurrency: 10,
  }
);

webhookWorker.on('ready', () => {
  logger.info('✅ Webhook worker is READY and listening for jobs');
});

webhookWorker.on('completed', (job) => {
  logger.info(`✅ Webhook job ${job.id} completed successfully`);
});

webhookWorker.on('failed', (job, err) => {
  logger.error(`❌ Webhook job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`, {
    stack: err.stack,
    jobData: JSON.stringify(job?.data).slice(0, 500),
  });
});

webhookWorker.on('stalled', (jobId) => {
  logger.warn(`⚠️ Webhook job ${jobId} has stalled`);
});

webhookWorker.on('error', (err) => {
  logger.error('❌ Webhook worker error:', err);
});

logger.info('📡 Webhook worker initialized');
