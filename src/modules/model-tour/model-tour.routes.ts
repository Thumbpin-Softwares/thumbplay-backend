import { Router } from 'express';
import multer from 'multer';
import {
  uploadProperty,
  getScript,
  generate,
  getJob,
  listGenerations,
  handleN8nWebhook,
  regenerateChunkHandler,
  combineHandler,
} from './model-tour.controller';
import { requireAuth } from '../auth/auth.middleware';

const router: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const propertyUploadField = upload.fields([{ name: 'file', maxCount: 1 }]);
const webhookUploadField = upload.fields([{ name: 'file', maxCount: 1 }]);

// Avatar collection upload moved to the common /avatars/upload endpoint
// (re-avatars module) - every template posts there now, not here.

/**
 * @openapi
 * /model-tour/upload/property:
 *   post:
 *     summary: Upload a single property photo (saved to the user's Asset library)
 *     tags: [Model Tour]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Created asset
 *       400:
 *         description: Invalid input
 */
router.post('/upload/property', requireAuth, propertyUploadField, uploadProperty);

/**
 * @openapi
 * /model-tour/webhook:
 *   post:
 *     summary: Webhook for n8n to send the final video
 *     tags: [Model Tour]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, jobId, userId]
 *             properties:
 *               file: { type: string, format: binary }
 *               jobId: { type: string }
 *               userId: { type: string }
 *     responses:
 *       200:
 *         description: Video processed
 */
router.post('/webhook', webhookUploadField, handleN8nWebhook);

/**
 * @openapi
 * /model-tour/script:
 *   post:
 *     summary: Start the model-tour script generation job (checkpoint step) via the n8n workflow
 *     description: >
 *       Async - responds 202 with a jobId immediately; n8n predicts avatar gender from images,
 *       merges the form inputs, and builds the master prompt for the given property type in the
 *       background (can exceed Vercel's ~60s edge-response timeout). Poll GET
 *       /model-tour/jobs/:jobId until status is "done", then read `result` for the script JSON.
 *       The frontend shows this in the finalize step, where it can be edited before being sent
 *       to /model-tour/generate.
 *     tags: [Model Tour]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyName, avatarImageUrls, propertyImageUrls]
 *             properties:
 *               propertyName: { type: string }
 *               type: { type: string, enum: [residential, commercial, plotted] }
 *               locationLandmarks: { type: string }
 *               connectivity: { type: string }
 *               language: { type: string }
 *               tierClass: { type: string }
 *               carpetArea: { type: string }
 *               amenities: { type: string }
 *               tonality: { type: string }
 *               vibe: { type: string }
 *               avatarImageUrls: { type: array, items: { type: string }, minItems: 1, maxItems: 4 }
 *               propertyImageUrls: { type: array, items: { type: string }, minItems: 1, maxItems: 4 }
 *     responses:
 *       202:
 *         description: "{ jobId }"
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 */
router.post('/script', requireAuth, getScript);

/**
 * @openapi
 * /model-tour/generate:
 *   post:
 *     summary: Generate a home-tour video via the n8n model-tour workflow
 *     description: >
 *       Streams progress as Server-Sent Events. Takes the script JSON from /model-tour/script
 *       (as edited by the user in the finalize step) and sends it back to n8n to actually
 *       render the video. Charges the `real_estate_video` credit action up front, refunded
 *       on failure.
 *     tags: [Model Tour]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [jobId, script]
 *             properties:
 *               jobId: { type: string, description: "Client-generated UUID, must be unique" }
 *               script: { type: object, description: "The (possibly edited) JSON returned by /model-tour/script" }
 *     responses:
 *       200:
 *         description: text/event-stream of generation progress
 *       400:
 *         description: Validation error
 *       401:
 *         description: Not authenticated
 *       402:
 *         description: Insufficient credits
 *       409:
 *         description: jobId already exists
 */
router.post('/generate', requireAuth, generate);

/**
 * @openapi
 * /model-tour/jobs/{jobId}:
 *   get:
 *     summary: Resume/poll a model-tour generation job
 *     tags: [Model Tour]
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
 * /model-tour/jobs/{jobId}/chunks/{index}/regenerate:
 *   post:
 *     summary: Regenerate one scene clip (1-based index) of a chunks_ready job
 *     description: >
 *       Responds 202 immediately and runs detached from the request (same pattern as
 *       studio.controller.ts's generate) since a single chunk regen can take 1-3 minutes.
 *       Poll GET /model-tour/jobs/{jobId} for the chunk's updated status/url. Charges the
 *       `model_tour_chunk_regeneration` credit action up front, refunded on failure.
 *     tags: [Model Tour]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: index
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       202:
 *         description: "{ jobId, chunkIndex }"
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Job or chunk not found
 *       409:
 *         description: Job not in chunks_ready status, or chunk already regenerating
 *       402:
 *         description: Insufficient credits
 */
router.post('/jobs/:jobId/chunks/:index/regenerate', requireAuth, regenerateChunkHandler);

/**
 * @openapi
 * /model-tour/jobs/{jobId}/combine:
 *   post:
 *     summary: Combine the current set of 6 chunks and hand off to the splitter/voice-change workflow
 *     description: >
 *       Responds 202 immediately and runs detached from the request. The existing
 *       POST /model-tour/webhook callback marks the job done once the splitter workflow finishes,
 *       same as before this feature existed.
 *     tags: [Model Tour]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202:
 *         description: "{ jobId }"
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Job not found
 *       409:
 *         description: Job not in chunks_ready status, or a chunk is still regenerating
 */
router.post('/jobs/:jobId/combine', requireAuth, combineHandler);

/**
 * @openapi
 * /model-tour/generations:
 *   get:
 *     summary: List the user's own model-tour generations (newest first), including in-progress ones
 *     tags: [Model Tour]
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
