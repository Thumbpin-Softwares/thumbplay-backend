import crypto from 'node:crypto';
import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { CreativeAdJob } from './creative-ads-job.model';
import { Asset } from '../asset/asset.model';
import { consumeCreditsForAction, refundCreditsForAction, ConsumeDebit } from '../credit/credit.service';
import { startSse } from '../reel/sse';
import {
  generateCreativeAd,
  persistCreativeAsset,
  isCreativeTemplateKey,
  CreativeAdInput,
  CreativeTemplateKey,
} from './creative-ads.service';

const CREDIT_ACTION = 'creative_ad_generation';
const LOG = '[CreativeAds]';
const MAX_PROPERTY_IMAGES = 4;

function parseCreativeAdInput(body: Record<string, unknown>): { input: CreativeAdInput } | { error: string } {
  const templateKey = ((body.templateKey as string) || '').toString().trim();
  const propertyName = ((body.propertyName as string) || '').toString().trim();
  const headline = ((body.headline as string) || '').toString().trim();
  const propertyImageUrls: string[] = Array.isArray(body.propertyImageUrls)
    ? body.propertyImageUrls.filter((u: unknown) => typeof u === 'string')
    : [];
  const logoUrl = ((body.logoUrl as string) || '').toString().trim();

  if (!templateKey || !isCreativeTemplateKey(templateKey)) {
    return { error: 'templateKey is required and must be a known creative template' };
  }
  if (!propertyName) return { error: 'propertyName is required' };
  if (!headline) return { error: 'headline is required' };
  if (propertyImageUrls.length < 1 || propertyImageUrls.length > MAX_PROPERTY_IMAGES) {
    return { error: `propertyImageUrls must have between 1 and ${MAX_PROPERTY_IMAGES} URLs` };
  }

  return {
    input: {
      templateKey: templateKey as CreativeTemplateKey,
      propertyName,
      headline,
      subheading: ((body.subheading as string) || '').toString(),
      ctaText: ((body.ctaText as string) || '').toString(),
      tonality: ((body.tonality as string) || '').toString(),
      location: ((body.location as string) || '').toString(),
      additionalDetails: ((body.additionalDetails as string) || '').toString(),
      propertyImageUrls,
      ...(logoUrl ? { logoUrl } : {}),
    },
  };
}

// POST /creative-ads/generate — streams progress as Server-Sent Events, same
// shape as model-tour's /generate. Unlike model-tour there's no /script
// checkpoint or splitter hand-off: the template's n8n webhook builds the
// prompt and renders the image in a single round-trip, so this is one
// request/response cycle end to end.
export async function generate(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  let debit: ConsumeDebit | undefined;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = parseCreativeAdInput(req.body ?? {});
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { input } = parsed;
  const jobId = crypto.randomUUID();

  try {
    const creditResult = await consumeCreditsForAction({
      userId,
      action: CREDIT_ACTION,
      metadata: { endpoint: '/api/v1/creative-ads/generate', templateKey: input.templateKey },
    });
    if (!creditResult.ok) {
      res.status(creditResult.status).json(creditResult.payload);
      return;
    }
    debit = creditResult.debit;

    await CreativeAdJob.create({
      jobId,
      userId,
      templateKey: input.templateKey,
      propertyName: input.propertyName,
      status: 'running',
      inputs: { ...input },
    });

    const { send, close, signal } = startSse(req, res);

    try {
      send({ type: 'started', jobId });
      send({ type: 'generating', message: 'Generating your creative…' });

      const { url: generatedUrl, rawCostUsd } = await generateCreativeAd(jobId, userId, input, signal);

      send({ type: 'processing', message: 'Saving your creative…' });

      const r2Url = await persistCreativeAsset(userId, generatedUrl);

      await Asset.create({
        userId,
        name: `${input.propertyName} — ${input.templateKey}`,
        url: r2Url,
        type: 'composite',
        metadata: { source: 'creative-ads', templateKey: input.templateKey, jobId },
      });

      await CreativeAdJob.updateOne(
        { jobId },
        { $set: { status: 'done', resultUrl: r2Url, ...(rawCostUsd != null ? { rawCostUsd } : {}) } },
      );

      send({ type: 'done', resultUrl: r2Url });
      close();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      console.error(`${LOG} generate error:`, err);
      await CreativeAdJob.updateOne({ jobId }, { $set: { status: 'error', error: message } });

      if (debit) {
        await refundCreditsForAction({
          userId,
          action: CREDIT_ACTION,
          debit,
          metadata: { endpoint: '/api/v1/creative-ads/generate', reason: 'generation_failed', message },
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
        metadata: { endpoint: '/api/v1/creative-ads/generate', reason: 'unexpected_error', message },
      });
    }

    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
}

// GET /creative-ads/jobs/:jobId — resume-on-refresh, same pattern as ModelTourJob.
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

  const job = await CreativeAdJob.findOne({ jobId, userId }).lean();
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.status(200).json({ job });
}

// GET /creative-ads/generations — the user's own generations, newest first.
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
    CreativeAdJob.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CreativeAdJob.countDocuments({ userId }),
  ]);

  res.status(200).json({ jobs, total, page, totalPages: Math.ceil(total / limit) });
}
