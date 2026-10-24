import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // Creator pages make several status/data calls during startup. Keep a
  // broad API guard without blocking normal navigation or OAuth setup.
  max: process.env.NODE_ENV === 'production' ? 600 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Keep failed-auth protection, but do not punish a user who has already
  // authenticated successfully or is iterating through a normal auth flow.
  max: process.env.NODE_ENV === 'production' ? 15 : 40,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again in 15 minutes.' },
});

export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.headers['x-hub-signature-256'] !== undefined, // trust verified Meta webhooks
});
