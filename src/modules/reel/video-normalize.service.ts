import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

// Port of thumbpinclient/src/lib/video-normalize.js - re-encodes a video
// buffer with a short, fixed keyframe interval so Remotion's OffthreadVideo
// can seek to any mid-clip frame without landing on a black frame (the
// editor's Cut tool re-bases surviving chunks to arbitrary frames; AI
// generation providers optimize source keyframe spacing for streaming, not
// scrubbing). Only worth paying the re-encode cost for clips that will
// actually be reopened in the editor - not on already-flattened exports
// that are never seeked into again (callers opt in per-upload).
export async function normalizeKeyframesForSeeking(buffer: Buffer): Promise<Buffer> {
  const id = crypto.randomUUID();
  const inPath = join(tmpdir(), `normalize-in-${id}.mp4`);
  const outPath = join(tmpdir(), `normalize-out-${id}.mp4`);

  try {
    await writeFile(inPath, buffer);

    await execFileAsync(ffmpegPath as unknown as string, [
      '-y',
      '-i', inPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-g', '15',
      '-keyint_min', '15',
      '-sc_threshold', '0',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outPath,
    ]);

    return await readFile(outPath);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}
