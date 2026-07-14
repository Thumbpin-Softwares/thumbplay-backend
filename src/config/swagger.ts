import fs from 'node:fs';
import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));

// Spec is generated from @openapi JSDoc blocks above each route registration
// (see src/modules/*/*.routes.ts) — add one whenever a new route is added,
// this file itself never needs to change for that.
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ThumbpinVids API',
      version: pkg.version || '1.0.0',
      description:
        "Backend API for ThumbpinVids — replicates (and will eventually replace) the Next.js API routes in thumbpinclient.",
    },
    servers: [{ url: `http://localhost:${env.port}/api/v1`, description: 'Local dev' }],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'auth_token',
          description: 'Set automatically by /auth/register, /auth/login, or /auth/google/callback.',
        },
        adminCookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'admin_token',
          description: 'Set automatically by /admin/auth/login.',
        },
      },
      schemas: {
        User: {
          type: 'object',
          description: 'Full profile shape (matches thumbpinclient GET /api/user/profile, minus the password hash).',
          properties: {
            _id: { type: 'string', example: '65f1a2b3c4d5e6f7a8b9c0d1' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            image: { type: 'string', nullable: true },
            credits: { type: 'number', example: 0 },
            freeVideoGenerationsUsed: { type: 'number', example: 0 },
            freeAvatarGenerationsUsed: { type: 'number', example: 0 },
            role: { type: 'string', enum: ['user', 'admin'] },
            plan: { type: 'string', enum: ['free', 'pro'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        PublicUser: {
          type: 'object',
          description: 'Lightweight shape returned by register/login.',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
        FreeQuota: {
          type: 'object',
          description: 'Free-tier usage snapshot for a bucket (video/avatar).',
          properties: {
            video: { $ref: '#/components/schemas/FreeQuotaBucket' },
            avatar: { $ref: '#/components/schemas/FreeQuotaBucket' },
          },
        },
        FreeQuotaBucket: {
          type: 'object',
          properties: {
            used: { type: 'number', example: 0 },
            limit: { type: 'number', example: 2 },
            remaining: { type: 'number', example: 2 },
          },
        },
        CreditTransaction: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            userId: { type: 'string' },
            action: { type: 'string', example: 'real_estate_video' },
            eventType: {
              type: 'string',
              enum: [
                'free_quota_consumed',
                'credits_debited',
                'credits_refunded',
                'credits_added',
                'credits_set',
                'subscription_recharge',
                'admin_adjustment',
              ],
            },
            mode: { type: 'string', enum: ['free_quota', 'paid_credits', 'system', 'admin'] },
            creditsDelta: { type: 'number', example: -3 },
            balanceAfter: { type: 'number', nullable: true, example: 7 },
            metadata: { type: 'object' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  // Both patterns kept so this resolves whether run via `tsx` (dev, .ts
  // sources) or `node dist/server.js` (prod, compiled .js — comments survive
  // tsc since removeComments isn't set).
  apis: ['./src/modules/**/*.routes.ts', './dist/modules/**/*.routes.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
