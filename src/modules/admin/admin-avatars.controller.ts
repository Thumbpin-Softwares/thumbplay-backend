import { Request, Response } from 'express';
import {
  listCollections,
  getCollection,
  createCollection,
  deleteCollection,
  setThumbnail,
  AdminAvatarType,
} from './admin-avatars.service';

const VALID_TYPES: AdminAvatarType[] = ['product', 'real-estate'];
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/jpg']);

// GET /admin/avatars — list all collections, or ?collectionId= for one with its full file list.
export async function list(req: Request, res: Response): Promise<void> {
  const collectionId = typeof req.query.collectionId === 'string' ? req.query.collectionId : undefined;

  if (collectionId) {
    const collection = await getCollection(collectionId);
    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.status(200).json({ collection });
    return;
  }

  const result = await listCollections();
  res.status(200).json(result);
}

// POST /admin/avatars — multipart: files[], type, name.
export async function create(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const type = req.body?.type as AdminAvatarType;
  const name = (req.body?.name as string) || `Collection_${Date.now()}`;

  if (files.length === 0) {
    res.status(400).json({ error: 'files are required' });
    return;
  }
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ error: "type must be 'product' or 'real-estate'" });
    return;
  }
  const invalidFile = files.find((f) => !ALLOWED_MIME_TYPES.has(f.mimetype));
  if (invalidFile) {
    res.status(400).json({ error: `Only PNG, JPG, WEBP images are allowed. Invalid file: ${invalidFile.originalname}` });
    return;
  }

  try {
    const collection = await createCollection({
      type,
      name,
      files: files.map((f) => ({ buffer: f.buffer, contentType: f.mimetype, originalName: f.originalname })),
    });
    res.status(200).json({ success: true, collection });
  } catch (error) {
    console.error('[admin-avatars create]', error);
    res.status(500).json({ error: 'Upload failed' });
  }
}

// PATCH /admin/avatars — { collectionId, thumbnailKey }
export async function patchThumbnail(req: Request, res: Response): Promise<void> {
  const { collectionId, thumbnailKey } = req.body ?? {};
  if (!collectionId || !thumbnailKey) {
    res.status(400).json({ error: 'collectionId and thumbnailKey are required' });
    return;
  }

  try {
    const { coverImage } = await setThumbnail(collectionId, thumbnailKey);
    res.status(200).json({ success: true, coverImage, thumbnailKey });
  } catch (error) {
    console.error('[admin-avatars patchThumbnail]', error);
    res.status(500).json({ error: 'Failed to set thumbnail' });
  }
}

// DELETE /admin/avatars — { collectionId }
export async function remove(req: Request, res: Response): Promise<void> {
  const { collectionId } = req.body ?? {};
  if (!collectionId) {
    res.status(400).json({ error: 'collectionId is required' });
    return;
  }

  try {
    const { deletedCount } = await deleteCollection(collectionId);
    res.status(200).json({ success: true, deletedCount });
  } catch (error) {
    console.error('[admin-avatars remove]', error);
    res.status(500).json({ error: 'Failed to delete collection' });
  }
}
