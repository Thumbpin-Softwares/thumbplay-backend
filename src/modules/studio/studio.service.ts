import { callSeedanceAndUpload } from '../reel/seedance.service';
import { mixBackgroundMusic } from '../reel/video-concat.service';
import { listMusicTracks, uploadToR2, buildUserKey } from '../reel/r2.service';
import { Asset } from '../asset/asset.model';
import { applyBranding, hasBranding, BrandingFields } from '../render/branding.service';
import { refundCreditsForAction, ConsumeDebit } from '../credit/credit.service';
import { StudioJob } from './studio-job.model';

const LOG = '[Studio]';
const CREDIT_ACTION = 'studio_drone_flythrough';
const DRONE_DURATION_SECONDS = '15';

// Each work type carries its own tuned master prompt so the user's own text
// is optional extra direction, not the whole spec - mirrors how each
// creative-ads n8n workflow builds its full prompt in code rather than
// taking one raw from the user. Kept here (not in the controller) since it's
// generation logic, one constant per work type as more get added.
//
// Deliberately describes a continuous journey INTO and THROUGH the property
// (entrance -> living space -> dining, etc.), not just an exterior orbit -
// matches the "drone-style interior walkthrough" look, while still being
// told to only traverse rooms actually shown in the reference images so it
// doesn't invent a layout that isn't there (same grounding principle as the
// model-tour storyboard prompts).
const DRONE_FLYTHROUGH_MASTER_PROMPT =
  'Create a smooth, cinematic drone-style walkthrough of the real estate property shown in the reference images - ' +
  'not a static orbit, but a single continuous, flowing journey. ' +
  'Camera: begin outside or at the entrance, glide smoothly through the doorway into the home, then keep moving ' +
  'fluidly from one connected space to the next exactly as shown in the reference photos - for example entryway ' +
  'into the living room, then living room into the dining area, or whatever natural room-to-room flow the photos ' +
  'actually support. Punchy but smooth pacing, confident forward momentum, no static holds, no jerky or shaky ' +
  'motion, no sudden cuts - all as one uninterrupted take. ' +
  'Preserve the actual architecture, room layout, materials, colors and furnishings exactly as shown in the ' +
  'reference photos - only move through spaces that are actually visible in the reference images, do not invent ' +
  'rooms or a layout that isn\'t shown. If only exterior/aerial photos are provided, keep the journey exterior and ' +
  'aerial rather than inventing an interior. ' +
  'Keep lighting and time of day consistent with the reference photos. Photorealistic, high production value, ' +
  'professional real-estate marketing quality, no added text, no watermarks, no logos, no people unless already ' +
  'present in the reference photos.';

function buildDroneFlythroughPrompt(userPrompt: string): string {
  const trimmed = (userPrompt || '').trim();
  return trimmed ? `${DRONE_FLYTHROUGH_MASTER_PROMPT} Additional direction from the user: ${trimmed}` : DRONE_FLYTHROUGH_MASTER_PROMPT;
}

// Picks a random track from the same R2-hosted music library the Edit
// module's MusicPanel already uses (reel/r2.service.ts's listMusicTracks) -
// no per-track mood/energy tagging exists yet, so this can't specifically
// target "punchy" tracks; random keeps it from playing the same track every
// time. Returns null if the library is empty so callers can fall back to a
// silent clip instead of failing the whole generation over a missing track.
async function pickBackgroundMusic(): Promise<string | null> {
  try {
    const tracks = await listMusicTracks();
    const track = tracks[Math.floor(Math.random() * tracks.length)];
    return track?.url ?? null;
  } catch (err) {
    console.warn(`${LOG} Failed to load music library, generating without music:`, err instanceof Error ? err.message : err);
    return null;
  }
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
  branding?: BrandingFields,
): Promise<void> {
  try {
    const prompt = buildDroneFlythroughPrompt(userPrompt);
    const rawClipUrl = await callSeedanceAndUpload(
      {
        prompt,
        aspect_ratio: '16:9',
        duration: DRONE_DURATION_SECONDS,
        resolution: '720p',
        generate_audio: false,
        image_urls: imageUrls,
      },
      userId,
      'studio-drone-flythrough',
    );

    // Mix in a background music track (the clip itself has no audio - see
    // generate_audio: false above), then apply this generation's own
    // branding if any was entered for it (see branding.service.ts - branding
    // is per-generation, not per-account).
    const musicUrl = await pickBackgroundMusic();
    let finalBuffer = musicUrl ? await mixBackgroundMusic(rawClipUrl, musicUrl) : null;

    if (hasBranding(branding)) {
      const mainUrl = finalBuffer
        ? await uploadToR2(finalBuffer, buildUserKey(userId, 'videos', 'mp4', 'studio-drone-flythrough-music'), 'video/mp4')
        : rawClipUrl;
      const branded = await applyBranding(userId, mainUrl, branding);
      if (branded) finalBuffer = branded;
    }

    const resultUrl = finalBuffer
      ? await uploadToR2(finalBuffer, buildUserKey(userId, 'videos', 'mp4', 'studio-drone-flythrough'), 'video/mp4')
      : rawClipUrl;

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
