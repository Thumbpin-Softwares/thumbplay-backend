import { Response } from 'express';
import sharp from 'sharp';
import { AuthedRequest } from '../auth/auth.types';
import { ReelJob } from '../reel/reel-job.model';
import { Asset } from '../asset/asset.model';
import { consumeCreditsForAction, refundCreditsForAction, ConsumeDebit } from '../credit/credit.service';
import { uploadToR2, buildUserKey, extFromMime, R2_PUBLIC_URL } from '../reel/r2.service';
import { splitScript } from '../reel/script-split.service';
import { adaptScriptParts } from '../reel/language-adapt.service';
import { reproduceTemplate } from '../reel/template-reproduce.service';
import { generateAndUploadTTS, callSeedanceAndUpload } from '../reel/seedance.service';
import { startSse } from '../reel/sse';
import { createPreviewScriptHandler } from '../reel/preview-script.controller';
import {
  MASTER_TEMPLATE_A,
  MASTER_TEMPLATE_B,
  TEMPLATE_MARKERS,
  buildReproducePrompt,
  fillTemplateAFallback,
  fillTemplateBFallback,
} from './action-reel.templates';

const CREDIT_ACTION = 'action_reel_video';
const LOG = '[ActionReel]';

// Always resolves to "720p" - vestigial in the source.
function resolutionForQuality(_quality: string): string {
  return '720p';
}

type ReelUploadFiles = Record<string, Express.Multer.File[]>;

// Declared as plain AuthedRequest (not a Request subtype adding `files`) so
// Express's route-array type-unification across [requireAuth, reelUploadFields,
// generatePipeline] doesn't misresolve the overload - multer attaches `.files`
// at runtime regardless; accessed here via a narrow internal cast.
export async function generatePipeline(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  const files = (req as unknown as { files?: ReelUploadFiles }).files;
  let debit: ConsumeDebit | undefined;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const body = req.body as Record<string, string | undefined>;
    const script = (body.script || '').toString().trim();
    const voiceId = (body.voiceId || '21m00Tcm4TlvDq8ikWAM').toString();
    const language = (body.language || 'english').toString();
    const jobId = (body.jobId || '').toString().trim();
    const quality = (body.quality || 'auto').toString();
    const resolution = resolutionForQuality(quality);

    if (!script || script.length < 30) {
      res.status(400).json({ error: 'script is required (min 30 chars)' });
      return;
    }
    if (!jobId) {
      res.status(400).json({ error: 'jobId is required' });
      return;
    }

    const existingJob = await ReelJob.findOne({ jobId }).lean();
    if (existingJob) {
      res.status(409).json({ error: 'Job already exists', jobId });
      return;
    }

    const avatarUrls: string[] = [];
    for (let i = 0; i < 3; i++) {
      const v = body[`avatarUrl_${i}`];
      if (!v || typeof v !== 'string') continue;
      if (v.startsWith('http')) {
        avatarUrls.push(v);
      } else if (v.includes('/api/r2?key=') && R2_PUBLIC_URL) {
        const key = decodeURIComponent(v.split('?key=')[1] || '');
        if (key) avatarUrls.push(`${R2_PUBLIC_URL}/${key}`);
      }
    }
    console.log(`${LOG} Resolved ${avatarUrls.length} avatar URL(s):`, avatarUrls);

    const locationBufs: Buffer[] = [];
    for (let i = 0; i < 4; i++) {
      const f = files?.[`locationImage_${i}`]?.[0];
      if (f) locationBufs.push(f.buffer);
    }

    const customVoiceFile = files?.customVoiceFile?.[0];
    const customVoiceBuf = customVoiceFile?.buffer ?? null;
    const customVoiceMimeType = customVoiceFile?.mimetype ?? 'audio/webm';

    if (avatarUrls.length === 0 && locationBufs.length === 0) {
      res.status(400).json({ error: 'At least avatar URLs or location images are required' });
      return;
    }

    const creditResult = await consumeCreditsForAction({
      userId,
      action: CREDIT_ACTION,
      metadata: { endpoint: '/api/v1/action-reel/generate-pipeline' },
    });
    if (!creditResult.ok) {
      res.status(creditResult.status).json(creditResult.payload);
      return;
    }
    debit = creditResult.debit;

    await ReelJob.create({ jobId, userId, status: 'running' });

    const locationR2Urls: string[] = [];
    await Promise.all(
      locationBufs.map(async (buf, i) => {
        try {
          const cropped = await sharp(buf).resize(1080, 1920, { fit: 'cover', position: 'centre' }).jpeg({ quality: 88 }).toBuffer();
          const key = buildUserKey(userId, 'images', 'jpg', `areel-location-${i}`);
          const url = await uploadToR2(cropped, key, 'image/jpeg');
          if (url.startsWith('http')) locationR2Urls[i] = url;
        } catch (e) {
          console.warn(`${LOG} Failed to upload location image ${i}:`, e instanceof Error ? e.message : e);
        }
      }),
    );

    if (locationBufs.length > 0 && locationR2Urls.filter(Boolean).length === 0) {
      console.error(`${LOG} All ${locationBufs.length} location image upload(s) failed.`);
    }

    let customVoiceUrl: string | null = null;
    if (customVoiceBuf) {
      try {
        const ext = extFromMime(customVoiceMimeType);
        const key = buildUserKey(userId, 'audio', ext, 'areel-custom-voice');
        customVoiceUrl = await uploadToR2(customVoiceBuf, key, customVoiceMimeType);
      } catch (e) {
        console.warn(`${LOG} Custom voice upload failed, falling back to TTS:`, e instanceof Error ? e.message : e);
      }
    }

    const { send, close, signal: pipelineSignal } = startSse(req, res);

    async function persistJob(patch: Record<string, unknown>) {
      try {
        await ReelJob.updateOne({ jobId }, { $set: patch });
      } catch (e) {
        console.error(`${LOG} Job persist failed:`, e instanceof Error ? e.message : e);
      }
    }

    try {
      send({ type: 'script_splitting', message: 'Splitting script into 2 parts…' });
      const { part1, part2, part1Words, part2Words } = await splitScript(script, 'a fast-paced, high-energy vertical reel video');

      const { part1_tts, part2_tts, part1_roman, part2_roman } = await adaptScriptParts({
        part1,
        part2,
        language,
        onStatus: (message) => send({ type: 'script_adapting', message }),
      });

      send({ type: 'script_split', part1, part2, part1Words, part2Words });
      await persistJob({ status: 'splitting', part1, part2 });

      let part1AudioUrl: string | null = null;
      let part2AudioUrl: string | null = null;

      if (customVoiceUrl) {
        send({ type: 'voice_generating', message: 'Using your uploaded voice as the reference audio…' });
        part1AudioUrl = customVoiceUrl;
        part2AudioUrl = customVoiceUrl;
      } else {
        send({ type: 'voice_generating', message: 'Generating voiceovers for both parts in parallel…' });
        const [p1TtsResult, p2TtsResult] = await Promise.allSettled([
          generateAndUploadTTS(part1_tts, voiceId, userId, 'areel-part1-voice', language),
          generateAndUploadTTS(part2_tts, voiceId, userId, 'areel-part2-voice', language),
        ]);
        if (p1TtsResult.status === 'fulfilled') part1AudioUrl = p1TtsResult.value;
        else console.error(`${LOG} Part 1 TTS failed:`, p1TtsResult.reason?.message);
        if (p2TtsResult.status === 'fulfilled') part2AudioUrl = p2TtsResult.value;
        else console.error(`${LOG} Part 2 TTS failed:`, p2TtsResult.reason?.message);
      }

      send({ type: 'voice_all_ready', part1AudioUrl, part2AudioUrl });
      await persistJob({ status: 'voices', part1AudioUrl, part2AudioUrl });

      const validLocationUrls = locationR2Urls.filter(Boolean);
      if (validLocationUrls.length < 4 || avatarUrls.slice(0, 3).length < 3) {
        console.warn(
          `${LOG} Templates assume #image1-4 (location) + #image5/#image7 (avatar); got ${validLocationUrls.length} location + ${avatarUrls.slice(0, 3).length} avatar image(s). Seedance will ignore #imageN references with no matching image.`,
        );
      }

      const [part1Prompt, part2Prompt] = await Promise.all([
        reproduceTemplate({
          template: MASTER_TEMPLATE_A,
          markers: TEMPLATE_MARKERS.A,
          dialogue: part1_roman,
          partLabel: 'Part 1 (hook)',
          fallbackFn: fillTemplateAFallback,
          buildPrompt: buildReproducePrompt,
          logPrefix: 'ActionReel',
        }),
        reproduceTemplate({
          template: MASTER_TEMPLATE_B,
          markers: TEMPLATE_MARKERS.B,
          dialogue: part2_roman,
          partLabel: 'Part 2 (highlights + CTA)',
          fallbackFn: fillTemplateBFallback,
          buildPrompt: buildReproducePrompt,
          logPrefix: 'ActionReel',
        }),
      ]);

      send({ type: 'seedance_prompt_ready', part1Prompt, part2Prompt, message: 'Both Seedance prompts ready.' });

      send({ type: 'seedance_generating', message: 'Generating 2 videos in parallel via Seedance 2.0 (takes ~3–7 min)…' });
      await persistJob({ status: 'seedance' });

      const imageUrls = [...validLocationUrls, ...avatarUrls.slice(0, 3)];

      const part1Input = {
        prompt: part1Prompt,
        aspect_ratio: '9:16',
        duration: '15',
        resolution,
        generate_audio: true,
        ...(imageUrls.length > 0 && {
          image_urls: imageUrls,
          ...(part1AudioUrl && { audio_urls: [part1AudioUrl] }),
        }),
      };
      const part2Input = {
        prompt: part2Prompt,
        aspect_ratio: '9:16',
        duration: '15',
        resolution,
        generate_audio: true,
        ...(imageUrls.length > 0 && {
          image_urls: imageUrls,
          ...(part2AudioUrl && { audio_urls: [part2AudioUrl] }),
        }),
      };

      console.log(`${LOG} image_urls (${imageUrls.length}, location-first):`, imageUrls);

      let part1VideoUrl: string | null = null;
      let part2VideoUrl: string | null = null;

      await Promise.allSettled([
        callSeedanceAndUpload(part1Input, userId, 'areel-part1', pipelineSignal)
          .then((url) => {
            part1VideoUrl = url;
            console.log(`${LOG} Part 1 video uploaded:`, url);
            send({ type: 'part1_video_done', part1VideoUrl: url, message: 'Part 1 (hook) video ready!' });
            persistJob({ part1VideoUrl: url });
          })
          .catch((err) => {
            console.error(`${LOG} Part 1 Seedance failed:`, err.message);
            send({ type: 'seedance_error', message: `Part 1 video failed: ${err.message}` });
          }),
        callSeedanceAndUpload(part2Input, userId, 'areel-part2', pipelineSignal)
          .then((url) => {
            part2VideoUrl = url;
            console.log(`${LOG} Part 2 video uploaded:`, url);
            send({ type: 'part2_video_done', part2VideoUrl: url, message: 'Part 2 (highlights + CTA) video ready!' });
            persistJob({ part2VideoUrl: url });
          })
          .catch((err) => {
            console.error(`${LOG} Part 2 Seedance failed:`, err.message);
            send({ type: 'seedance_error', message: `Part 2 video failed: ${err.message}` });
          }),
      ]);

      if (!part1VideoUrl && !part2VideoUrl) {
        send({ type: 'fatal_error', message: 'Both video generations failed - please check your images and try again.' });
        throw new Error('Both Seedance video generations failed - see server logs for details.');
      }

      send({ type: 'uploading', message: 'Saving to your Asset Library…' });

      const primaryUrl = part1VideoUrl || part2VideoUrl;
      if (primaryUrl) {
        try {
          await Asset.create({
            userId,
            name: `Action Reel - ${new Date().toLocaleDateString()}`,
            url: primaryUrl,
            type: 'clip',
            metadata: { source: 'action-reel', part1VideoUrl, part2VideoUrl, part1AudioUrl, part2AudioUrl, language },
          });
        } catch (dbErr) {
          console.error(`${LOG} DB save error:`, dbErr);
        }
      }

      send({ type: 'video_ready', part1VideoUrl, part2VideoUrl, message: 'Both videos ready! Rendering final reel…' });
      await persistJob({ status: 'done', part1VideoUrl, part2VideoUrl });

      send({ type: 'done' });
      close();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pipeline failed';
      console.error(`${LOG} Pipeline error:`, err);
      await persistJob({ status: 'error', error: message });

      if (debit) {
        await refundCreditsForAction({
          userId,
          action: CREDIT_ACTION,
          debit,
          metadata: { endpoint: '/api/v1/action-reel/generate-pipeline', reason: 'generation_failed', message },
        });
      }

      send({ type: 'error', message });
      close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start pipeline';
    console.error(`${LOG} Outer error:`, error);

    if (debit) {
      await refundCreditsForAction({
        userId,
        action: CREDIT_ACTION,
        debit,
        metadata: { endpoint: '/api/v1/action-reel/generate-pipeline', reason: 'unexpected_error', message },
      });
    }

    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
}

export async function getJob(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!jobId) {
    res.status(400).json({ error: 'Missing jobId' });
    return;
  }

  const job = await ReelJob.findOne({ jobId, userId }).lean();
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.status(200).json({ job });
}

export const previewScript = createPreviewScriptHandler('ActionReel');
