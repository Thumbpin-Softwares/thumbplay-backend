import { Router } from 'express';
import { getUserCredits, updateUserCredits } from './admin-users.controller';
import { requireAdmin } from './admin.middleware';

const router: Router = Router();

/**
 * @openapi
 * /admin/users/{id}/credits:
 *   get:
 *     summary: Get a user's credit balance and recent transaction history
 *     tags: [Admin Auth]
 *     security:
 *       - adminCookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User (subset of fields) + last 20 credit transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *                 transactions:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/CreditTransaction' }
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id/credits', requireAdmin, getUserCredits);

/**
 * @openapi
 * /admin/users/{id}/credits:
 *   patch:
 *     summary: Set, add, or remove a user's credits
 *     tags: [Admin Auth]
 *     security:
 *       - adminCookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action, amount]
 *             properties:
 *               action: { type: string, enum: [set, add, remove] }
 *               amount: { type: number, minimum: 0 }
 *     responses:
 *       200:
 *         description: Updated user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 user: { $ref: '#/components/schemas/User' }
 *       400:
 *         description: Invalid action or amount
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/:id/credits', requireAdmin, updateUserCredits);

export default router;
