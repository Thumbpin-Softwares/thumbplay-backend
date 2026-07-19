import { Router } from 'express';
import multer from 'multer';
import { stream, uploadCollection } from './re-avatars.controller';
import { requireAuth } from '../auth/auth.middleware';

const router: Router = Router();

const upload = multer({ storage: multer.memoryStorage() });
const avatarUploadFields = upload.fields([
  { name: 'presenterImage_0', maxCount: 1 },
  { name: 'presenterImage_1', maxCount: 1 },
  { name: 'presenterImage_2', maxCount: 1 },
  { name: 'presenterImage_3', maxCount: 1 },
]);

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

/**
 * @openapi
 * /avatars/upload:
 *   post:
 *     summary: Upload 1-4 presenter photos as a new avatar collection (common upload endpoint for every template)
 *     tags: [Avatars]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               presenterImage_0: { type: string, format: binary }
 *               presenterImage_1: { type: string, format: binary }
 *               presenterImage_2: { type: string, format: binary }
 *               presenterImage_3: { type: string, format: binary }
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Created collection
 *       400:
 *         description: Invalid input
 */
router.post('/upload', requireAuth, avatarUploadFields, uploadCollection);

export default router;
