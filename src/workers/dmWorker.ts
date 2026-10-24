import { DMJob } from '../models/DMJob';
import { sendInstagramDM } from '../engine/dmEngine';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';

const POLL_INTERVAL_MS = 2000;
const LEASE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CONCURRENCY = 5;

async function claimJob() {
  const now = new Date();
  const staleLock = new Date(Date.now() - LEASE_TIMEOUT_MS);

  return DMJob.findOneAndUpdate(
    {
      nextAttemptAt: { $lte: now },
      $or: [
        { status: 'queued' },
        { status: 'processing', lockedAt: { $lt: staleLock } },
      ],
    },
    { $set: { status: 'processing', lockedAt: now }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1, createdAt: 1 }, new: true },
  );
}

async function processJob(job: NonNullable<Awaited<ReturnType<typeof claimJob>>>) {
  logger.info(`Processing MongoDB DM job ${job.jobId}`, { attempt: job.attempts });

  try {
    await sendInstagramDM({
      dmLogId: job.dmLogId,
      creatorId: job.creatorId,
      igUserId: job.igUserId,
      recipientId: job.recipientId,
      message: job.message,
      buttons: job.buttons,
        commentId: job.commentId,
      attachmentUrl: job.attachmentUrl,
      automationRuleId: job.automationRuleId,
    });
    await DMJob.findByIdAndUpdate(job._id, {
      $set: { status: 'completed', lockedAt: null },
    });
    logger.info(`DM job ${job.jobId} completed`);
  } catch (error: any) {
    const lastError = error?.message || 'Unknown DM job error';
    const shouldRetry = job.attempts < job.maxAttempts;

    await DMJob.findByIdAndUpdate(job._id, {
      $set: {
        status: shouldRetry ? 'queued' : 'failed',
        lockedAt: null,
        lastError,
        nextAttemptAt: shouldRetry
          ? new Date(Date.now() + 5000 * 2 ** (job.attempts - 1))
          : new Date(),
      },
    });
    logger.error(`DM job ${job.jobId} ${shouldRetry ? 'scheduled for retry' : 'failed'}`, {
      attempt: job.attempts,
      error: lastError,
    });
  }
}

async function pollJobs(): Promise<void> {
  // The worker can outlive a transient MongoDB disconnect. Skip this tick and
  // let Mongoose reconnect instead of issuing operations on a closed client.
  if (mongoose.connection.readyState !== 1) return;
  const jobs = await Promise.all(Array.from({ length: MAX_CONCURRENCY }, () => claimJob()));
  await Promise.all(jobs.filter(Boolean).map((job) => processJob(job!)));
}

let workerTimer: NodeJS.Timeout | undefined;

function startWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    pollJobs().catch((error) => logger.error('MongoDB DM worker poll failed', error));
  }, POLL_INTERVAL_MS);
  workerTimer.unref();
  logger.info('MongoDB DM worker initialized');
}

function stopWorker(): void {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = undefined;
}

export { pollJobs, startWorker, stopWorker };
