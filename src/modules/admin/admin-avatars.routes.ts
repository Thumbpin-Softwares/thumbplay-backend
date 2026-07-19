import { Router } from 'express';
import multer from 'multer';
import { list, create, patchThumbnail, remove } from './admin-avatars.controller';
import { requireAdmin } from './admin.middleware';

const router: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @openapi
 * /admin/avatars:
 *   get:
 *     summary: List avatar collections, or fetch one collection's full file list
 *     description: >
 *       Concurrent-HEAD scan of R2's Avatars/ prefix, cached in-memory for 60s
 *       (invalidated on any create/update/delete). Pass ?collectionId= to get
 *       a single collection's full file list instead of the summary list.
 *     tags: [Admin Avatars]
 *     security:
 *       - adminCookieAuth: []
 *     parameters:
 *       - in: query
 *         name: collectionId
 *         required: false
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Collections list, or a single collection
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Collection not found
 *   post:
 *     summary: Create a new avatar collection (multipart upload)
 *     tags: [Admin Avatars]
 *     security:
 *       - adminCookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files:
 *                 type: array
 *                 items: { type: string, format: binary }
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Created collection
 *       400:
 *         description: Invalid input
 *   patch:
 *     summary: Set a collection's thumbnail
 *     tags: [Admin Avatars]
 *     security:
 *       - adminCookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [collectionId, thumbnailKey]
 *             properties:
 *               collectionId: { type: string }
 *               thumbnailKey: { type: string }
 *     responses:
 *       200:
 *         description: Updated cover image
 *   delete:
 *     summary: Delete an avatar collection
 *     tags: [Admin Avatars]
 *     security:
 *       - adminCookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [collectionId]
 *             properties:
 *               collectionId: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 */
router.get('/', requireAdmin, list);
router.post('/', requireAdmin, upload.array('files'), create);
router.patch('/', requireAdmin, patchThumbnail);
router.delete('/', requireAdmin, remove);

export default router;
