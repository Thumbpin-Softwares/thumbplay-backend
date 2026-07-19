import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { Asset } from '../asset/asset.model';
import { getReAvatars, ReAvatarCard, uploadAvatarCollection } from './re-avatars.service';

const MAX_IMAGES = 4;
type UploadFiles = Record<string, Express.Multer.File[]>;

// GET /avatars/re — SSE stream, same event contract as the old
// thumbpinclient route it replaces:
//   { type: "library", library: [...] }   — user's saved avatars (DB, sent first)
//   { type: "avatar",  avatar: {...} }    — one shared RE-avatar collection at a time
//   { type: "done" }
//   { type: "error", message }
export async function stream(req: AuthedRequest, res: Response): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const userId = req.user!._id.toString();
    const rows = await Asset.find({ userId, type: 'avatar' }).sort({ createdAt: -1 });
    send({
      type: 'library',
      library: rows.map((a) => ({
        id: a._id.toString(),
        name: a.name || 'Custom Avatar',
        url: a.url,
        createdAt: a.createdAt,
      })),
    });

    await getReAvatars((card: ReAvatarCard) => send({ type: 'avatar', avatar: card }));

    send({ type: 'done' });
  } catch (error) {
    console.error('[re-avatars stream]', error);
    send({ type: 'error', message: error instanceof Error ? error.message : 'Failed to load RE avatars' });
  } finally {
    res.end();
  }
}

// POST /avatars/upload — multipart presenterImage_0..3 + name. Common
// upload endpoint every template's Presenter/Avatar tile posts to.
export async function uploadCollection(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const files = (req as unknown as { files?: UploadFiles }).files;
  const picked: { buffer: Buffer; mimetype: string }[] = [];
  for (let i = 0; i < MAX_IMAGES; i++) {
    const f = files?.[`presenterImage_${i}`]?.[0];
    if (f) picked.push({ buffer: f.buffer, mimetype: f.mimetype });
  }

  const name = ((req.body?.name as string) || '').trim() || `Presenter — ${new Date().toLocaleDateString()}`;

  try {
    const result = await uploadAvatarCollection(userId, picked, name);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    console.error('[Avatars] uploadCollection error:', error);
    res.status(400).json({ error: message });
  }
}
