import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/database';
import { logger } from './utils/logger';

require('./workers/dmWorker');

const PORT = process.env.PORT || 3001;

async function bootstrap() {
  try {
    if (!process.env.JWT_SECRET?.trim()) throw new Error('JWT_SECRET is required to start the backend.');
    await connectDB();
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
