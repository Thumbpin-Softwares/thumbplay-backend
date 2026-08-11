// ---------------------------------------------------------------------------
// Single source of truth for all purchasable plans and credit packs.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CREDIT PACKS - one-time top-up purchases
// amountINR is in ₹ rupees. Razorpay receives amountINR × 100 as paise.
// ---------------------------------------------------------------------------
export interface CreditPack {
  credits: number;
  amountINR: number;
  label: string;
}

export const CREDIT_PACKS: Record<string, CreditPack> = {
  'pack-10':  { credits: 10,  amountINR: 199,  label: '10 Credits'  },
  'pack-50':  { credits: 50,  amountINR: 799,  label: '50 Credits'  },
  'pack-200': { credits: 200, amountINR: 2499, label: '200 Credits' },
  'pack-500': { credits: 500, amountINR: 4999, label: '500 Credits' },
};

// ---------------------------------------------------------------------------
// SUBSCRIPTION PLANS - yearly plans shown on the pricing page
//
// These are billed as one-time Razorpay orders for now (recurring Razorpay
// Subscriptions can be wired up in phase 2). When a payment.captured webhook
// fires for one of these:
//  • the user's `plan` field is updated to `planTier` (e.g. 'pro')
//  • `credits` are added to their account
//
// The user schema only has 'free' | 'pro' right now - map Creator/Studio/Enterprise
// all to 'pro' until the schema is extended.
// ---------------------------------------------------------------------------
export type PlanTier = 'free' | 'pro';

export interface SubscriptionPlan {
  title: string;                // e.g. "Creator"
  credits: number;              // credits added on purchase
  amountINR: number;            // yearly price in ₹
  planTier: PlanTier;           // what plan field gets set on the user
  label: string;                // receipt / transaction log label
}

export const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlan> = {
  'plan-creator': {
    title: 'Creator',
    credits: 100_000,
    amountINR: 21_999,
    planTier: 'pro',
    label: 'Creator Plan (1 Year)',
  },
  'plan-pro': {
    title: 'Pro',
    credits: 150_000,
    amountINR: 46_999,
    planTier: 'pro',
    label: 'Pro Plan (1 Year)',
  },
  'plan-studio': {
    title: 'Studio',
    credits: 300_000,
    amountINR: 74_999,
    planTier: 'pro',
    label: 'Studio Plan (1 Year)',
  },
};

// Helper: resolve any pack or plan key → the amount (in paise) and label for
// building a Razorpay order, regardless of whether it's a credit pack or a
// subscription plan.
export type PurchasableItem =
  | { kind: 'credit_pack'; pack: CreditPack }
  | { kind: 'subscription'; plan: SubscriptionPlan };

export function resolvePurchasable(id: string): PurchasableItem | null {
  if (CREDIT_PACKS[id]) return { kind: 'credit_pack', pack: CREDIT_PACKS[id] };
  if (SUBSCRIPTION_PLANS[id]) return { kind: 'subscription', plan: SUBSCRIPTION_PLANS[id] };
  return null;
}
