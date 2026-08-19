import { uploadToR2, buildUserKey, extFromMime } from '../reel/r2.service';
import { Asset } from '../asset/asset.model';
import { env } from '../../config/env';

// n8n video rendering takes 2-4 minutes. Node's built-in fetch uses undici, which
// has a default 30-second headersTimeout. We set undici's global dispatcher timeout
// to 10 minutes (600,000ms) so fetch doesn't abort while waiting for n8n.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(
    new Agent({
      headersTimeout: 10 * 60 * 1000, // 10 minutes
      bodyTimeout: 10 * 60 * 1000,    // 10 minutes
      connectTimeout: 60 * 1000,
    })
  );
} catch (e) {
  console.warn('[ModelTour] Failed to set global undici dispatcher timeout:', e);
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_BYTES_PER_IMAGE = 10 * 1024 * 1024; // 10 MB

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
}

// Avatar/presenter collection upload now lives in the re-avatars module as
// the one common endpoint every template posts to - see
// re-avatars/re-avatars.service.ts's uploadAvatarCollection.

// Same contract as thumbpinclient's /api/assets/upload (single file) -
// property photos land in the general Asset library too, same as every
// other template's PropertyImages upload.
export async function uploadPropertyImage(userId: string, file: UploadedImage, name: string) {
  if (!ALLOWED_MIME.has(file.mimetype)) throw new Error('Only JPEG, PNG, or WebP are allowed');
  if (file.buffer.byteLength > MAX_BYTES_PER_IMAGE) throw new Error('File exceeds the 10 MB limit');

  const ext = extFromMime(file.mimetype);
  const key = buildUserKey(userId, 'property-photos', ext, 'property-photos');
  const url = await uploadToR2(file.buffer, key, file.mimetype);

  const asset = await Asset.create({
    userId,
    name,
    url,
    type: 'background',
    metadata: { is_custom: true, r2Key: key, category: 'property-photos' },
  });

  return asset;
}

export type PropertyType = 'residential' | 'commercial' | 'plotted';

// Which template's script-generation webhook to call - every other stage
// (video render, splitter/voice-change) is shared infra reused across
// templates, only the script webhook differs per template.
export type ModelTourTemplateKey = 'model-tour' | 'luxury-car-exit';

export interface OmniHomeTourInput {
  avatarImageUrls: string[];
  propertyImageUrls: string[];
  propertyName: string;
  template?: ModelTourTemplateKey;
  type?: PropertyType;
  locationLandmarks?: string;
  connectivity?: string;
  language?: string;
  tierClass?: string;
  carpetArea?: string;
  amenities?: string;
  tonality?: string;
  vibe?: string;
  // Set when the user wrote the script themselves (SiteForm's Manual Script
  // mode) instead of having n8n generate it from the descriptive fields
  // above. Presence of this field is what selects the manual payload shape
  // in generateModelTourScript - the AI-guidance fields (location/
  // connectivity/carpetArea/amenities/tonality/vibe) are meaningless once
  // the final voiceover text is already decided, so they're dropped rather
  // than sent empty.
  script?: string;
}

function padTo4(urls: string[]): [string, string, string, string] {
  return [urls[0] ?? '', urls[1] ?? '', urls[2] ?? '', urls[3] ?? ''];
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

// Step 1: Script generation webhook - raw form inputs → n8n returns storyboard JSON.
// Per-template: each template has its own n8n workflow for turning form
// inputs into a script, keyed by ModelTourTemplateKey. Falls back to
// "model-tour" (real estate) when no template is specified.
const N8N_SCRIPT_WEBHOOKS: Record<ModelTourTemplateKey, string> = {
  'model-tour': 'https://wrk-413d.apps.excloud.co.in/webhook/6c94980a-83b4-47dc-ba29-44742ba81714',
  'luxury-car-exit': 'https://wrk-413d.apps.excloud.co.in/webhook/2aa4d5ec-60d1-45fc-97ca-792b851825c7',
};

// Generates (or regenerates) exactly one scene clip - a standalone n8n
// workflow, called with that one chunk's storyboard entry reshaped to index
// 0. generateChunks() below calls this once per chunk in parallel instead of
// going through the big 6-branch "common-video-generation-using-omni"
// workflow's `omni point` entry point (426fc4a4-...) - that workflow has no
// per-node error handling configured, so one chunk failing there kills the
// entire execution and all 6 chunks with it. Calling this 6 times as
// independent HTTP requests means one failing has zero effect on the other
// 5 - each just lands with its own ready/error status for the review screen.
// `omni point`'s chunk-generation branches are now unused (left in place,
// not deleted); only that workflow's Combine Chunks Entry tail is still
// called, via N8N_COMBINE_WEBHOOK_URL below.
const N8N_REGENERATE_CHUNK_WEBHOOK_URL = 'https://wrk-413d.apps.excloud.co.in/webhook/99e45c50-52e6-4043-a007-e202fcb2caf9';

// Combines the (possibly user-edited) set of 6 chunk URLs into one video -
// same "sticher" tail the original single-shot workflow used, now its own
// entry point so it can run after the user's review/regenerate pass.
const N8N_COMBINE_WEBHOOK_URL = 'https://wrk-413d.apps.excloud.co.in/webhook/6cbbfda2-33cd-4c65-8497-0cf593ebcb7b';

// Step 3: Splitter + voice-change webhook - sends merged video URL + jobId + userId.
// This n8n workflow splits audio, changes voice, re-merges, then POSTs the final
// video URL back to our backend at POST /api/v1/model-tour/webhook.
const N8N_SPLITTER_WEBHOOK_URL = env.n8nSplitterWebhookUrl;

export async function generateModelTourScript(
  input: OmniHomeTourInput,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const [avatar_image1, avatar_image2, avatar_image3, avatar_image4] = padTo4(input.avatarImageUrls);
  const [property_image1, property_image2, property_image3, property_image4] = padTo4(input.propertyImageUrls);

  const isManual = typeof input.script === 'string' && input.script.trim().length > 0;

  const payload = isManual
    ? {
        avatar_image1,
        avatar_image2,
        avatar_image3,
        avatar_image4,
        property_image1,
        property_image2,
        property_image3,
        property_image4,
        property_name: input.propertyName,
        type: input.type ?? '',
        language: input.language ?? '',
        tier_class: input.tierClass ?? '',
        script: input.script,
      }
    : {
        avatar_image1,
        avatar_image2,
        avatar_image3,
        avatar_image4,
        property_image1,
        property_image2,
        property_image3,
        property_image4,
        property_name: input.propertyName,
        type: input.type ?? '',
        location_landmarks: input.locationLandmarks ?? '',
        connectivity: input.connectivity ?? '',
        language: input.language ?? '',
        tier_class: input.tierClass ?? '',
        carpet_area: input.carpetArea ?? '',
        amenities: input.amenities ?? '',
        tonality: input.tonality ?? '',
        vibe: input.vibe ?? '',
      };

  const scriptWebhookUrl = N8N_SCRIPT_WEBHOOKS[input.template ?? 'model-tour'];

  const res = await fetch(scriptWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[ModelTour] n8n script webhook ${res.status} ${res.statusText}:`, body);
    throw new Error(`Failed to generate model-tour script: ${res.statusText}${body ? ` - ${body}` : ''}`);
  }

  // n8n's "Respond to Webhook" node (JSON mode fed by a normal node's
  // output) wraps the result as an array of items - [{...}] - rather than
  // returning the object directly, so unwrap that shape if present.
  let script: unknown = await res.json();
  if (Array.isArray(script)) script = script[0];

  if (!script || typeof script !== 'object' || Array.isArray(script)) {
    throw new Error('Script workflow returned an invalid response');
  }

  return script as Record<string, unknown>;
}

export interface GeneratedChunk {
  index: number;
  url: string;
  status: 'ready' | 'error';
}

// Generates all 6 scene clips by calling regenerateChunk() once per
// storyboard entry, in parallel, as independent requests - so one chunk
// failing doesn't take the other 5 down with it (see the comment on
// N8N_REGENERATE_CHUNK_WEBHOOK_URL above for why). Failed chunks come back
// with status 'error' and an empty url; the frontend shows them for
// individual regeneration rather than failing the whole job.
export async function generateChunks(
  jobId: string,
  userId: string,
  script: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<GeneratedChunk[]> {
  const storyboard = script.storyboard;
  if (!Array.isArray(storyboard) || storyboard.length === 0) {
    throw new Error('Script has no storyboard scenes');
  }

  console.log(`[ModelTour] Generating ${storyboard.length} chunk(s) in parallel for job ${jobId}`);
  const results = await Promise.allSettled(storyboard.map((_, i) => regenerateChunk(jobId, userId, script, i + 1, signal)));

  const chunks: GeneratedChunk[] = results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return { index: i + 1, url: result.value, status: 'ready' };
    }
    console.error(`[ModelTour] Chunk ${i + 1} generation failed for job ${jobId}:`, result.reason);
    return { index: i + 1, url: '', status: 'error' };
  });

  const readyCount = chunks.filter((c) => c.status === 'ready').length;
  console.log(`[ModelTour] Job ${jobId}: ${readyCount}/${chunks.length} chunk(s) ready`);
  if (readyCount === 0) {
    throw new Error('All 6 scenes failed to generate');
  }

  return chunks;
}

// Regenerates exactly one scene clip via the standalone regenerate-single-chunk
// workflow - also used by generateChunks() above for the initial 6-way
// parallel generation, not just user-triggered regeneration. `chunkIndex` is
// 1-based (matches the frontend's tile numbering); the storyboard entry for
// that scene is reshaped to index 0 since that workflow always reads
// storyboard[0].
export async function regenerateChunk(
  jobId: string,
  userId: string,
  script: Record<string, unknown>,
  chunkIndex: number,
  signal?: AbortSignal,
): Promise<string> {
  const storyboard = script.storyboard;
  if (!Array.isArray(storyboard) || !storyboard[chunkIndex - 1]) {
    throw new Error(`No storyboard entry for chunk ${chunkIndex}`);
  }

  console.log(`[ModelTour] Calling regenerate-single-chunk webhook for job ${jobId}, chunk ${chunkIndex}`);
  // 10 minutes, not 5 - the omni video fal node's own maxWaitTime ceiling is
  // generous (up to ~33 min); this just needs to comfortably cover realistic
  // (1-3 min) durations without cutting off a slow-but-succeeding call.
  const timeoutSignal = AbortSignal.timeout(10 * 60 * 1000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(N8N_REGENERATE_CHUNK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, userId, storyboard: [storyboard[chunkIndex - 1]], body: script.body }),
    signal: combinedSignal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[ModelTour] regenerate-chunk webhook ${res.status} ${res.statusText}:`, body);
    throw new Error(`Failed to regenerate chunk ${chunkIndex}: ${res.statusText}${body ? ` - ${body}` : ''}`);
  }

  let data: unknown = await res.json();
  if (Array.isArray(data)) data = data[0];

  const url = (data as { url?: string })?.url;
  if (!url) {
    throw new Error(`Regenerate-chunk workflow returned no video URL for chunk ${chunkIndex}`);
  }
  return url;
}

// Step 3 (unchanged shape, just renamed and now called after the user's
// review/regenerate pass instead of automatically): combine the current set
// of 6 chunk URLs into one video, then fire-and-forget hand off to the
// splitter/voice-changer, exactly as the original single-shot flow did.
export async function combineChunksAndHandoff(
  jobId: string,
  userId: string,
  script: Record<string, unknown>,
  chunkUrls: string[],
  signal?: AbortSignal,
): Promise<void> {
  console.log(`[ModelTour] Calling combine webhook for job ${jobId}`);
  const timeoutSignal = AbortSignal.timeout(5 * 60 * 1000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const combineRes = await fetch(N8N_COMBINE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, userId, chunkUrls }),
    signal: combinedSignal,
  });

  if (!combineRes.ok) {
    const body = await combineRes.text().catch(() => '');
    console.error(`[ModelTour] combine webhook ${combineRes.status} ${combineRes.statusText}:`, body);
    throw new Error(`Failed to combine chunks: ${combineRes.statusText}${body ? ` - ${body}` : ''}`);
  }

  let videoData: unknown = await combineRes.json();
  if (Array.isArray(videoData)) videoData = videoData[0];

  const mergedVideoUrl = (videoData as { video?: { url?: string } })?.video?.url;
  if (!mergedVideoUrl) {
    throw new Error('n8n combine returned no video URL');
  }
  console.log(`[ModelTour] Got merged video from n8n: ${mergedVideoUrl}`);

  // ── Forward to splitter/voice-changer n8n workflow ──────────────────────
  // Fire-and-forget from here - the splitter workflow will call our
  // POST /api/v1/model-tour/webhook when it's done, which marks the job done.
  console.log(`[ModelTour] Forwarding to splitter webhook for job ${jobId}`);
  const gender = optionalString(script.gender);
  const splitterRes = await fetch(N8N_SPLITTER_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, userId, videoUrl: mergedVideoUrl, ...(gender ? { gender } : {}) }),
  });

  if (!splitterRes.ok) {
    const body = await splitterRes.text().catch(() => '');
    console.error(`[ModelTour] Splitter webhook ${splitterRes.status}:`, body);
    throw new Error(`Failed to hand off to splitter: ${splitterRes.statusText}`);
  }

  console.log(`[ModelTour] Job ${jobId} handed off to splitter - waiting for backend webhook callback`);
}
