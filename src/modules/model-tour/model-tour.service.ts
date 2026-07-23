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

// Our n8n instance owns the whole home-tour pipeline, split across two calls
// to the same webhook:
//   1. generateModelTourScript — raw form inputs in, n8n predicts gender from
//      the images, merges everything, builds the master prompt per property
//      type, and responds synchronously with the merged script JSON. The
//      finalize step shows/lets the user edit this JSON — we never interpret
//      its shape, it's n8n's to define.
//   2. triggerModelTourGeneration — the (possibly edited) script JSON is sent
//      straight back, flat-merged into the request body; n8n recognizes it's
//      already-built script and proceeds to actually render the video,
//      reporting the result back asynchronously via POST /model-tour/webhook
//      (see handleN8nWebhook).
const N8N_WEBHOOK_URL = 'https://wrk-413d.apps.excloud.co.in/webhook/6c94980a-83b4-47dc-ba29-44742ba81714';

export async function generateModelTourScript(
  input: OmniHomeTourInput,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const [avatar_image1, avatar_image2, avatar_image3, avatar_image4] = padTo4(input.avatarImageUrls);
  const [property_image1, property_image2, property_image3, property_image4] = padTo4(input.propertyImageUrls);

  const res = await fetch(N8N_WEBHOOK_URL, {
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
  const res = await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, userId, ...script }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[ModelTour] n8n generate webhook ${res.status} ${res.statusText}:`, body);
    throw new Error(`Failed to trigger model-tour generation: ${res.statusText}${body ? ` — ${body}` : ''}`);
  }
}
