import { Router } from 'express';
import { generatePipeline, getJob, previewScript } from './seedance-reel.controller';
import { requireAuth } from '../auth/auth.middleware';
import { reelUploadFields } from '../reel/upload.middleware';
import { createRenderRemotionHandler } from '../render/render.controller';

const router: Router = Router();

// Matches the source's "luxury-car-exit" render profile (this pipeline's
// live current source): ultrafast preset + concurrency 4, no retry wrapper.
const renderRemotion = createRenderRemotionHandler({
  logLabel: 'SeedanceReel',
  tempFilePrefix: 'seedance-reel',
  r2KeyPrefix: 'sreel-final',
  assetDisplayName: 'Seedance Reel',
  assetSource: 'seedance-reel-export',
  exportedFrom: 'seedance-reel',
  x264Preset: 'ultrafast',
  concurrency: 2,
  withRetry: false,
});

/**
 * @openapi
 * /seedance-reel/generate-pipeline:
 *   post:
 *     summary: Generate the two Seedance clips for a seedance-reel ("car exit" theme) video
 *     description: >
 *       Streams progress as Server-Sent Events (text/event-stream) - script split, TTS,
 *       template reproduction, two parallel Seedance generations, R2 upload, then a
 *       terminal `video_ready`/`done` or `error` event. Not a typical JSON request/response;
 *       consume with an EventSource-style client. Charges the `real_estate_video` credit
 *       action up front, refunded on total failure.
 *     tags: [Seedance Reel]
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
 *               jobId: { type: string, description: "Client-generated UUID, must be unique" }
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
 * /seedance-reel/jobs/{jobId}:
 *   get:
 *     summary: Resume/poll a seedance-reel generation job
 *     tags: [Seedance Reel]
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
 * /seedance-reel/preview-script:
 *   post:
 *     summary: Preview how the user's actual script text will sound (raw audio bytes, not JSON)
 *     tags: [Seedance Reel]
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
 * /seedance-reel/render-remotion:
 *   post:
 *     summary: Render the final seedance-reel video from two generated clips (server-side Remotion)
 *     description: >
 *       Streams progress as Server-Sent Events (status/progress/done/error). Called
 *       automatically right after generate-pipeline finishes in the live frontend's
 *       default flow. Body is the ActionReel composition's inputProps (clip URLs,
 *       durations, plus overlays/music/cutRanges/trim fields for shape-compatibility -
 *       unpopulated by the default generate flow).
 *     tags: [Seedance Reel]
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
