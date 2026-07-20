import { Request, Response } from 'express';
import { listMusicTracks } from '../reel/r2.service';

export async function list(_req: Request, res: Response) {
  try {
    const tracks = await listMusicTracks();
    res.json({ tracks });
  } catch (err) {
    console.error('[music] list error:', err);
    res.json({ tracks: [] });
  }
}
