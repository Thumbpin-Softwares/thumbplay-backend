import express, { NextFunction, Response, Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../auth/auth.middleware';
import { AuthedRequest } from '../auth/auth.types';
import { create, serve } from './temp-files.controller';

const router: Router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function requireAuthOrTempFileSecret(req: AuthedRequest, res: Response, next: NextFunction): void {
  const configuredSecret = process.env.TEMP_FILE_SECRET;
  const sentSecret = req.headers['x-temp-file-secret'];
  if (configuredSecret && sentSecret === configuredSecret) {
    next();
    return;
  }
  void requireAuth(req, res, next);
}

/**
 * @openapi
 * /temp-files:
 *   post:
 *     summary: Create a temporary public local file URL
 *     description: >
 *       Accepts either multipart/form-data with a `file` field, JSON with
 *       `fileUrl`, or a raw binary body. The returned URL is public until the
 *       requested expiry, then the local file is removed.
 *     tags: [Temp Files]
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
 *               expiresInSeconds: { type: number, example: 3600 }
 *               expiresAt: { type: string, format: date-time }
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileUrl]
 *             properties:
 *               fileUrl: { type: string }
 *               filename: { type: string }
 *               contentType: { type: string }
 *               expiresInSeconds: { type: number, example: 3600 }
 *               expiresAt: { type: string, format: date-time }
 *         application/octet-stream:
 *           schema:
 *             type: string
 *             format: binary
 *     responses:
 *       201:
 *         description: Temporary public URL created
 *       400:
 *         description: Validation error
 */
router.post(
  '/',
  requireAuthOrTempFileSecret,
  upload.single('file'),
  express.raw({
    type: ['application/octet-stream', 'audio/*', 'video/*', 'image/*', 'application/pdf'],
    limit: '100mb',
  }),
  create,
);

/**
 * @openapi
 * /temp-files/{id}/{filename}:
 *   get:
 *     summary: Serve a temporary public local file until expiry
 *     tags: [Temp Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: filename
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: File stream
 *       404:
 *         description: Not found
 *       410:
 *         description: Expired
 */
router.get('/:id/:filename', serve);
router.get('/:id', serve);

export default router;
