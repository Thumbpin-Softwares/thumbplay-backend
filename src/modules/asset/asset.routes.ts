import { Router } from 'express';
import multer from 'multer';
import { list, update, remove, uploadSingle, mintUploadUrl, confirmUpload } from './asset.controller';
import { requireAuth } from '../auth/auth.middleware';

const router: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const singleFile = upload.single('file');

/**
 * @openapi
 * /assets:
 *   get:
 *     summary: List the current user's assets, paginated and optionally type-filtered
 *     tags: [Assets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *         description: Single type, or comma-separated for an $in match
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated asset list
 *   patch:
 *     summary: Rename an asset, or reorder a collection's cover photo
 *     tags: [Assets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               thumbnailUrl: { type: string, description: "Must already be one of the asset's metadata.urls" }
 *     responses:
 *       200:
 *         description: Updated asset
 *   delete:
 *     summary: Delete one asset (?id=) or many (body { ids: [...] })
 *     tags: [Assets]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: id
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Deletion result
 */
router.get('/', requireAuth, list);
router.patch('/', requireAuth, update);
router.delete('/', requireAuth, remove);

/**
 * @openapi
 * /assets/upload:
 *   post:
 *     summary: Upload a single small file (multipart, server-routed)
 *     description: >
 *       Only safe for files within this server's own request body limit — the
 *       Asset Library page instead uses upload-url + confirm for arbitrary-size uploads.
 *     tags: [Assets]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, type]
 *             properties:
 *               file: { type: string, format: binary }
 *               name: { type: string }
 *               type: { type: string }
 *               category: { type: string }
 *     responses:
 *       200:
 *         description: Created asset
 *       400:
 *         description: Validation error
 */
router.post('/upload', requireAuth, singleFile, uploadSingle);

/**
 * @openapi
 * /assets/upload-url:
 *   post:
 *     summary: Mint a presigned R2 PUT URL for a direct-from-browser upload (step 1 of 2)
 *     tags: [Assets]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contentType]
 *             properties:
 *               contentType: { type: string }
 *               fileSize: { type: number }
 *               category: { type: string }
 *     responses:
 *       200:
 *         description: "{ uploadUrl, key, publicUrl }"
 *       400:
 *         description: Validation error
 */
router.post('/upload-url', requireAuth, mintUploadUrl);

/**
 * @openapi
 * /assets/confirm:
 *   post:
 *     summary: Persist the Asset doc after a direct-to-R2 PUT succeeded (step 2 of 2)
 *     tags: [Assets]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key, url, type]
 *             properties:
 *               key: { type: string }
 *               url: { type: string }
 *               name: { type: string }
 *               type: { type: string }
 *               originalName: { type: string }
 *     responses:
 *       200:
 *         description: Created asset
 *       400:
 *         description: Validation error
 *       403:
 *         description: Key doesn't belong to this user
 */
router.post('/confirm', requireAuth, confirmUpload);

export default router;
