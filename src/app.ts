import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import globalRouter from './routes'; // Notice the clean extensionless import
import { env } from './config/env';
import { swaggerSpec } from './config/swagger';

const app: Application = express();

// Core Global Middlewares
// credentials:true requires an explicit origin (not "*") for the browser to
// accept the cookie the auth module sets.
app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Server Health Verification Route
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'Server is healthy' });
});

// API Documentation — generated from @openapi JSDoc blocks above each route
// registration (see src/modules/*/*.routes.ts). Add a block there whenever a
// new route is added; this mount point never needs to change.
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Mount the Main API Router Wrapper
app.use('/api/v1', globalRouter);

export default app;
