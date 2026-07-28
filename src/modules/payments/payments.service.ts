import crypto from 'node:crypto';
import { env } from '../../config/env';
import { addCredits } from '../credit/credit.service';
import { User } from '../user/user.model';
import { resolvePurchasable } from './payment-plans';

// ---------------------------------------------------------------------------
// 📚 HOW THIS SERVICE WORKS (Educational comments)
//
// Razorpay payment flow has 3 steps:
//
//  STEP 1 — createOrder():
//    Your backend creates a Razorpay "Order" server-side. Razorpay gives back
//    an order_id. You embed user_id, credits, item_id, and item_kind in the
//    order's "notes" field so the webhook later knows who to credit and what
//    plan to assign — no session needed at webhook time.
//
//  STEP 2 — Frontend checkout:
//    The frontend passes the order_id to the Razorpay JS popup. The user pays.
//    Razorpay sends a POST to your webhook URL when the payment is captured.
//
//  STEP 3 — handleWebhookEvent():
//    Razorpay hits POST /api/v1/payments/webhook with the payment event.
//    We HMAC-verify the signature (critical — otherwise anyone could fake it).
//    For credit packs  → call addCredits()
//    For subscription plans → update user.plan + addCredits()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// STEP 1: Create a Razorpay order
// ---------------------------------------------------------------------------

export interface CreateOrderInput {
  userId: string;
  itemId: string; // e.g. 'pack-50' or 'plan-pro'
}

export interface CreateOrderResult {
  orderId: string;
  amount: number;     // in paise (₹1 = 100 paise)
  amountINR: number;  // human-readable rupees
  currency: string;
  credits: number;
  itemId: string;
  label: string;
  isMock: boolean;    // true when Razorpay keys are not configured (dev mode)
}

export async function createOrder({ userId, itemId }: CreateOrderInput): Promise<CreateOrderResult> {
  const item = resolvePurchasable(itemId);
  if (!item) {
    throw new Error(`Invalid item ID: ${itemId}. Must be a credit pack or subscription plan ID.`);
  }

  const amountINR = item.kind === 'credit_pack' ? item.pack.amountINR : item.plan.amountINR;
  const credits   = item.kind === 'credit_pack' ? item.pack.credits   : item.plan.credits;
  const label     = item.kind === 'credit_pack' ? item.pack.label     : item.plan.label;
  const amountPaise = amountINR * 100; // Razorpay always uses the smallest unit (paise for INR)

  // --- Development mock mode ---
  // If Razorpay keys aren't set, return a fake order so you can test the full
  // UI flow without a real Razorpay account.
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    console.warn('[Payments] Razorpay keys not configured — returning mock order for development.');
    return {
      orderId: `order_mock_${Date.now()}`,
      amount: amountPaise,
      amountINR,
      currency: 'INR',
      credits,
      itemId,
      label,
      isMock: true,
    };
  }

  // --- Real Razorpay order ---
  const Razorpay = (await import('razorpay')).default;
  const razorpay = new Razorpay({
    key_id: env.razorpayKeyId,
    key_secret: env.razorpayKeySecret,
  });

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: `r_${userId}_${Date.now()}`,
    // "notes" travel with the order and are copied onto the payment entity.
    // The webhook reads these — no session/DB lookup needed at that point.
    notes: {
      user_id: userId,
      credits: credits.toString(),
      item_id: itemId,
      item_kind: item.kind,                                      // 'credit_pack' | 'subscription'
      plan_tier: item.kind === 'subscription' ? item.plan.planTier : '',
    },
  });

  return {
    orderId: order.id,
    amount: amountPaise,
    amountINR,
    currency: 'INR',
    credits,
    itemId,
    label,
    isMock: false,
  };
}

// ---------------------------------------------------------------------------
// STEP 3a: Verify the webhook signature
//
// Razorpay signs every webhook POST body with HMAC-SHA256 using your webhook
// secret. You MUST verify this before trusting any event — otherwise a bad
// actor could fake a "payment.captured" event and get free credits.
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!env.razorpayWebhookSecret) {
    console.warn('[Payments] RAZORPAY_WEBHOOK_SECRET not set — skipping signature verification (dev only).');
    return true;
  }
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', env.razorpayWebhookSecret)
    .update(rawBody)
    .digest('hex');

  // timingSafeEqual prevents timing-based attacks (never use === for secrets).
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ---------------------------------------------------------------------------
// STEP 3b: Handle the Razorpay webhook event
//
// "payment.captured" fires when money has actually been collected.
// We read the notes to decide:
//  - credit_pack   → just add credits
//  - subscription  → update user.plan AND add credits
// ---------------------------------------------------------------------------

export interface RazorpayWebhookEvent {
  event: string;
  payload: {
    payment?: {
      entity: {
        id: string;
        order_id: string;
        amount: number;
        notes?: {
          user_id?: string;
          credits?: string;
          item_id?: string;
          item_kind?: string;
          plan_tier?: string;
        };
      };
    };
  };
}

export interface HandleWebhookResult {
  handled: boolean;
  eventType: string;
  userId?: string;
  creditsAdded?: number;
  planUpdated?: string;
}

export async function handleWebhookEvent(event: RazorpayWebhookEvent): Promise<HandleWebhookResult> {
  const eventType = event.event;

  switch (eventType) {
    case 'payment.captured': {
      const payment = event.payload?.payment?.entity;
      if (!payment) {
        console.warn('[Payments] payment.captured event missing payment entity.');
        return { handled: false, eventType };
      }

      const userId    = payment.notes?.user_id;
      const credits   = parseInt(payment.notes?.credits || '0', 10);
      const itemId    = payment.notes?.item_id;
      const itemKind  = payment.notes?.item_kind;
      const planTier  = payment.notes?.plan_tier as 'free' | 'pro' | undefined;

      if (!userId || credits <= 0) {
        console.warn(`[Payments] payment.captured missing user_id/credits. paymentId=${payment.id}`);
        return { handled: false, eventType };
      }

      let planUpdated: string | undefined;

      // Subscription plan → also upgrade the user's plan field
      if (itemKind === 'subscription' && planTier && planTier !== 'free') {
        await User.findByIdAndUpdate(userId, { plan: planTier });
        planUpdated = planTier;
        console.log(`[Payments] Upgraded user ${userId} to plan: ${planTier}`);
      }

      // Always add credits regardless of pack or plan
      await addCredits({
        userId,
        amount: credits,
        action: itemKind === 'subscription' ? 'subscription_recharge' : 'credits_topup',
        metadata: {
          source: 'razorpay',
          paymentId: payment.id,
          orderId: payment.order_id,
          itemId,
          itemKind,
          planTier,
          eventType,
        },
      });

      console.log(`[Payments] Added ${credits} credits to user ${userId} (payment: ${payment.id})`);
      return {
        handled: true,
        eventType,
        userId,
        creditsAdded: credits,
        ...(planUpdated !== undefined ? { planUpdated } : {}),
      };
    }

    default:
      console.log(`[Payments] Unhandled Razorpay event: ${eventType}`);
      return { handled: false, eventType };
  }
}
