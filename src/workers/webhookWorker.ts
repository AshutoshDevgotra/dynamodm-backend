import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { processWebhookEvent } from '../engine/ruleEngine';
import { logger } from '../utils/logger';

export const webhookWorker = new Worker(
  'webhook-queue',
  async (job: Job) => {
    logger.info(`Processing webhook job ${job.id}`);
    await processWebhookEvent(job.data.payload);
  },
  {
    connection: redisConnection,
    concurrency: 10, // Handle 10 concurrent webhook events
  }
);

webhookWorker.on('completed', (job) => {
  logger.info(`✅ Webhook job ${job.id} completed`);
});

webhookWorker.on('failed', (job, err) => {
  logger.error(`❌ Webhook job ${job?.id} failed: ${err.message}`);
});
