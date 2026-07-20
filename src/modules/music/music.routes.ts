import { Router } from 'express';
import { list } from './music.controller';

const router: Router = Router();

/**
 * @openapi
 * /music-library:
 *   get:
 *     summary: List background-music tracks available in the shared R2 Music/ prefix
 *     tags: [Music]
 *     responses:
 *       200:
 *         description: "{ tracks: [{ key, name, url }] }"
 */
router.get('/', list);

export default router;
