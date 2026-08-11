import { Router } from 'express';
import { stats } from './admin-stats.controller';
import { requireAdmin } from './admin.middleware';

const router: Router = Router();

/**
 * @openapi
 * /admin/stats:
 *   get:
 *     summary: Dashboard stats - user counts, credit totals, recent signups
 *     tags: [Admin Auth]
 *     security:
 *       - adminCookieAuth: []
 *     responses:
 *       200:
 *         description: Aggregate stats + recent users
 */
router.get('/', requireAdmin, stats);

export default router;
