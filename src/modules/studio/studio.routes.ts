import { Router } from 'express';
import { generate, getJob, listGenerations } from './studio.controller';
import { requireAuth } from '../auth/auth.middleware';

const router: Router = Router();

/**
 * @openapi
 * /studio/generate:
 *   post:
 *     summary: Queue a Studio generation job (currently only workType "drone-flythrough")
 *     description: >
 *       Responds as soon as the job is queued (202 + jobId) - the actual fal.ai/Seedance
 *       call runs detached from this request so it survives the client disconnecting.
 *       Poll /studio/jobs/{jobId} or /studio/generations for status. Charges the
 *       `studio_drone_flythrough` credit action up front, refunded on failure. `prompt`
 *       is optional - each workType has its own tuned master prompt (studio.service.ts)
 *       that the user's prompt, if given, is appended to as extra direction.
 *     tags: [Studio]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workType, imageUrls]
 *             properties:
 *               workType: { type: string, enum: [drone-flythrough] }
 *               prompt: { type: string, description: "Optional - extra direction on top of the work type's master prompt" }
 *               imageUrls: { type: array, items: { type: string }, minItems: 1, maxItems: 4 }
 *     responses:
 *       202:
 *         description: Job queued
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       402:
 *         description: Insufficient credits
 */
router.post('/generate', requireAuth, generate);

/**
 * @openapi
 * /studio/jobs/{jobId}:
 *   get:
 *     summary: Resume/poll a single Studio generation job
 *     tags: [Studio]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The job document
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Job not found
 */
router.get('/jobs/:jobId', requireAuth, getJob);

/**
 * @openapi
 * /studio/generations:
 *   get:
 *     summary: List the user's own Studio generations (newest first), including in-progress ones
 *     tags: [Studio]
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
 *         description: Paginated jobs list
 */
router.get('/generations', requireAuth, listGenerations);

export default router;
