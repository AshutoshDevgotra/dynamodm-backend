import IORedis from 'ioredis';
import { logger } from '../utils/logger';

const REDIS_URL = process.env.REDIS_URL?.trim();
const redisUrl = REDIS_URL ? new URL(REDIS_URL) : new URL('redis://localhost:6379');
const isTLS = redisUrl.protocol === 'rediss:';

// TLS options for rediss:// (Upstash, Redis Cloud, etc.)
// rejectUnauthorized: false is required on some hosting environments (Render, Railway)
// where the Node TLS stack doesn't trust the CA used by managed Redis providers.
const tlsOptions = isTLS ? { rejectUnauthorized: false } : undefined;

// Connection options object for BullMQ (avoids ioredis version conflict)
export const redisConnection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
  username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
  db: 0,
  tls: tlsOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maxRetriesPerRequest: null as any,
  enableReadyCheck: false,
};

// IORedis client for direct usage (cooldown keys, rate limiting, debug payloads, etc.)
// Must use the same explicit options as redisConnection — NOT just the raw URL string —
// so that TLS and credentials are handled identically on all environments.
export const ioRedisClient = new IORedis({
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
  username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
  db: 0,
  tls: tlsOptions,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  // Retry aggressively on transient errors — don't give up after one failure
  retryStrategy: (times: number) => Math.min(times * 200, 5000),
});

ioRedisClient.on('error', (err) => {
  logger.error('❌ Redis client error', { message: err.message, code: (err as any).code });
});

ioRedisClient.on('connect', () => {
  logger.info('✅ Redis client connected');
});

ioRedisClient.on('reconnecting', () => {
  logger.warn('⚠️ Redis client reconnecting...');
});

export const connectRedis = async () => {
  try {
    await ioRedisClient.connect();
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
