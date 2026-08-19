import mongoose from 'mongoose';
import { logger } from '../utils/logger';

export const connectDB = async (): Promise<void> => {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error('MONGODB_URI is required to start the backend.');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, maxPoolSize: 10 });
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
