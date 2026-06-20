import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { sendInstagramDM } from '../engine/dmEngine';
import { logger } from '../utils/logger';

export const dmWorker = new Worker(
  'dm-queue',
  async (job: Job) => {
    logger.info(`Processing DM job ${job.id}`, { data: job.data });
    await sendInstagramDM(job.data);
  },
  {
    connection: redisConnection,
    concurrency: 5, // Process 5 DMs concurrently
    limiter: {
      max: 200,
      duration: 3600000, // 200 DMs per hour per worker (Instagram limit)
    },
  }
);

dmWorker.on('completed', (job) => {
  logger.info(`✅ DM job ${job.id} completed`);
});

dmWorker.on('failed', (job, err) => {
  logger.error(`❌ DM job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
});

dmWorker.on('error', (err) => {
  logger.error('DM worker error:', err);
});
