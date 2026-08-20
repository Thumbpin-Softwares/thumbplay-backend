import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

async function downloadToTmp(url: string, path: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

// Concatenates videos (by URL, in order) into one mp4 - used to prepend/append
// a branded intro/outro clip to a generated video, and to stitch multi-clip
// sequences (e.g. Studio's narrated drone sequence) into one continuous file.
// Same execFile-the-ffmpeg-binary pattern as normalizeKeyframesForSeeking
// above, just concat instead of re-encode-for-seeking.
//
// Tries the concat demuxer with `-c copy` first (fast, no quality loss, no
// re-encode) - only falls back to a full re-encode if that fails, which is
// realistic here since the inputs are typically clips from different
// generation calls (branding bumper rendered by Remotion vs. a fal.ai-
// generated scene) that don't necessarily share identical codec parameters,
// unlike normalizeKeyframesForSeeking's single-source case.
export async function concatVideos(urls: string[]): Promise<Buffer> {
  const [url, ...rest] = urls;
  if (!url) throw new Error('concatVideos requires at least one URL');
  if (rest.length === 0) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  const id = crypto.randomUUID();
  const pairs = urls.map((url, i) => ({ url, path: join(tmpdir(), `concat-in-${id}-${i}.mp4`) }));
  const inPaths = pairs.map((p) => p.path);
  const listPath = join(tmpdir(), `concat-list-${id}.txt`);
  const outPath = join(tmpdir(), `concat-out-${id}.mp4`);

  try {
    await Promise.all(pairs.map(({ url, path }) => downloadToTmp(url, path)));

    const listContents = inPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    await writeFile(listPath, listContents);

    try {
      await execFileAsync(ffmpegPath as unknown as string, [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        outPath,
      ]);
    } catch {
      // Mismatched codec params across inputs - re-encode instead of a
      // stream copy.
      await execFileAsync(ffmpegPath as unknown as string, [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        outPath,
      ]);
    }

    return await readFile(outPath);
  } finally {
    await Promise.all(inPaths.map((p) => unlink(p).catch(() => {})));
    await unlink(listPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

// Mixes a background music track under a video (by URL) as its only audio -
// used for Studio's drone-flythrough, which has no dialogue/narration of its
// own. `-shortest` truncates to whichever input is shorter - fine here since
// the music library's stock tracks all run well over a 15s clip. Video
// stream is stream-copied (no re-encode, fast); only the audio is encoded.
export async function mixBackgroundMusic(videoUrl: string, musicUrl: string): Promise<Buffer> {
  const id = crypto.randomUUID();
  const videoPath = join(tmpdir(), `mix-video-${id}.mp4`);
  const musicPath = join(tmpdir(), `mix-music-${id}.mp3`);
  const outPath = join(tmpdir(), `mix-out-${id}.mp4`);

  try {
    await Promise.all([downloadToTmp(videoUrl, videoPath), downloadToTmp(musicUrl, musicPath)]);

    await execFileAsync(ffmpegPath as unknown as string, [
      '-y',
      '-i', videoPath,
      '-i', musicPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      '-movflags', '+faststart',
      outPath,
    ]);

    return await readFile(outPath);
  } finally {
    await unlink(videoPath).catch(() => {});
    await unlink(musicPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}
