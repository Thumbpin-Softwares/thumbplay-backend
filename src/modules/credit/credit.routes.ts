import { Router } from 'express';
import { me } from './credit.controller';
import { requireAuth } from '../auth/auth.middleware';

const router: Router = Router();

/**
 * @openapi
 * /credits/me:
 *   get:
 *     summary: Get the current user's credit balance and free-quota snapshot
 *     tags: [Credits]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Balance + plan + free-quota usage
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 credits: { type: number, example: 0 }
 *                 plan: { type: string, enum: [free, pro] }
 *                 freeQuota: { $ref: '#/components/schemas/FreeQuota' }
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/me', requireAuth, me);

export default router;
