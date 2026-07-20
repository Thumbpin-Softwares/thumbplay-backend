import { Router } from 'express';
import { generate } from './captions.controller';
import { requireAuth } from '../auth/auth.middleware';

const router: Router = Router();

/**
 * @openapi
 * /captions/generate:
 *   post:
 *     summary: Burn in captions on an existing video via VEED subtitles (fal.ai)
 *     description: >
 *       JSON in, JSON out (not SSE). Usage-based pricing: $0.10/min of input video,
 *       ×2 for dynamic (animated) presets, +$0.20/min for translation — charged via
 *       a costOverride on the `captions_generation` action, refunded (minus a flat
 *       raw-cost charge) on failure since fal/VEED still bills for failed attempts.
 *     tags: [Captions]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [videoUrl, preset]
 *             properties:
 *               videoUrl: { type: string }
 *               preset: { type: string, description: "One of CAPTION_PRESETS' ids" }
 *               language: { type: string }
 *               translationLanguage: { type: string }
 *               position: { type: string }
 *               durationSeconds: { type: number, description: "Trusted — comes from the reel's own composition, not client input" }
 *     responses:
 *       200:
 *         description: "{ url, creditsCharged }"
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       402:
 *         description: Insufficient credits
 */
router.post('/generate', requireAuth, generate);

export default router;
