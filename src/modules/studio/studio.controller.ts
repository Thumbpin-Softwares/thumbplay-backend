import crypto from 'node:crypto';
import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { consumeCreditsForAction } from '../credit/credit.service';
import { StudioJob, StudioWorkType } from './studio-job.model';
import { runDroneFlythrough } from './studio.service';

const CREDIT_ACTION = 'studio_drone_flythrough';
const LOG = '[Studio]';
const MAX_IMAGES = 4;
const KNOWN_WORK_TYPES: StudioWorkType[] = ['drone-flythrough'];

function parseStudioInput(
  body: Record<string, unknown>,
): { workType: StudioWorkType; prompt: string; imageUrls: string[] } | { error: string } {
  const workType = ((body.workType as string) || '').toString().trim();
  const prompt = ((body.prompt as string) || '').toString().trim();
  const imageUrls: string[] = Array.isArray(body.imageUrls)
    ? body.imageUrls.filter((u: unknown) => typeof u === 'string')
    : [];

  if (!KNOWN_WORK_TYPES.includes(workType as StudioWorkType)) {
    return { error: `workType must be one of: ${KNOWN_WORK_TYPES.join(', ')}` };
  }
  // prompt is optional - each work type has its own tuned master prompt
  // (see studio.service.ts) that the user's prompt is appended to as extra
  // direction, not required to carry the whole request on its own.
  if (imageUrls.length < 1 || imageUrls.length > MAX_IMAGES) {
    return { error: `imageUrls must have between 1 and ${MAX_IMAGES} URLs` };
  }

  return { workType: workType as StudioWorkType, prompt, imageUrls };
}

// POST /studio/generate - unlike creative-ads' SSE stream, this responds as
// soon as the job is queued (202 + jobId) and runs the actual generation
// detached from the request, so it survives the client disconnecting. The
// frontend polls GET /studio/generations / GET /studio/jobs/:jobId instead
// of holding a connection open.
export async function generate(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = parseStudioInput(req.body ?? {});
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { workType, prompt, imageUrls } = parsed;
  const jobId = crypto.randomUUID();

  try {
    const creditResult = await consumeCreditsForAction({
      userId,
      action: CREDIT_ACTION,
      metadata: { endpoint: '/api/v1/studio/generate', workType },
    });
    if (!creditResult.ok) {
      res.status(creditResult.status).json(creditResult.payload);
      return;
    }

    await StudioJob.create({ jobId, userId, workType, prompt, imageUrls, status: 'running' });

    res.status(202).json({ jobId });

    // Fire-and-forget - errors are handled inside runDroneFlythrough itself
    // (job status + credit refund), so nothing here becomes an unhandled
    // rejection.
    void runDroneFlythrough(jobId, userId, prompt, imageUrls, creditResult.debit);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start generation';
    console.error(`${LOG} Outer error:`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
}

// GET /studio/jobs/:jobId - resume-on-refresh / poll a single job.
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

  const job = await StudioJob.findOne({ jobId, userId }).lean();
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.status(200).json({ job });
}

// GET /studio/generations - the user's own generations, newest first,
// including in-progress ones.
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
    StudioJob.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    StudioJob.countDocuments({ userId }),
  ]);

  res.status(200).json({ jobs, total, page, totalPages: Math.ceil(total / limit) });
}
