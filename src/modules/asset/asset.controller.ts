import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { Asset, AssetType } from './asset.model';
import { uploadToR2, buildUserKey, extFromMime, getPresignedUploadUrl, R2_PUBLIC_URL } from '../reel/r2.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, no-cache, must-revalidate' };

// GET /assets — list, paginated, optionally type-filtered (comma-separated
// for $in). Belt-and-suspenders no-store headers: query params like
// ?page=1&limit=24 are identical across every user, so any cache layer that
// ignores the Cookie/Authorization header could otherwise serve user A's
// list to user B.
export async function list(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).set(NO_STORE_HEADERS).json({ error: 'Unauthorized' });
    return;
  }

  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const query: Record<string, unknown> = { userId };
  if (type) query.type = type.includes(',') ? { $in: type.split(',') } : type;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
  const limit = Math.min(Math.max(1, parseInt((req.query.limit as string) || '24', 10) || 24), 50);
  const skip = (page - 1) * limit;

  const [assets, total] = await Promise.all([
    Asset.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).allowDiskUse(true),
    Asset.countDocuments(query),
  ]);

  res.status(200).set(NO_STORE_HEADERS).json({
    assets,
    total,
    page,
    hasMore: skip + assets.length < total,
  });
}

// GET /user/videos — video/clip subset, its own response shape (not the
// same as list()'s) matching thumbpinclient's dedicated route exactly,
// since modules/edit/components/video-picker reads `videos`/`pagination`
// (not `hasMore`) from it.
export async function listVideos(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '20', 10) || 20));
  const skip = (page - 1) * limit;

  const query: Record<string, unknown> = { userId, type: { $in: ['video', 'clip'] } };
  const [videos, total] = await Promise.all([
    Asset.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Asset.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    videos: videos.map((v) => ({
      id: (v._id as { toString(): string }).toString(),
      name: v.name,
      url: v.url,
      type: v.type,
      metadata: v.metadata || {},
      createdAt: v.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// PATCH /assets?id= — rename, or (thumbnailUrl set) reorder a collection's
// metadata.urls so the chosen photo becomes the cover everywhere it's read
// (asset.url / urls[0]).
export async function update(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const id = typeof req.query.id === 'string' ? req.query.id : undefined;
  if (!id) {
    res.status(400).json({ error: 'Missing asset ID' });
    return;
  }

  const { name, thumbnailUrl } = (req.body ?? {}) as { name?: string; thumbnailUrl?: string };
  if (!name?.trim() && !thumbnailUrl) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }

  if (thumbnailUrl) {
    const asset = await Asset.findOne({ _id: id, userId });
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    const urls = asset.metadata?.urls as string[] | undefined;
    if (!Array.isArray(urls) || !urls.includes(thumbnailUrl)) {
      res.status(400).json({ error: 'Photo not found in this collection' });
      return;
    }

    asset.metadata = { ...asset.metadata, urls: [thumbnailUrl, ...urls.filter((u) => u !== thumbnailUrl)] };
    asset.url = thumbnailUrl;
    if (name?.trim()) asset.name = name.trim();
    await asset.save();

    res.status(200).json({ success: true, asset });
    return;
  }

  const asset = await Asset.findOneAndUpdate({ _id: id, userId }, { name: (name as string).trim() }, { new: true });
  if (!asset) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }

  res.status(200).json({ success: true, asset });
}

// DELETE /assets?id= (single) or DELETE /assets with body { ids: [...] } (bulk).
export async function remove(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const id = typeof req.query.id === 'string' ? req.query.id : undefined;

  if (id) {
    const asset = await Asset.findOneAndDelete({ _id: id, userId });
    if (!asset) {
      res.status(404).json({ error: 'Asset not found or unauthorized' });
      return;
    }
    res.status(200).json({ success: true });
    return;
  }

  const ids = (req.body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'Missing asset ID(s)' });
    return;
  }

  const result = await Asset.deleteMany({ _id: { $in: ids }, userId });
  res.status(200).json({ success: true, deletedCount: result.deletedCount });
}

type UploadFile = { buffer: Buffer; mimetype: string; originalname?: string; size: number };

// POST /assets/upload — single-shot multipart upload, server-side. Only
// safe for small files (this server's own request body limit) — the
// Asset Library page instead uses the upload-url/confirm presigned flow
// for arbitrary-size uploads.
export async function uploadSingle(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const file = (req as unknown as { file?: UploadFile }).file;
  const body = req.body as Record<string, string | undefined>;
  const name = (body.name || 'Untitled Asset').toString();
  const type = body.type;
  const category = body.category || 'uploads';

  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  // thumbpinclient's version defaulted an unset `type` to "general", which
  // isn't a valid Asset.type enum value — every real caller already passes
  // one, so this just rejects the gap instead of carrying a dormant 500.
  if (!type) {
    res.status(400).json({ error: 'type is required' });
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    res.status(400).json({ error: 'File too large (max 10 MB)' });
    return;
  }
  if (!ALLOWED_TYPES.has(file.mimetype)) {
    res.status(400).json({ error: `Unsupported file type: ${file.mimetype}` });
    return;
  }

  const ext = extFromMime(file.mimetype) || 'bin';
  const key = buildUserKey(userId, category, ext, category);
  const url = await uploadToR2(file.buffer, key, file.mimetype);

  const asset = await Asset.create({
    userId,
    name: name.trim().substring(0, 100),
    url,
    // Mongoose validates this against the real enum at write time — a bad
    // value 400s here just as it would have with an unvalidated cast.
    type: type as AssetType,
    metadata: { is_custom: true, r2Key: key, originalName: file.originalname || '' },
  });

  res.status(200).json({ success: true, asset });
}

// POST /assets/upload-url — step 1 of the direct-to-R2 upload flow: mint a
// presigned PUT URL (tiny JSON, no file bytes) instead of routing the file
// through this server. The client PUTs straight to R2, then calls /confirm.
export async function mintUploadUrl(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { contentType, fileSize, category = 'uploads' } = (req.body ?? {}) as {
    contentType?: string;
    fileSize?: number;
    category?: string;
  };

  if (!contentType || !ALLOWED_TYPES.has(contentType)) {
    res.status(400).json({ error: `Unsupported file type: ${contentType}` });
    return;
  }
  if (typeof fileSize === 'number' && fileSize > MAX_FILE_SIZE) {
    res.status(400).json({ error: 'File too large (max 10 MB)' });
    return;
  }

  const ext = extFromMime(contentType) || 'bin';
  const key = buildUserKey(userId, category, ext, category);
  const uploadUrl = await getPresignedUploadUrl(key, contentType);
  const publicUrl = `${R2_PUBLIC_URL}/${key}`;

  res.status(200).json({ uploadUrl, key, publicUrl });
}

// POST /assets/confirm — step 2 of the direct-to-R2 flow: persist the Asset
// doc after the client has already PUT the file straight to the presigned
// URL. The key must fall under this user's own prefix — upload-url only
// ever issues keys there, so anything else means a client trying to
// register someone else's key (or an arbitrary external URL) as its own.
export async function confirmUpload(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { key, url, name, type, originalName } = (req.body ?? {}) as {
    key?: string;
    url?: string;
    name?: string;
    type?: string;
    originalName?: string;
  };

  if (!key || !url) {
    res.status(400).json({ error: 'key and url are required' });
    return;
  }
  if (!key.startsWith(`users/${userId}/`)) {
    res.status(403).json({ error: 'Invalid asset key' });
    return;
  }
  // thumbpinclient's version defaulted an unset `type` to "general", which
  // isn't a valid Asset.type enum value — every real caller already passes
  // one, so this just rejects the gap instead of carrying a dormant 500.
  if (!type) {
    res.status(400).json({ error: 'type is required' });
    return;
  }

  const asset = await Asset.create({
    userId,
    name: (name || 'Untitled Asset').trim().substring(0, 100),
    url,
    type: type as AssetType,
    metadata: { is_custom: true, r2Key: key, originalName: originalName || '' },
  });

  res.status(200).json({ success: true, asset });
}
