import { User, IUser } from '../user/user.model';
import { CreditTransaction, ICreditTransaction, CreditEventType, CreditTransactionMode } from './credit-transaction.model';
import { FREE_QUOTA_LIMITS, CREDIT_ACTIONS, FreeBucket, CreditActionConfig } from './credit-costs';

// Port of thumbpinclient/src/lib/credit-system.js, trimmed to the functions
// actually exercised by the live app: hasSufficientCreditsForAction (used by
// action-reel/comedy-reel preview-script), consumeCreditsForAction +
// refundCreditsForAction (used by all three template pipelines), and
// addCredits (used by the Razorpay webhook for paid top-ups). getBatchCost
// had zero callers anywhere in thumbpinclient - dropped.

const CREDIT_FIELDS = '_id plan credits freeVideoGenerationsUsed freeAvatarGenerationsUsed';

function getFreeBucketField(bucket: FreeBucket): 'freeVideoGenerationsUsed' | 'freeAvatarGenerationsUsed' {
  return bucket === 'video' ? 'freeVideoGenerationsUsed' : 'freeAvatarGenerationsUsed';
}

interface LogCreditEventInput {
  userId: string;
  action: string;
  eventType: CreditEventType;
  mode: CreditTransactionMode;
  creditsDelta: number;
  balanceAfter: number | null;
  metadata?: Record<string, unknown>;
}

async function logCreditEvent(payload: LogCreditEventInput): Promise<void> {
  try {
    await CreditTransaction.create({ ...payload, metadata: payload.metadata ?? {} });
  } catch (error) {
    console.warn('[CreditSystem] Failed to log credit transaction:', error instanceof Error ? error.message : error);
  }
}

function getActionOrThrow(action: string): CreditActionConfig {
  const config = CREDIT_ACTIONS[action];
  if (!config) {
    throw new Error(`Unknown credit action: ${action}`);
  }
  return config;
}

export interface QuotaBucketSnapshot {
  used: number;
  limit: number;
  remaining: number;
}

export interface QuotaSnapshot {
  video: QuotaBucketSnapshot;
  avatar: QuotaBucketSnapshot;
}

interface QuotaSource {
  freeVideoGenerationsUsed?: number;
  freeAvatarGenerationsUsed?: number;
}

export function buildQuotaSnapshot(user: QuotaSource | null | undefined): QuotaSnapshot {
  return {
    video: {
      used: user?.freeVideoGenerationsUsed || 0,
      limit: FREE_QUOTA_LIMITS.video,
      remaining: Math.max(0, FREE_QUOTA_LIMITS.video - (user?.freeVideoGenerationsUsed || 0)),
    },
    avatar: {
      used: user?.freeAvatarGenerationsUsed || 0,
      limit: FREE_QUOTA_LIMITS.avatar,
      remaining: Math.max(0, FREE_QUOTA_LIMITS.avatar - (user?.freeAvatarGenerationsUsed || 0)),
    },
  };
}

export interface CreditErrorPayload {
  error: string;
  message: string;
  requiredCredits: number;
  credits: number;
  plan: string;
  freeQuota: QuotaSnapshot;
}

interface UserLike extends QuotaSource {
  credits?: number;
  plan?: string;
}

export function getCreditErrorPayload({
  action,
  user,
  costOverride,
}: {
  action: string;
  user: UserLike | null | undefined;
  costOverride?: number | null | undefined;
}): CreditErrorPayload {
  const config = getActionOrThrow(action);
  const quota = buildQuotaSnapshot(user);
  const requiredCredits = costOverride ?? config.cost ?? 0;

  return {
    error: 'Insufficient credits',
    message: `You need ${requiredCredits} credits for ${config.label}.`,
    requiredCredits,
    credits: user?.credits ?? 0,
    plan: user?.plan || 'free',
    freeQuota: quota,
  };
}

export interface HasSufficientCreditsInput {
  userId: string;
  action: string;
  costOverride?: number | null | undefined;
}

export type HasSufficientCreditsResult =
  | { ok: true; status: 200; user: IUser }
  | { ok: false; status: 404; payload: { error: string } }
  | { ok: false; status: 402; payload: CreditErrorPayload; user: IUser | null };

// Read-only affordability check - does NOT deduct anything. Blocks a
// 0-credit user from using pre-pipeline steps (e.g. script/voice preview)
// without double-charging on top of the pipeline's own debit/refund.
export async function hasSufficientCreditsForAction({
  userId,
  action,
  costOverride,
}: HasSufficientCreditsInput): Promise<HasSufficientCreditsResult> {
  const config = getActionOrThrow(action);
  const user = await User.findById(userId).select(CREDIT_FIELDS);

  if (!user) {
    return { ok: false, status: 404, payload: { error: 'User not found' } };
  }

  const isFreePlan = (user.plan || 'free') === 'free';

  if (isFreePlan && config.freeBucket && costOverride == null) {
    const field = getFreeBucketField(config.freeBucket);
    const limit = FREE_QUOTA_LIMITS[config.freeBucket];
    const used = user[field] || 0;
    if (used < limit) {
      return { ok: true, status: 200, user };
    }
  }

  const cost = costOverride ?? config.cost ?? 0;
  if (cost <= 0 || (user.credits || 0) >= cost) {
    return { ok: true, status: 200, user };
  }

  return {
    ok: false,
    status: 402,
    payload: getCreditErrorPayload({ action, user, costOverride }),
    user,
  };
}

export interface ConsumeDebitFreeQuota {
  mode: 'free_quota';
  action: string;
  freeBucket: FreeBucket;
  freeBucketField: 'freeVideoGenerationsUsed' | 'freeAvatarGenerationsUsed';
  freeBucketLimit: number;
}

export interface ConsumeDebitPaidCredits {
  mode: 'paid_credits';
  action: string;
  chargedCredits: number;
}

export interface ConsumeDebitSystem {
  mode: 'system';
  action: string;
  chargedCredits: number;
}

export type ConsumeDebit = ConsumeDebitFreeQuota | ConsumeDebitPaidCredits | ConsumeDebitSystem;

export interface ConsumeCreditsInput {
  userId: string;
  action: string;
  metadata?: Record<string, unknown>;
  costOverride?: number | null | undefined;
}

export type ConsumeCreditsResult =
  | { ok: true; status: 200; debit: ConsumeDebit; user: IUser; freeQuota: QuotaSnapshot }
  | { ok: false; status: 404; payload: { error: string } }
  | { ok: false; status: 402; payload: CreditErrorPayload; user: IUser | null };

export async function consumeCreditsForAction({
  userId,
  action,
  metadata = {},
  costOverride,
}: ConsumeCreditsInput): Promise<ConsumeCreditsResult> {
  const config = getActionOrThrow(action);
  const user = await User.findById(userId).select(CREDIT_FIELDS);

  if (!user) {
    return { ok: false, status: 404, payload: { error: 'User not found' } };
  }

  const isFreePlan = (user.plan || 'free') === 'free';

  // Free-quota bucket is tried first - only for flat-cost actions (no
  // costOverride), matching thumbpinclient's ordering exactly.
  if (isFreePlan && config.freeBucket && costOverride == null) {
    const field = getFreeBucketField(config.freeBucket);
    const limit = FREE_QUOTA_LIMITS[config.freeBucket];
    const used = user[field] || 0;

    if (used < limit) {
      const updated = await User.findOneAndUpdate(
        { _id: userId, plan: 'free', [field]: { $lt: limit } },
        { $inc: { [field]: 1 } },
        { new: true },
      ).select(CREDIT_FIELDS);

      if (updated) {
        await logCreditEvent({
          userId,
          action,
          eventType: 'free_quota_consumed',
          mode: 'free_quota',
          creditsDelta: 0,
          balanceAfter: updated.credits,
          metadata: { ...metadata, bucket: config.freeBucket, used: updated[field], limit },
        });

        return {
          ok: true,
          status: 200,
          debit: {
            mode: 'free_quota',
            action,
            freeBucket: config.freeBucket,
            freeBucketField: field,
            freeBucketLimit: limit,
          },
          user: updated,
          freeQuota: buildQuotaSnapshot(updated),
        };
      }
    }
  }

  const cost = costOverride ?? config.cost ?? 0;

  if (cost <= 0) {
    return {
      ok: true,
      status: 200,
      debit: { mode: 'system', action, chargedCredits: 0 },
      user,
      freeQuota: buildQuotaSnapshot(user),
    };
  }

  // Atomic guarded debit - $gte prevents a race from taking the balance negative.
  const updated = await User.findOneAndUpdate(
    { _id: userId, credits: { $gte: cost } },
    { $inc: { credits: -cost } },
    { new: true },
  ).select(CREDIT_FIELDS);

  if (!updated) {
    const latestUser = await User.findById(userId).select(CREDIT_FIELDS);
    return {
      ok: false,
      status: 402,
      payload: getCreditErrorPayload({ action, user: latestUser, costOverride }),
      user: latestUser,
    };
  }

  await logCreditEvent({
    userId,
    action,
    eventType: 'credits_debited',
    mode: 'paid_credits',
    creditsDelta: -cost,
    balanceAfter: updated.credits,
    metadata,
  });

  return {
    ok: true,
    status: 200,
    debit: { mode: 'paid_credits', action, chargedCredits: cost },
    user: updated,
    freeQuota: buildQuotaSnapshot(updated),
  };
}

export interface RefundCreditsInput {
  userId: string;
  action: string;
  debit: ConsumeDebit | null | undefined;
  metadata?: Record<string, unknown>;
  amount?: number;
}

export type RefundCreditsResult = { ok: true; skipped: true } | { ok: true; user: IUser | null };

export async function refundCreditsForAction({
  userId,
  action,
  debit,
  metadata = {},
  amount,
}: RefundCreditsInput): Promise<RefundCreditsResult> {
  if (!debit || debit.mode === 'system') {
    return { ok: true, skipped: true };
  }

  if (debit.mode === 'free_quota') {
    const field = debit.freeBucketField;
    const updated = await User.findOneAndUpdate(
      { _id: userId, [field]: { $gt: 0 } },
      { $inc: { [field]: -1 } },
      { new: true },
    ).select(CREDIT_FIELDS);

    if (updated) {
      await logCreditEvent({
        userId,
        action,
        eventType: 'credits_refunded',
        mode: 'free_quota',
        creditsDelta: 0,
        balanceAfter: updated.credits,
        metadata: { ...metadata, refundType: 'free_quota_slot_restored', bucket: debit.freeBucket },
      });
    }

    return { ok: true, user: updated || null };
  }

  if (debit.mode === 'paid_credits') {
    const fullAmount = debit.chargedCredits || getActionOrThrow(action).cost || 0;
    const refundAmount = amount != null ? Math.max(0, Math.min(amount, fullAmount)) : fullAmount;
    if (refundAmount === 0) return { ok: true, skipped: true };

    const updated = await User.findByIdAndUpdate(
      userId,
      { $inc: { credits: refundAmount } },
      { new: true },
    ).select(CREDIT_FIELDS);

    if (updated) {
      await logCreditEvent({
        userId,
        action,
        eventType: 'credits_refunded',
        mode: 'paid_credits',
        creditsDelta: refundAmount,
        balanceAfter: updated.credits,
        metadata,
      });
    }

    return { ok: true, user: updated || null };
  }

  return { ok: true, skipped: true };
}

export interface AddCreditsInput {
  userId: string;
  amount: number;
  action?: string;
  metadata?: Record<string, unknown>;
}

// Used by the Razorpay top-up webhook (not ported in this pass) - kept here
// since it's live, active credit-system infrastructure.
export async function addCredits({ userId, amount, action = 'credits_topup', metadata = {} }: AddCreditsInput) {
  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  const user = await User.findByIdAndUpdate(userId, { $inc: { credits: amount } }, { new: true }).select('_id credits');

  if (!user) {
    throw new Error('User not found');
  }

  await logCreditEvent({
    userId,
    action,
    eventType: 'credits_added',
    mode: 'system',
    creditsDelta: amount,
    balanceAfter: user.credits,
    metadata,
  });

  return user;
}

export interface ListTransactionsInput {
  userId: string;
  limit?: number;
  skip?: number;
}

export interface ListTransactionsResult {
  transactions: ICreditTransaction[];
  hasMore: boolean;
}

const DEFAULT_TRANSACTIONS_LIMIT = 20;
const MAX_TRANSACTIONS_LIMIT = 100;

// A user's own credit activity feed - newest first. Fetches one extra row
// (limit + 1) to determine `hasMore` without a separate count query.
export async function listTransactionsForUser({
  userId,
  limit = DEFAULT_TRANSACTIONS_LIMIT,
  skip = 0,
}: ListTransactionsInput): Promise<ListTransactionsResult> {
  const boundedLimit = Math.min(Math.max(1, limit), MAX_TRANSACTIONS_LIMIT);

  const rows = await CreditTransaction.find({ userId })
    .sort({ createdAt: -1 })
    .skip(Math.max(0, skip))
    .limit(boundedLimit + 1)
    .lean();

  const hasMore = rows.length > boundedLimit;
  return { transactions: rows.slice(0, boundedLimit), hasMore };
}

export type AdminCreditAction = 'set' | 'add' | 'remove';

export interface AdminAdjustCreditsInput {
  userId: string;
  action: AdminCreditAction;
  amount: number;
  adminEmail: string;
}

// Ports thumbpinclient's PATCH /api/admin/users/[id]/credits logic - kept
// here (rather than raw Mongo updates in the admin controller) so all
// credit-balance mutation logic lives in one service.
export async function adminAdjustCredits({ userId, action, amount, adminEmail }: AdminAdjustCreditsInput) {
  let update: Record<string, unknown>;

  if (action === 'set') {
    update = { $set: { credits: amount } };
  } else if (action === 'add') {
    update = { $inc: { credits: amount } };
  } else {
    const user = await User.findById(userId).select('credits');
    if (!user) {
      throw new Error('User not found');
    }
    const newAmount = Math.max(0, user.credits - amount);
    update = { $set: { credits: newAmount } };
  }

  const updated = await User.findByIdAndUpdate(userId, update, { new: true }).select('_id email name credits plan');
  if (!updated) {
    throw new Error('User not found');
  }

  await logCreditEvent({
    userId,
    action: 'admin_credit_adjustment',
    eventType: action === 'add' ? 'credits_added' : action === 'remove' ? 'credits_debited' : 'credits_set',
    mode: 'admin',
    creditsDelta: action === 'set' ? 0 : action === 'add' ? amount : -amount,
    balanceAfter: updated.credits,
    metadata: { adminAction: action, adminEmail },
  });

  return updated;
}
