import { Router } from 'express';
import { me, transactions } from './credit.controller';
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

/**
 * @openapi
 * /credits/transactions:
 *   get:
 *     summary: List the current user's credit transaction history (newest first)
 *     tags: [Credits]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: skip
 *         required: false
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Transaction history page
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 transactions:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/CreditTransaction' }
 *                 hasMore: { type: boolean }
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/transactions', requireAuth, transactions);

export default router;
