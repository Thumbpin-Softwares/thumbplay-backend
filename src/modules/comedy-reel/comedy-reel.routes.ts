import { Router } from 'express';
import { generatePipeline, getJob, previewScript } from './comedy-reel.controller';
import { requireAuth } from '../auth/auth.middleware';
import { reelUploadFields } from '../reel/upload.middleware';
import { createRenderRemotionHandler } from '../render/render.controller';

const router: Router = Router();

const renderRemotion = createRenderRemotionHandler({
  logLabel: 'ComedyReel',
  tempFilePrefix: 'comedy-reel',
  r2KeyPrefix: 'comedy-final',
  assetDisplayName: 'Comedy Reel',
  assetSource: 'comedy-reel-export',
  exportedFrom: 'comedy-reel',
  x264Preset: 'fast',
  withRetry: true,
});

/**
 * @openapi
 * /comedy-reel/generate-pipeline:
 *   post:
 *     summary: Generate the two Seedance clips for a comedy-reel ("Nosy Padosi") video
 *     description: >
 *       Streams progress as Server-Sent Events (text/event-stream) — same shape as
 *       seedance-reel's generate-pipeline. Charges the `action_reel_video` credit action.
 *     tags: [Comedy Reel]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [script, jobId]
 *             properties:
 *               script: { type: string, minLength: 30 }
 *               voiceId: { type: string }
 *               language: { type: string }
 *               jobId: { type: string }
 *               quality: { type: string, enum: [auto, 720p, 1080p] }
 *               avatarUrl_0: { type: string }
 *               avatarUrl_1: { type: string }
 *               avatarUrl_2: { type: string }
 *               locationImage_0: { type: string, format: binary }
 *               locationImage_1: { type: string, format: binary }
 *               locationImage_2: { type: string, format: binary }
 *               locationImage_3: { type: string, format: binary }
 *               customVoiceFile: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: text/event-stream of pipeline progress events
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       402:
 *         description: Insufficient credits
 *       409:
 *         description: jobId already exists
 */
router.post('/generate-pipeline', requireAuth, reelUploadFields, generatePipeline);

/**
 * @openapi
 * /comedy-reel/jobs/{jobId}:
 *   get:
 *     summary: Resume/poll a comedy-reel generation job
 *     tags: [Comedy Reel]
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
 * /comedy-reel/preview-script:
 *   post:
 *     summary: Preview how the user's actual script text will sound (raw audio bytes, not JSON)
 *     tags: [Comedy Reel]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text, voiceId]
 *             properties:
 *               text: { type: string, maxLength: 600, description: "Truncated to 600 chars server-side" }
 *               voiceId: { type: string }
 *               language: { type: string }
 *     responses:
 *       200:
 *         description: Raw audio bytes (audio/mpeg or audio/wav depending on voice provider)
 *       400:
 *         description: Missing text or voiceId
 *       401:
 *         description: Not authenticated
 *       402:
 *         description: Insufficient credits
 */
router.post('/preview-script', requireAuth, previewScript);

/**
 * @openapi
 * /comedy-reel/render-remotion:
 *   post:
 *     summary: Render the final comedy-reel video from two generated clips (server-side Remotion)
 *     description: >
 *       Streams progress as Server-Sent Events (status/progress/done/error). Called
 *       automatically right after generate-pipeline finishes in the live frontend's
 *       default flow.
 *     tags: [Comedy Reel]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               part1VideoUrl: { type: string }
 *               part2VideoUrl: { type: string }
 *               part1Duration: { type: number, example: 15 }
 *               part2Duration: { type: number, example: 15 }
 *     responses:
 *       200:
 *         description: text/event-stream of render progress events
 *       401:
 *         description: Not authenticated
 */
router.post('/render-remotion', requireAuth, renderRemotion);

export default router;
