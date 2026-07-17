import { Router } from 'express';
import { stream } from './re-avatars.controller';
import { requireAuth } from '../auth/auth.middleware';

const router: Router = Router();

/**
 * @openapi
 * /avatars/re:
 *   get:
 *     summary: Stream the user's saved avatars plus the shared prebuilt RE-avatar library (SSE)
 *     description: >
 *       Server-Sent Events. Sends a `library` event first (the caller's own
 *       saved avatars, from the DB), then one `avatar` event per shared
 *       prebuilt collection as it's ready, then `done`. The shared library
 *       portion is cached in-memory for 10 minutes since it's identical for
 *       every user and rarely changes.
 *     tags: [Avatars]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: text/event-stream
 *       401:
 *         description: Not authenticated
 */
router.get('/re', requireAuth, stream);

export default router;
