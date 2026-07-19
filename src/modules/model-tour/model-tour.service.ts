import { fal } from '../reel/fal-client';
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

export interface OmniHomeTourInput {
  avatarImageUrls: string[];
  propertyImageUrls: string[];
  propertyName: string;
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

// Calls fal's omni-hometour-pipeline workflow (does scripting/TTS/video
// generation internally — one call in, one video out) and re-uploads the
// result to our own R2 rather than trusting fal's URL to stay valid
// long-term, matching every other pipeline's convention.
export async function callOmniHomeTourAndUpload(
  input: OmniHomeTourInput,
  userId: string,
  signal?: AbortSignal,
): Promise<string> {
  const [avatar_image1, avatar_image2, avatar_image3, avatar_image4] = padTo4(input.avatarImageUrls);
  const [property_image1, property_image2, property_image3, property_image4] = padTo4(input.propertyImageUrls);

  const result = await fal.subscribe('workflows/thumbpincreatives/omni-hometour-pipeline', {
    input: {
      avatar_image1,
      avatar_image2,
      avatar_image3,
      avatar_image4,
      property_image1,
      property_image2,
      property_image3,
      property_image4,
      property_name: input.propertyName,
      location_landmarks: input.locationLandmarks ?? '',
      connectivity: input.connectivity ?? '',
      language: input.language ?? '',
      tier_class: input.tierClass ?? '',
      carpet_area: input.carpetArea ?? '',
      amenities: input.amenities ?? '',
      tonality: input.tonality ?? '',
      vibe: input.vibe ?? '',
    },
    logs: false,
    ...(signal ? { abortSignal: signal } : {}),
  });

  const data = result?.data as { video?: { url?: string } } | undefined;
  const falVideoUrl = data?.video?.url;
  if (!falVideoUrl) throw new Error('omni-hometour-pipeline returned no video URL');

  const videoRes = await fetch(falVideoUrl, signal ? { signal } : {});
  if (!videoRes.ok) throw new Error(`Failed to fetch generated video: ${videoRes.status}`);
  const videoBuf = Buffer.from(await videoRes.arrayBuffer());
  const key = buildUserKey(userId, 'videos', 'mp4', 'model-tour');
  return uploadToR2(videoBuf, key, 'video/mp4');
}
