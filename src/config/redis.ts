import IORedis from 'ioredis';
import { logger } from '../utils/logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisUrl = new URL(REDIS_URL);

// Connection options object for BullMQ (avoids ioredis version conflict)
export const redisConnection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  password: redisUrl.password || undefined,
  db: 0,
  tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maxRetriesPerRequest: null as any,
  enableReadyCheck: false,
};

// IORedis client for direct usage (rate limiting, pub/sub, etc.)
export const ioRedisClient = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const connectRedis = async () => {
  try {
    await ioRedisClient.ping();
    logger.info('✅ Redis connected successfully');
    return ioRedisClient;
  } catch (err) {
    logger.error('❌ Redis connection failed', err);
    throw err;
  }
};

export const getRedis = () => ioRedisClient;

export { ioRedisClient as redisClient };
