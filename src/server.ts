import app from './app'; // Clean local TypeScript import
import { env } from './config/env';
import { dbConnect } from './config/db';

const startServer = async () => {
  try {
    await dbConnect();
    app.listen(env.port, () => {
      console.log(`Server safely running on http://localhost:${env.port}`);
    });
  } catch (error) {
    console.error('Failed to boot up the server application:', error);
    process.exit(1);
  }
};

startServer();
