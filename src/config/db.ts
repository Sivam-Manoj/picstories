import mongoose from 'mongoose';
import { config } from './env.js';

export async function connectDB() {
  if (!config.MONGODB_URL) {
    throw new Error('MONGODB_URL is not set');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.MONGODB_URL, {
    // Additional options can be specified if needed
  } as any);
  console.log('MongoDB connected');
  return mongoose.connection;
}
