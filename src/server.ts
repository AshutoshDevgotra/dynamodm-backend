import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/database';
import { logger } from './utils/logger';
import { startWorker } from './workers/dmWorker';

const PORT = process.env.PORT || 3001;

async function bootstrap() {
  try {
    const requiredSecrets = ['JWT_SECRET'];
    if (process.env.NODE_ENV === 'production') requiredSecrets.push('ENCRYPTION_KEY', 'RAZORPAY_WEBHOOK_SECRET');
    const missingSecrets = requiredSecrets.filter((name) => !process.env[name]?.trim());
    if (missingSecrets.length) throw new Error(`Required security secrets are missing: ${missingSecrets.join(', ')}`);
    if (process.env.NODE_ENV === 'production' && !/^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_KEY!.trim())) {
      throw new Error('ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hexadecimal characters in production.');
    }
    await connectDB();
    startWorker();
    app.listen(PORT, () => {
      logger.info(`🚀 DynamoDM API server running on port ${PORT}`);
      logger.info(`📌 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

bootstrap();
