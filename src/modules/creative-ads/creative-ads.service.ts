import { uploadToR2, buildUserKey } from '../reel/r2.service';

// Every creative template is exactly one n8n webhook: build prompt -> generate
// image -> respond. Unlike the video pipeline (model-tour), there's no shared
// "common renderer" stage, because a static creative is one image, not six
// clips that need stitching - so each template is fully self-contained.
// Adding template #2 is one new n8n workflow (duplicate creative-ads-art-of-living)
// + one new entry below, nothing else in the backend changes.
export type CreativeTemplateKey = 'art-of-living' | 'daylight-aesthetic' | 'midnight-aesthetic' | 'minimal-heights';

const CREATIVE_TEMPLATE_WEBHOOKS: Record<CreativeTemplateKey, string> = {
  'art-of-living': 'https://wrk-413d.apps.excloud.co.in/webhook/7df9c775-58e0-41ad-942f-fd7e9b49fe72',
  'daylight-aesthetic': 'https://wrk-413d.apps.excloud.co.in/webhook/f8505d6a-0905-4e3f-baea-58774e6e22cf',
  'midnight-aesthetic': 'https://wrk-413d.apps.excloud.co.in/webhook/f2638d58-8edc-417a-8da2-51cd9f1435f1',
  'minimal-heights': 'https://wrk-413d.apps.excloud.co.in/webhook/3a5ff9e8-1559-4b72-81a5-0e51632732fc',
};

export function isCreativeTemplateKey(value: string): value is CreativeTemplateKey {
  return Object.prototype.hasOwnProperty.call(CREATIVE_TEMPLATE_WEBHOOKS, value);
}

export function listCreativeTemplateKeys(): CreativeTemplateKey[] {
  return Object.keys(CREATIVE_TEMPLATE_WEBHOOKS) as CreativeTemplateKey[];
}

export interface CreativeAdInput {
  templateKey: CreativeTemplateKey;
  propertyName: string;
  headline: string;
  subheading?: string;
  ctaText?: string;
  tonality?: string;
  // Freeform, template-agnostic extras - a location line, a payment-plan
  // split, a unit-type pill, a URL - whatever a given template's design
  // calls for, rather than growing one bespoke field per template.
  location?: string;
  additionalDetails?: string;
  propertyImageUrls: string[];
  logoUrl?: string;
}

export interface CreativeAdResult {
  url: string;
  rawCostUsd: number | null;
}

// Step 1 & 2 in one call: sends raw form fields straight to the template's
// n8n webhook, which builds its own prompt and renders the final creative -
// returns { image: { url }, cost } (see Extract Creative Image URL node).
export async function generateCreativeAd(
  jobId: string,
  userId: string,
  input: CreativeAdInput,
  signal?: AbortSignal,
): Promise<CreativeAdResult> {
  const webhookUrl = CREATIVE_TEMPLATE_WEBHOOKS[input.templateKey];

  // Image generation is a single call (no 6-scene stitching), so 5 minutes
  // is generous headroom rather than model-tour's 10-minute video budget.
  const timeoutSignal = AbortSignal.timeout(5 * 60 * 1000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      userId,
      propertyName: input.propertyName,
      headline: input.headline,
      subheading: input.subheading ?? '',
      ctaText: input.ctaText ?? '',
      tonality: input.tonality ?? '',
      location: input.location ?? '',
      additionalDetails: input.additionalDetails ?? '',
      propertyImageUrls: input.propertyImageUrls,
      logoUrl: input.logoUrl ?? '',
    }),
    signal: combinedSignal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[CreativeAds] n8n webhook ${res.status} ${res.statusText}:`, body);
    throw new Error(`Failed to generate creative ad: ${res.statusText}${body ? ` - ${body}` : ''}`);
  }

  // A workflow that errors on a node upstream of "Respond With Creative"
  // can still return a 2xx with an empty/non-JSON body (n8n's own generic
  // response, not our respondToWebhook node) - read as text first so that
  // case surfaces as a clear error instead of a raw JSON.parse SyntaxError.
  const rawBody = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    console.error(`[CreativeAds] n8n webhook returned non-JSON body:`, rawBody);
    throw new Error(`Creative ad workflow returned an invalid response${rawBody ? ` - ${rawBody.slice(0, 200)}` : ' (empty body)'}`);
  }

  // n8n's "Respond to Webhook" node wraps the result as [{...}] rather than
  // returning the object directly, same quirk as model-tour's webhooks.
  let data: unknown = parsed;
  if (Array.isArray(data)) data = data[0];

  const imageUrl = (data as { image?: { url?: string } } | undefined)?.image?.url;
  if (!imageUrl) {
    throw new Error('Creative ad workflow returned no image URL');
  }

  const rawCost = (data as Record<string, unknown> | undefined)?.cost;
  const rawCostUsd = typeof rawCost === 'number' ? rawCost : null;

  return { url: imageUrl, rawCostUsd };
}

// Downloads the generated creative from fal's CDN and persists it to our own
// R2 bucket - same pattern as model-tour's n8n webhook handler, just called
// synchronously here since there's no splitter/voice-change hand-off stage
// for static images.
export async function persistCreativeAsset(userId: string, imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Failed to download generated creative: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const key = buildUserKey(userId, 'creatives', 'png', 'creative-ad');
  return uploadToR2(buffer, key, 'image/png');
}
