import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { ModelTourJob } from './model-tour-job.model';
import { Asset } from '../asset/asset.model';
import { consumeCreditsForAction, refundCreditsForAction, ConsumeDebit } from '../credit/credit.service';
import { startSse } from '../reel/sse';
import { uploadPropertyImage, callOmniHomeTourAndUpload } from './model-tour.service';

const CREDIT_ACTION = 'real_estate_video';
const LOG = '[ModelTour]';
const MAX_IMAGES = 4;

type UploadFiles = Record<string, Express.Multer.File[]>;

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

// POST /model-tour/generate — JSON body, images already uploaded (URLs in hand).
export async function generate(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  let debit: ConsumeDebit | undefined;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body ?? {};
  const jobId = (body.jobId || '').toString().trim();
  const propertyName = (body.propertyName || '').toString().trim();
  const avatarImageUrls: string[] = Array.isArray(body.avatarImageUrls) ? body.avatarImageUrls.filter((u: unknown) => typeof u === 'string') : [];
  const propertyImageUrls: string[] = Array.isArray(body.propertyImageUrls) ? body.propertyImageUrls.filter((u: unknown) => typeof u === 'string') : [];

  if (!jobId) {
    res.status(400).json({ error: 'jobId is required' });
    return;
  }
  if (!propertyName) {
    res.status(400).json({ error: 'propertyName is required' });
    return;
  }
  if (avatarImageUrls.length < 1 || avatarImageUrls.length > MAX_IMAGES) {
    res.status(400).json({ error: `avatarImageUrls must have between 1 and ${MAX_IMAGES} URLs` });
    return;
  }
  if (propertyImageUrls.length < 1 || propertyImageUrls.length > MAX_IMAGES) {
    res.status(400).json({ error: `propertyImageUrls must have between 1 and ${MAX_IMAGES} URLs` });
    return;
  }

  const existingJob = await ModelTourJob.findOne({ jobId }).lean();
  if (existingJob) {
    res.status(409).json({ error: 'Job already exists', jobId });
    return;
  }

  const inputs = {
    propertyName,
    locationLandmarks: (body.locationLandmarks || '').toString(),
    connectivity: (body.connectivity || '').toString(),
    language: (body.language || '').toString(),
    tierClass: (body.tierClass || '').toString(),
    carpetArea: (body.carpetArea || '').toString(),
    amenities: (body.amenities || '').toString(),
    tonality: (body.tonality || '').toString(),
    vibe: (body.vibe || '').toString(),
    avatarImageUrls,
    propertyImageUrls,
  };

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

    await ModelTourJob.create({ jobId, userId, status: 'running', inputs });

    const { send, close, signal } = startSse(req, res);

    try {
      send({ type: 'generating', message: 'Generating your home tour video…' });

      const videoUrl = await callOmniHomeTourAndUpload(inputs, userId, signal);

      await Asset.create({
        userId,
        name: `Home Tour — ${propertyName}`,
        url: videoUrl,
        type: 'video',
        metadata: { source: 'model-tour', jobId },
      });

      await ModelTourJob.updateOne({ jobId }, { $set: { status: 'done', resultUrl: videoUrl } });

      send({ type: 'done', resultUrl: videoUrl });
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
