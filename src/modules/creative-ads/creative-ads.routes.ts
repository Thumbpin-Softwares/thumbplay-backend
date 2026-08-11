import { Router } from 'express';
import { generate, getJob, listGenerations } from './creative-ads.controller';
import { requireAuth } from '../auth/auth.middleware';

const router: Router = Router();

/**
 * @openapi
 * /creative-ads/generate:
 *   post:
 *     summary: Generate a static creative ad via the template's n8n workflow
 *     description: >
 *       Streams progress as Server-Sent Events. Each templateKey maps to its own n8n webhook
 *       (see creative-ads.service.ts) that builds the prompt and renders the final image in a
 *       single round-trip - unlike model-tour there's no separate script/edit checkpoint or
 *       splitter hand-off. Charges the `creative_ad_generation` credit action up front, refunded
 *       on failure.
 *     tags: [Creative Ads]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [templateKey, propertyName, headline, propertyImageUrls]
 *             properties:
 *               templateKey: { type: string, enum: [art-of-living] }
 *               propertyName: { type: string }
 *               headline: { type: string }
 *               subheading: { type: string }
 *               ctaText: { type: string }
 *               tonality: { type: string }
 *               propertyImageUrls: { type: array, items: { type: string }, minItems: 1, maxItems: 4 }
 *               logoUrl: { type: string }
 *     responses:
 *       200:
 *         description: text/event-stream of generation progress
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
 * /creative-ads/jobs/{jobId}:
 *   get:
 *     summary: Resume/poll a creative-ad generation job
 *     tags: [Creative Ads]
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
 * /creative-ads/generations:
 *   get:
 *     summary: List the user's own creative-ad generations (newest first), including in-progress ones
 *     tags: [Creative Ads]
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
