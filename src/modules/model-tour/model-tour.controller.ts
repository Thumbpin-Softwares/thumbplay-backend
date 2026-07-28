import crypto from 'node:crypto';
import { Request, Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { ModelTourJob } from './model-tour-job.model';
import { Asset } from '../asset/asset.model';
import { consumeCreditsForAction, refundCreditsForAction, ConsumeDebit } from '../credit/credit.service';
import { startSse } from '../reel/sse';
import {
  uploadPropertyImage,
  generateModelTourScript,
  triggerModelTourGeneration,
  OmniHomeTourInput,
  PropertyType,
} from './model-tour.service';
import { uploadToR2, buildUserKey } from '../reel/r2.service';

const CREDIT_ACTION = 'real_estate_video';
const LOG = '[ModelTour]';
const MAX_IMAGES = 4;
const PROPERTY_TYPES = new Set<PropertyType>(['residential', 'commercial', 'plotted']);

type UploadFiles = Record<string, Express.Multer.File[]>;

// Shared by /script and /generate — both take the same raw form fields as
// their starting point (the latter only when there's no edited script yet).
function parseOmniHomeTourInput(body: Record<string, unknown>): { input: OmniHomeTourInput } | { error: string } {
  const propertyName = ((body.propertyName as string) || '').toString().trim();
  const avatarImageUrls: string[] = Array.isArray(body.avatarImageUrls)
    ? body.avatarImageUrls.filter((u: unknown) => typeof u === 'string')
    : [];
  const propertyImageUrls: string[] = Array.isArray(body.propertyImageUrls)
    ? body.propertyImageUrls.filter((u: unknown) => typeof u === 'string')
    : [];
  const type = ((body.type as string) || '').toString().trim().toLowerCase() as PropertyType | '';
  const script = ((body.script as string) || '').toString().trim();

  if (!propertyName) return { error: 'propertyName is required' };
  if (type && !PROPERTY_TYPES.has(type)) {
    return { error: `type must be one of: ${[...PROPERTY_TYPES].join(', ')}` };
  }
  if (avatarImageUrls.length < 1 || avatarImageUrls.length > MAX_IMAGES) {
    return { error: `avatarImageUrls must have between 1 and ${MAX_IMAGES} URLs` };
  }
  if (propertyImageUrls.length < 1 || propertyImageUrls.length > MAX_IMAGES) {
    return { error: `propertyImageUrls must have between 1 and ${MAX_IMAGES} URLs` };
  }

  const input: OmniHomeTourInput = {
    propertyName,
    ...(type ? { type } : {}),
    ...(script ? { script } : {}),
    locationLandmarks: ((body.locationLandmarks as string) || '').toString(),
    connectivity: ((body.connectivity as string) || '').toString(),
    language: ((body.language as string) || '').toString(),
    tierClass: ((body.tierClass as string) || '').toString(),
    carpetArea: ((body.carpetArea as string) || '').toString(),
    amenities: ((body.amenities as string) || '').toString(),
    tonality: ((body.tonality as string) || '').toString(),
    vibe: ((body.vibe as string) || '').toString(),
    avatarImageUrls,
    propertyImageUrls,
  };

  return { input };
}

// POST /model-tour/script — the "checkpoint" step: raw form fields in, a
// jobId back out immediately (202). The n8n call that actually builds the
// script can run past Vercel's ~60s edge-response timeout, so this can't be
// a plain blocking request/response — the job runs in the background and the
// finalize step polls GET /model-tour/jobs/:jobId (same job model/endpoint
// /generate already uses) until `result` holds the script JSON.
export async function getScript(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = parseOmniHomeTourInput(req.body ?? {});
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const jobId = crypto.randomUUID();
  const { input } = parsed;

  try {
    await ModelTourJob.create({ jobId, userId, propertyName: input.propertyName, status: 'running', inputs: { ...input } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start script generation';
    console.error(`${LOG} getScript create-job error:`, error);
    res.status(500).json({ error: message });
    return;
  }

  res.status(202).json({ jobId });

  try {
    const script = await generateModelTourScript(input);
    await ModelTourJob.updateOne({ jobId }, { $set: { status: 'done', result: script } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate script';
    console.error(`${LOG} getScript background error:`, error);
    await ModelTourJob.updateOne({ jobId }, { $set: { status: 'error', error: message } });
  }
}

// POST /model-tour/upload/property — multipart single `file` + name.
export async function uploadProperty(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const files = (req as unknown as { files?: UploadFiles }).files;
  const file = files?.file?.[0];
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const name = ((req.body?.name as string) || '').trim() || 'Property Photo';

  try {
    const asset = await uploadPropertyImage(userId, { buffer: file.buffer, mimetype: file.mimetype }, name);
    res.status(200).json({ success: true, asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    console.error(`${LOG} uploadProperty error:`, error);
    res.status(400).json({ error: message });
  }
}

// POST /model-tour/generate — JSON body: { jobId, script }. `script` is the
// JSON returned by /model-tour/script, as (possibly) edited by the user in
// the finalize step — we pass it straight back to n8n, we don't reshape it.
export async function generate(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  let debit: ConsumeDebit | undefined;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body ?? {};
  const jobId = (body.jobId || '').toString().trim();
  const script = body.script;

  if (!jobId) {
    res.status(400).json({ error: 'jobId is required' });
    return;
  }
  if (!script || typeof script !== 'object' || Array.isArray(script)) {
    res.status(400).json({ error: 'script is required' });
    return;
  }

  const propertyName = ((script.property_name ?? script.propertyName ?? '') as string).toString().trim() || 'Untitled Property';

  const existingJob = await ModelTourJob.findOne({ jobId }).lean();
  if (existingJob) {
    res.status(409).json({ error: 'Job already exists', jobId });
    return;
  }

  try {
    const creditResult = await consumeCreditsForAction({
      userId,
      action: CREDIT_ACTION,
      metadata: { endpoint: '/api/v1/model-tour/generate' },
    });
    if (!creditResult.ok) {
      res.status(creditResult.status).json(creditResult.payload);
      return;
    }
    debit = creditResult.debit;

    await ModelTourJob.create({ jobId, userId, propertyName, status: 'running', inputs: script });

    const { send, close, signal } = startSse(req, res);

    try {
      send({ type: 'generating', message: 'Sending to workflow for generation…' });

      await triggerModelTourGeneration(jobId, userId, script, signal);

      send({ type: 'processing', message: 'Generating your home tour video…' });

      let isDone = false;
      while (!isDone && !signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const job = await ModelTourJob.findOne({ jobId }).lean();
        if (!job) break;

        if (job.status === 'done') {
          send({ type: 'done', resultUrl: job.resultUrl });
          isDone = true;
        } else if (job.status === 'error') {
          throw new Error(job.error || 'External workflow failed');
        }
      }

      close();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      console.error(`${LOG} generate error:`, err);
      await ModelTourJob.updateOne({ jobId }, { $set: { status: 'error', error: message } });

      if (debit) {
        await refundCreditsForAction({
          userId,
          action: CREDIT_ACTION,
          debit,
          metadata: { endpoint: '/api/v1/model-tour/generate', reason: 'generation_failed', message },
        });
      }

      send({ type: 'error', message });
      close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start generation';
    console.error(`${LOG} Outer error:`, error);

    if (debit) {
      await refundCreditsForAction({
        userId,
        action: CREDIT_ACTION,
        debit,
        metadata: { endpoint: '/api/v1/model-tour/generate', reason: 'unexpected_error', message },
      });
    }

    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
}

// GET /model-tour/jobs/:jobId — resume-on-refresh, same pattern as ReelJob.
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

  const job = await ModelTourJob.findOne({ jobId, userId }).lean();
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.status(200).json({ job });
}

// GET /model-tour/generations — the user's own generations, newest first,
// powering the "Generations" tab (in-progress jobs included, not just done ones).
export async function listGenerations(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '20', 10) || 20));
  const skip = (page - 1) * limit;

  const [jobs, total] = await Promise.all([
    ModelTourJob.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ModelTourJob.countDocuments({ userId }),
  ]);

  res.status(200).json({ jobs, total, page, totalPages: Math.ceil(total / limit) });
}

// POST /model-tour/webhook — called by n8n with JSON body containing final video URL.
// n8n sends: { jobId, userId, videoUrl } where videoUrl is the URL of the processed video.
// The backend downloads the video from the URL and uploads it to R2.
export async function handleN8nWebhook(req: Request, res: Response): Promise<void> {
  try {
    const jobId = req.body?.jobId;
    const userId = req.body?.userId;
    const videoUrl: string = req.body?.videoUrl || '';

    if (!jobId || !userId) {
      res.status(400).json({ error: 'Missing jobId or userId' });
      return;
    }
    if (!videoUrl) {
      res.status(400).json({ error: 'Missing videoUrl in request body' });
      return;
    }

    const job = await ModelTourJob.findOne({ jobId });
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Download the video from the URL n8n provided
    console.log(`${LOG} Downloading final video from n8n: ${videoUrl}`);
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video from URL: HTTP ${videoResponse.status}`);
    }
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

    // Upload to R2
    const key = buildUserKey(userId, 'videos', 'mp4', 'model-tour');
    const r2VideoUrl = await uploadToR2(videoBuffer, key, 'video/mp4');

    // Create Asset in the user's library
    await Asset.create({
      userId,
      name: `Home Tour — ${job.propertyName}`,
      url: r2VideoUrl,
      type: 'video',
      metadata: { source: 'model-tour', jobId },
    });

    // Mark job as done — the SSE polling loop in /generate will pick this up
    await ModelTourJob.updateOne({ jobId }, { $set: { status: 'done', resultUrl: r2VideoUrl } });

    console.log(`${LOG} Job ${jobId} completed. Video saved to R2: ${r2VideoUrl}`);
    res.status(200).json({ success: true, videoUrl: r2VideoUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed';
    console.error(`${LOG} webhook error:`, error);

    const jobId = req.body?.jobId;
    if (jobId) {
      await ModelTourJob.updateOne({ jobId }, { $set: { status: 'error', error: message } });
    }
    res.status(500).json({ error: message });
  }
}

