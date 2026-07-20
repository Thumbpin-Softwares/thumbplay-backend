import { fal } from '../reel/fal-client';
import { uploadToR2, buildUserKey } from '../reel/r2.service';

export interface BurnCaptionsInput {
  videoUrl: string;
  preset: string;
  language?: string;
  translationLanguage?: string;
  position?: string;
}

// fal/VEED validation errors come back as { body: { detail: [{ loc, msg }] } }
// rather than a plain message — surface the real reason (e.g. "bad preset")
// instead of a generic "request failed".
function extractFalErrorMessage(err: unknown): string {
  const body = (err as { body?: { detail?: unknown } } | undefined)?.body;
  const detail = body?.detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const loc = Array.isArray((d as { loc?: unknown[] }).loc) ? (d as { loc: unknown[] }).loc.join('.') : '';
        const msg = (d as { msg?: string }).msg ?? '';
        return loc ? `${loc}: ${msg}` : msg;
      })
      .join('; ');
  }
  if (typeof detail === 'string' && detail) return detail;
  return err instanceof Error ? err.message : 'Caption generation failed';
}

// Calls fal's veed/subtitles and re-uploads the result to our own R2 rather
// than trusting fal's URL to stay valid long-term, matching every other
// pipeline's convention.
export async function burnCaptionsAndUpload(userId: string, input: BurnCaptionsInput): Promise<string> {
  let result;
  try {
    result = await fal.subscribe('veed/subtitles', {
      input: {
        video_url: input.videoUrl,
        preset: input.preset,
        ...(input.language ? { language: input.language } : {}),
        ...(input.translationLanguage ? { translation_language: input.translationLanguage } : {}),
        ...(input.position ? { customization: { position: input.position } } : {}),
      },
      logs: false,
    });
  } catch (err) {
    throw new Error(extractFalErrorMessage(err));
  }

  const data = result?.data as { video?: { url?: string } } | undefined;
  const falVideoUrl = data?.video?.url;
  if (!falVideoUrl) throw new Error('VEED returned no video URL');

  const videoRes = await fetch(falVideoUrl);
  if (!videoRes.ok) throw new Error(`Failed to download captioned video: ${videoRes.status}`);
  const videoBuf = Buffer.from(await videoRes.arrayBuffer());

  const key = buildUserKey(userId, 'videos', 'mp4', `captions-${input.preset}-${Date.now()}`);
  return uploadToR2(videoBuf, key, 'video/mp4');
}
