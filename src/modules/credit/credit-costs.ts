// Port of thumbpinclient/src/lib/credit-costs.js — trimmed to only the
// actions actually charged by the three live template pipelines
// (seedance-reel, action-reel, comedy-reel). thumbpinclient's catalog has
// ~15 more entries for features (captions, avatar training, image gen, etc.)
// that aren't part of this backend yet — add them here if/when those
// pipelines get ported too.

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
};
