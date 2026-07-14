import mongoose from 'mongoose';
import { env } from './env';

// A long-lived Express process only needs to connect once — unlike
// thumbpinclient's serverless global-cache pattern, there's no per-invocation
// reconnect concern here.
export async function dbConnect(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  await mongoose.connect(env.mongodbUri);
  console.log('[db] MongoDB connected');
  return mongoose;
}
