import { Router } from 'express';
import { register, login, logout, me, googleRedirect, googleCallback, exchangeCode } from './auth.controller';
import { requireAuth } from './auth.middleware';

const router: Router = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Register a new account with email + password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password, minLength: 6 }
 *               name: { type: string }
 *     responses:
 *       201:
 *         description: Account created and logged in (auth_token cookie set)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 user: { $ref: '#/components/schemas/PublicUser' }
 *       400:
 *         description: Validation error, or an account with this email already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/register', register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Log in with email + password
 *     tags: [Auth]
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
 *         description: Logged in (auth_token cookie set)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 user: { $ref: '#/components/schemas/PublicUser' }
 *       401:
 *         description: Invalid email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/login', login);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Log out (clears the auth_token cookie)
 *     tags: [Auth]
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
 * /auth/me:
 *   get:
 *     summary: Get the current authenticated user's profile
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Full profile (password hash excluded)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 user: { $ref: '#/components/schemas/User' }
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
 * /auth/google:
 *   get:
 *     summary: Start Google OAuth sign-in
 *     description: Redirects the browser to Google's consent screen. Not meant to be called via fetch/XHR — navigate to it directly.
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: origin
 *         required: false
 *         schema: { type: string }
 *         description: >
 *           The calling frontend's own origin (window.location.origin), validated against the
 *           FRONTEND_URL allow-list and round-tripped through Google as `state` so the callback
 *           knows which frontend to redirect back to. Falls back to the first FRONTEND_URL entry
 *           if omitted or not recognized.
 *     responses:
 *       302:
 *         description: Redirect to accounts.google.com
 */
router.get('/google', googleRedirect);

/**
 * @openapi
 * /auth/google/callback:
 *   get:
 *     summary: Google OAuth callback
 *     description: Google redirects here after consent. Exchanges the code, finds/links/creates the user, sets the auth_token cookie, then redirects to the frontend that initiated sign-in (see /auth/google's `origin` param).
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema: { type: string }
 *         description: Authorization code issued by Google
 *       - in: query
 *         name: state
 *         required: false
 *         schema: { type: string }
 *         description: Echoed back by Google from /auth/google's `origin` param; re-validated against FRONTEND_URL before use.
 *     responses:
 *       302:
 *         description: Redirect to {resolved frontend}/auth/callback?code=... on success, or {resolved frontend}/auth/login?error=google_oauth_failed on failure
 */
router.get('/google/callback', googleCallback);

/**
 * @openapi
 * /auth/exchange:
 *   post:
 *     summary: Exchange a one-time OAuth handoff code for a session
 *     description: >
 *       Called server-to-server by the frontend's own backend (not the browser)
 *       right after the /auth/google/callback redirect, since the frontend lives
 *       on a different domain and never receives this backend's cookie directly.
 *       The code is single-use and expires after 60 seconds.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: Valid code — auth_token cookie set (for direct calls to this backend) and the token returned in the body so the caller can mint its own cookie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 user: { $ref: '#/components/schemas/User' }
 *                 token: { type: string }
 *       400:
 *         description: Missing code
 *       401:
 *         description: Invalid, expired, or already-used code
 */
router.post('/exchange', exchangeCode);

export default router;
