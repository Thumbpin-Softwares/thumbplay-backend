import { callSeedanceAndUpload } from '../reel/seedance.service';
import { Asset } from '../asset/asset.model';
import { refundCreditsForAction, ConsumeDebit } from '../credit/credit.service';
import { StudioJob } from './studio-job.model';

const LOG = '[Studio]';
const CREDIT_ACTION = 'studio_drone_flythrough';

// Each work type carries its own tuned master prompt so the user's own text
// is optional extra direction, not the whole spec - mirrors how each
// creative-ads n8n workflow builds its full prompt in code rather than
// taking one raw from the user. Kept here (not in the controller) since it's
// generation logic, one constant per work type as more get added.
const DRONE_FLYTHROUGH_MASTER_PROMPT =
  'Create a smooth, cinematic aerial drone flythrough of the real estate property shown in the reference images. ' +
  'Camera: a slow, stabilized aerial movement - a gentle forward push toward the building and/or a smooth orbit around it - professional real-estate marketing quality, no shaky or jerky motion, no sudden cuts. ' +
  'Preserve the actual architecture, materials, colors and surroundings exactly as shown in the reference photos - do not invent a different building or setting. ' +
  'Keep lighting and time of day consistent with the reference photos. Photorealistic, high production value, no added text, no watermarks, no logos, no people unless already present in the reference photos.';

function buildDroneFlythroughPrompt(userPrompt: string): string {
  const trimmed = (userPrompt || '').trim();
  return trimmed ? `${DRONE_FLYTHROUGH_MASTER_PROMPT} Additional direction from the user: ${trimmed}` : DRONE_FLYTHROUGH_MASTER_PROMPT;
}

// Runs detached from the HTTP request that created the job (studio.controller.ts
// fires this without awaiting and has already responded to the client) - no
// AbortSignal is wired to anything, so closing the tab does NOT cancel this,
// unlike reel/sse.ts's startSse() pattern used by seedance-reel/action-reel.
export async function runDroneFlythrough(
  jobId: string,
  userId: string,
  userPrompt: string,
  imageUrls: string[],
  debit: ConsumeDebit,
): Promise<void> {
  try {
    const prompt = buildDroneFlythroughPrompt(userPrompt);
    const resultUrl = await callSeedanceAndUpload(
      {
        prompt,
        aspect_ratio: '16:9',
        duration: '10',
        resolution: '720p',
        generate_audio: false,
        image_urls: imageUrls,
      },
      userId,
      'studio-drone-flythrough',
    );

    await StudioJob.updateOne({ jobId }, { $set: { status: 'done', resultUrl } });

    await Asset.create({
      userId,
      name: `Drone Flythrough - ${new Date().toLocaleDateString()}`,
      url: resultUrl,
      type: 'clip',
      metadata: { source: 'studio', workType: 'drone-flythrough', jobId },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    console.error(`${LOG} runDroneFlythrough error:`, err);
    await StudioJob.updateOne({ jobId }, { $set: { status: 'error', error: message } });

    await refundCreditsForAction({
      userId,
      action: CREDIT_ACTION,
      debit,
      metadata: { workType: 'drone-flythrough', jobId, reason: 'generation_failed', message },
    });
  }
}
