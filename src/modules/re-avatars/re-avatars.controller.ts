import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { Asset } from '../asset/asset.model';
import { getReAvatars, ReAvatarCard } from './re-avatars.service';

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
