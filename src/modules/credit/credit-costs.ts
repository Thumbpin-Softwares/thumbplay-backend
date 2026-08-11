// Port of thumbpinclient/src/lib/credit-costs.js — trimmed to only the
// actions actually charged by what's migrated to this backend so far
// (seedance-reel, action-reel, comedy-reel, captions). thumbpinclient's
// catalog has ~13 more entries for features (avatar training, image gen,
// etc.) that aren't part of this backend yet — add them here if/when those
// get ported too.

export type FreeBucket = 'video' | 'avatar';

export interface CreditActionConfig {
  cost: number;
  freeBucket: FreeBucket | null;
  label: string;
  isBatch?: boolean;
}

export const FREE_QUOTA_LIMITS: Record<FreeBucket, number> = {
  video: 2,
  avatar: 2,
};

export const CREDIT_ACTIONS: Record<string, CreditActionConfig> = {
  // seedance-reel
  real_estate_video: { cost: 3, freeBucket: 'video', label: 'Real Estate Persona Video' },
  // action-reel + comedy-reel
  action_reel_video: { cost: 4, freeBucket: 'video', label: 'Action Reel Video' },
  // cost is a placeholder — captions are priced dynamically per job via
  // computeCaptionCreditCost() below and passed in as a costOverride.
  captions_generation: { cost: 0, freeBucket: null, label: 'Caption Generation' },
  // cost is a placeholder — priced dynamically per job from n8n's reported
  // `cost` field via computeCreditsFromRawCost() below, passed as a costOverride.
  model_tour_script_generation: { cost: 0, freeBucket: null, label: 'Model Tour Script Generation' },
  // creative-ads: flat cost, charged up front — cheaper than a video (single
  // image call vs six clips), so no free bucket and no per-job dynamic pricing.
  creative_ad_generation: { cost: 2, freeBucket: null, label: 'Creative Ad Generation' },
};

// Generic USD-cost -> credits conversion, same margin/peg as captions but
// without the duration-based buildup captions need — used for actions that
// report back a raw infra cost directly (e.g. the model-tour script
// webhook's `cost` field) instead of one computed from job parameters.
export function computeCreditsFromRawCost(
  rawCostUsd: number,
  marginMultiplier = 10,
  usdToCredits = 480,
): { rawCostUsd: number; sellingPriceUsd: number; credits: number } {
  const sellingPriceUsd = (rawCostUsd || 0) * marginMultiplier;
  const credits = Math.max(1, Math.ceil(sellingPriceUsd * usdToCredits));
  return { rawCostUsd: rawCostUsd || 0, sellingPriceUsd, credits };
}

// VEED subtitles ("captions_generation") pricing — usage-based instead of a
// flat catalog cost. Port of thumbpinclient/src/lib/credit-costs.js. Real
// infra cost formula from the VEED/fal pricing:
//   $0.10 / minute of input video
//   × 2 if the render resolution is above 1080p
//   × 2 if the preset is a "dynamic" (animated) caption style
//   + a flat $0.20 / minute surcharge if translation_language is set
//   minimum charge: 1 minute
// Selling price = raw infra cost × 10 (margin), converted to credits at the
// $1 = 480 credits peg. Always rounds up so a job is never undercharged.
export const CAPTION_PRICING = {
  perMinuteUsd: 0.1,
  highResMultiplier: 2,
  dynamicStyleMultiplier: 2,
  translationSurchargePerMinuteUsd: 0.2,
  minimumMinutes: 1,
  marginMultiplier: 10,
  usdToCredits: 480,
};

// fal.ai/VEED bills us ~$0.10 for a subtitle run the moment it's submitted,
// regardless of whether it succeeds — so a failed run still costs us real
// money. Refunding the full charge on failure would mean eating that cost
// every time, so we keep a flat raw-cost charge (no margin) instead.
export const CAPTION_FAILED_RUN_CHARGE_CREDITS = Math.round(
  CAPTION_PRICING.perMinuteUsd * CAPTION_PRICING.usdToCredits,
); // 48

export interface ComputeCaptionCreditCostInput {
  durationSeconds: number;
  isDynamicPreset?: boolean;
  isHighRes?: boolean;
  hasTranslation?: boolean;
}

export function computeCaptionCreditCost({
  durationSeconds,
  isDynamicPreset = false,
  isHighRes = false,
  hasTranslation = false,
}: ComputeCaptionCreditCostInput): { minutes: number; rawCostUsd: number; sellingPriceUsd: number; credits: number } {
  const { perMinuteUsd, highResMultiplier, dynamicStyleMultiplier, translationSurchargePerMinuteUsd, minimumMinutes, marginMultiplier, usdToCredits } =
    CAPTION_PRICING;

  const minutes = Math.max(minimumMinutes, Math.ceil((durationSeconds || 0) / 60));

  let multiplier = 1;
  if (isHighRes) multiplier *= highResMultiplier;
  if (isDynamicPreset) multiplier *= dynamicStyleMultiplier;

  const rawCostUsd = perMinuteUsd * minutes * multiplier + (hasTranslation ? translationSurchargePerMinuteUsd * minutes : 0);

  const sellingPriceUsd = rawCostUsd * marginMultiplier;
  const credits = Math.max(1, Math.ceil(sellingPriceUsd * usdToCredits));

  return { minutes, rawCostUsd, sellingPriceUsd, credits };
}
