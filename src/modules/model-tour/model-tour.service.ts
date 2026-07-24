import { uploadToR2, buildUserKey, extFromMime } from '../reel/r2.service';
import { Asset } from '../asset/asset.model';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_BYTES_PER_IMAGE = 10 * 1024 * 1024; // 10 MB

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
}

// Avatar/presenter collection upload now lives in the re-avatars module as
// the one common endpoint every template posts to — see
// re-avatars/re-avatars.service.ts's uploadAvatarCollection.

// Same contract as thumbpinclient's /api/assets/upload (single file) —
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

export interface OmniHomeTourInput {
  avatarImageUrls: string[];
  propertyImageUrls: string[];
  propertyName: string;
  type?: PropertyType;
  locationLandmarks?: string;
  connectivity?: string;
  language?: string;
  tierClass?: string;
  carpetArea?: string;
  amenities?: string;
  tonality?: string;
  vibe?: string;
}

function padTo4(urls: string[]): [string, string, string, string] {
  return [urls[0] ?? '', urls[1] ?? '', urls[2] ?? '', urls[3] ?? ''];
}

// Step 1: Script generation webhook — raw form inputs → n8n returns storyboard JSON.
const N8N_SCRIPT_WEBHOOK_URL = 'https://wrk-413d.apps.excloud.co.in/webhook/6c94980a-83b4-47dc-ba29-44742ba81714';

// Step 2: Video generation webhook — (possibly edited) script JSON → n8n renders
// all 6 video clips with voice and merges them, returns { video: { url } }.
const N8N_VIDEO_WEBHOOK_URL = 'https://wrk-413d.apps.excloud.co.in/webhook/426fc4a4-44b9-4527-8ac5-3fe3e3ed9ce3';

// Step 3: Splitter + voice-change webhook — sends merged video URL + jobId + userId.
// This n8n workflow splits audio, changes voice, re-merges, then POSTs the final
// video URL back to our backend at POST /api/v1/model-tour/webhook.
const N8N_SPLITTER_WEBHOOK_URL = 'https://wrk-413d.apps.excloud.co.in/webhook-test/366dbdd2-7128-4265-9e91-55cdf8c9daf2';

export async function generateModelTourScript(
  input: OmniHomeTourInput,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const [avatar_image1, avatar_image2, avatar_image3, avatar_image4] = padTo4(input.avatarImageUrls);
  const [property_image1, property_image2, property_image3, property_image4] = padTo4(input.propertyImageUrls);

  const res = await fetch(N8N_SCRIPT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[ModelTour] n8n script webhook ${res.status} ${res.statusText}:`, body);
    throw new Error(`Failed to generate model-tour script: ${res.statusText}${body ? ` — ${body}` : ''}`);
  }

  // n8n's "Respond to Webhook" node (JSON mode fed by a normal node's
  // output) wraps the result as an array of items — [{...}] — rather than
  // returning the object directly, so unwrap that shape if present.
  let script: unknown = await res.json();
  if (Array.isArray(script)) script = script[0];

  if (!script || typeof script !== 'object' || Array.isArray(script)) {
    throw new Error('Script workflow returned an invalid response');
  }

  return script as Record<string, unknown>;
}

export async function triggerModelTourGeneration(
  jobId: string,
  userId: string,
  script: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  // ── Step 2: Send edited script to n8n video generation workflow ────────────
  console.log(`[ModelTour] Calling n8n video generation webhook for job ${jobId}`);
  const videoRes = await fetch(N8N_VIDEO_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, userId, ...script }),
    ...(signal ? { signal } : {}),
  });

  if (!videoRes.ok) {
    const body = await videoRes.text().catch(() => '');
    console.error(`[ModelTour] n8n video webhook ${videoRes.status} ${videoRes.statusText}:`, body);
    throw new Error(`Failed to trigger model-tour generation: ${videoRes.statusText}${body ? ` — ${body}` : ''}`);
  }

  // n8n returns the merged video — unwrap array if needed
  let videoData: unknown = await videoRes.json();
  if (Array.isArray(videoData)) videoData = videoData[0];

  const mergedVideoUrl = (videoData as { video?: { url?: string } })?.video?.url;
  if (!mergedVideoUrl) {
    throw new Error('n8n video generation returned no video URL');
  }
  console.log(`[ModelTour] Got merged video from n8n: ${mergedVideoUrl}`);

  // ── Step 3: Forward to splitter/voice-changer n8n workflow ─────────────────
  // This is fire-and-forget from the backend's perspective — the splitter
  // workflow will call our POST /api/v1/model-tour/webhook when it's done,
  // which marks the job as done and unblocks the SSE polling loop.
  console.log(`[ModelTour] Forwarding to splitter webhook for job ${jobId}`);
  const splitterRes = await fetch(N8N_SPLITTER_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, userId, videoUrl: mergedVideoUrl }),
  });

  if (!splitterRes.ok) {
    const body = await splitterRes.text().catch(() => '');
    console.error(`[ModelTour] Splitter webhook ${splitterRes.status}:`, body);
    throw new Error(`Failed to hand off to splitter: ${splitterRes.statusText}`);
  }

  console.log(`[ModelTour] Job ${jobId} handed off to splitter — waiting for backend webhook callback`);
}

