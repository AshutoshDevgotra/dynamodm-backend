import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import { CreatorAccount } from '../models/CreatorAccount';

export const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
    return;
  }

  const uri = (process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING)?.trim();
  if (!uri) throw new Error('MONGODB_URI is required to start the backend.');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, maxPoolSize: 10 });
    // The old schema enforced one account per creator with a unique userId_1
    // index. Remove only that obsolete index so Creator subscriptions can use
    // the new five-account entitlement; the schema keeps a normal lookup index.
    try {
      await CreatorAccount.collection.dropIndex('userId_1');
    } catch (error: any) {
      if (error?.codeName !== 'IndexNotFound') logger.warn('CreatorAccount index migration skipped.', error?.message || error);
    }
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    throw error;
  }
};

mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected.'));
mongoose.connection.on('error', (error) => logger.error('MongoDB connection error:', error));

process.once('SIGINT', async () => { await mongoose.connection.close(); });
process.once('SIGTERM', async () => { await mongoose.connection.close(); });
