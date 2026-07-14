import { Router } from 'express';
import { login, logout, me } from './admin.controller';
import { requireAdmin } from './admin.middleware';

const router: Router = Router();

/**
 * @openapi
 * /admin/auth/login:
 *   post:
 *     summary: Admin login
 *     description: Bcrypt-hash-only credential check against ADMIN_EMAIL/ADMIN_PASSWORD_HASH — no plaintext fallback.
 *     tags: [Admin Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Logged in (admin_token cookie set)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/login', login);

/**
 * @openapi
 * /admin/auth/logout:
 *   post:
 *     summary: Admin logout (clears the admin_token cookie)
 *     tags: [Admin Auth]
 *     responses:
 *       200:
 *         description: Logged out
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 */
router.post('/logout', logout);

/**
 * @openapi
 * /admin/auth/me:
 *   get:
 *     summary: Get the current admin session
 *     tags: [Admin Auth]
 *     security:
 *       - adminCookieAuth: []
 *     responses:
 *       200:
 *         description: Admin session info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 admin:
 *                   type: object
 *                   properties:
 *                     email: { type: string }
 *                     role: { type: string, enum: [admin] }
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/me', requireAdmin, me);

export default router;
