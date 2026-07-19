import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import crypto from 'node:crypto';
import { env } from '../../config/env';

// Port of thumbpinclient/src/lib/r2.js + r2-upload.js, trimmed to what the
// reel pipelines actually call: uploadToR2, buildUserKey, extFromMime,
// resolveR2Url. getAssetUrl/getPresignedUploadUrl aren't used by these
// pipelines (skipped). normalizeKeyframes (ffmpeg re-encode for the editor's
// frame-accurate seeking) is also skipped — tied to the out-of-scope manual
// editor; clips still upload and play back fine without it.

// requestHandler timeouts raised above the SDK default — rendered video
// buffers can take a while to push over the wire.
export const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.r2AccessKeyId,
    secretAccessKey: env.r2SecretAccessKey,
  },
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 10_000,
    requestTimeout: 300_000,
  }),
  maxAttempts: 3,
});

export const BUCKET = env.r2BucketName;
export const R2_PUBLIC_URL = env.r2PublicUrl;

export interface UploadToR2Options {
  // Re-encode with a short keyframe interval before upload (see
  // video-normalize.service.ts). Opt-in and only worth the extra encode
  // time for clips that will be reopened/re-cut in the editor.
  normalizeKeyframes?: boolean;
}

export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType = 'application/octet-stream',
  options: UploadToR2Options = {},
): Promise<string> {
  let body = buffer;
  if (options.normalizeKeyframes) {
    try {
      const { normalizeKeyframesForSeeking } = await import('./video-normalize.service');
      body = await normalizeKeyframesForSeeking(buffer);
    } catch (e) {
      console.error('[uploadToR2] Keyframe normalization failed, uploading original:', e instanceof Error ? e.message : e);
      body = buffer;
    }
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return `${R2_PUBLIC_URL}/${key}`;
}

// Resolves an internal `/api/r2?key=...` proxy URL (as handed back by
// thumbpinclient's asset hooks) into an absolute R2 URL a server-side fetch
// can actually reach — no-op for already-absolute URLs.
export function resolveR2Url(url: string | undefined | null): string | undefined | null {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http')) return url;
  if (url.includes('/api/r2?key=')) {
    const key = decodeURIComponent(url.split('?key=')[1] || '');
    if (key) return `${R2_PUBLIC_URL}/${key}`;
  }
  return url;
}

// e.g. "users/abc123/videos/sreel-part1-1715000000000-a1b2c3d4.mp4"
export function buildUserKey(userId: string, category: string, ext: string, prefix = 'asset'): string {
  const timestamp = Date.now();
  const id = crypto.randomUUID().split('-')[0]; // short random suffix
  return `users/${userId}/${category}/${prefix}-${timestamp}-${id}.${ext}`;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

export function extFromMime(mimeType = ''): string {
  return MIME_TO_EXT[mimeType] || mimeType.split('/')[1] || 'bin';
}
