import { Router } from 'express';
import { listVideos } from '../asset/asset.controller';
import { requireAuth } from '../auth/auth.middleware';

const router: Router = Router();

/**
 * @openapi
 * /user/videos:
 *   get:
 *     summary: List the current user's video/clip assets, paginated
 *     tags: [User]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated video list
 */
router.get('/videos', requireAuth, listVideos);

export default router;
