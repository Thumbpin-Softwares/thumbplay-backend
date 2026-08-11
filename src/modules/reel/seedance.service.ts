import { fal } from './fal-client';
import { synthesizeVoice } from './tts.service';
import { uploadToR2, buildUserKey } from './r2.service';

// Port of generateAndUploadTTS + callSeedanceAndUpload - duplicated
// identically (aside from key prefixes) across all three pipelines.

export async function generateAndUploadTTS(
  text: string,
  voiceId: string,
  userId: string,
  keyPrefix: string,
  language: string,
): Promise<string> {
  const { buffer, contentType, ext } = await synthesizeVoice({ text, voiceId, language });
  const key = buildUserKey(userId, 'audio', ext, keyPrefix);
  return uploadToR2(buffer, key, contentType);
}

export interface SeedanceInput {
  prompt: string;
  aspect_ratio: string;
  duration: string;
  resolution: string;
  generate_audio: boolean;
  image_urls?: string[];
  audio_urls?: string[];
}

export async function callSeedanceAndUpload(
  seedanceInput: SeedanceInput,
  userId: string,
  keyName: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await fal.subscribe('bytedance/seedance-2.0/fast/reference-to-video', {
    input: seedanceInput,
    logs: false,
    ...(signal ? { abortSignal: signal } : {}),
  });
  const data = result?.data as { video?: { url?: string } } | undefined;
  const falVideoUrl = data?.video?.url;
  if (!falVideoUrl) throw new Error('Seedance returned no video URL');

  const videoRes = await fetch(falVideoUrl, signal ? { signal } : {});
  if (!videoRes.ok) throw new Error(`Failed to fetch Seedance video: ${videoRes.status}`);
  const videoBuf = Buffer.from(await videoRes.arrayBuffer());
  const key = buildUserKey(userId, 'videos', 'mp4', keyName);
  return uploadToR2(videoBuf, key, 'video/mp4');
}
