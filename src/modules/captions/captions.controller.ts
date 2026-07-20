import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { Asset } from '../asset/asset.model';
import { consumeCreditsForAction, refundCreditsForAction, ConsumeDebit } from '../credit/credit.service';
import { computeCaptionCreditCost, CAPTION_FAILED_RUN_CHARGE_CREDITS } from '../credit/credit-costs';
import { CAPTION_PRESETS } from './captions.presets';
import { burnCaptionsAndUpload } from './captions.service';

const CREDIT_ACTION = 'captions_generation';
const LOG = '[Captions]';

// POST /captions/generate — JSON in, JSON out (not SSE; VEED subtitle runs
// are fast enough not to need progress streaming).
export async function generate(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user?._id?.toString();
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body ?? {};
  const videoUrl = (body.videoUrl || '').toString().trim();
  const preset = (body.preset || '').toString().trim();
  const language = body.language ? String(body.language) : undefined;
  const translationLanguage = body.translationLanguage ? String(body.translationLanguage) : undefined;
  const position = body.position ? String(body.position) : undefined;
  const durationSeconds = Number(body.durationSeconds) || 0;

  if (!videoUrl) {
    res.status(400).json({ error: 'videoUrl is required' });
    return;
  }
  if (!preset) {
    res.status(400).json({ error: 'preset is required' });
    return;
  }

  const presetConfig = CAPTION_PRESETS.find((p) => p.id === preset);
  if (!presetConfig) {
    res.status(400).json({ error: 'Unknown caption preset' });
    return;
  }

  // durationSeconds comes from the reel's own composition (durationInFrames
  // / fps) on the client, not an arbitrary value, so it's trustworthy for
  // pricing purposes — same trust boundary as the source this was ported from.
  const { credits: creditsCost } = computeCaptionCreditCost({
    durationSeconds,
    isDynamicPreset: presetConfig.tier === 'dynamic',
    hasTranslation: !!translationLanguage,
  });

  const creditResult = await consumeCreditsForAction({
    userId,
    action: CREDIT_ACTION,
    costOverride: creditsCost,
    metadata: { endpoint: '/api/v1/captions/generate', preset, durationSeconds, translationLanguage },
  });
  if (!creditResult.ok) {
    res.status(creditResult.status).json(creditResult.payload);
    return;
  }
  const debit: ConsumeDebit = creditResult.debit;

  try {
    const url = await burnCaptionsAndUpload(userId, {
      videoUrl,
      preset,
      ...(language ? { language } : {}),
      ...(translationLanguage ? { translationLanguage } : {}),
      ...(position ? { position } : {}),
    });

    // Save the captioned/exported video as its own asset so it shows up in
    // "My Videos" — metadata.source deliberately isn't an EDITABLE_SOURCES
    // key (it's a flattened mp4 with captions burned in, not reopenable as
    // a Remotion composition).
    try {
      await Asset.create({
        userId,
        name: `Captioned Reel (${presetConfig.label}) — ${new Date().toLocaleDateString()}`,
        url,
        type: 'video',
        metadata: { source: 'captions-export', preset },
      });
    } catch (dbErr) {
      console.error(`${LOG} DB save error:`, dbErr);
    }

    res.status(200).json({ url, creditsCharged: creditsCost });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Caption generation failed';
    console.error(`${LOG} generate error:`, err);

    // VEED still bills us for the attempt even when it fails, so only
    // refund the margin — keep a flat raw-cost charge instead of a full refund.
    const chargeOnFailure = Math.min(CAPTION_FAILED_RUN_CHARGE_CREDITS, creditsCost);
    const refundAmount = Math.max(0, creditsCost - chargeOnFailure);
    await refundCreditsForAction({
      userId,
      action: CREDIT_ACTION,
      debit,
      amount: refundAmount,
      metadata: { endpoint: '/api/v1/captions/generate', reason: 'generation_failed', message, chargeOnFailure },
    });

    res.status(500).json({ error: message, creditsCharged: chargeOnFailure });
  }
}
