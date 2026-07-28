import { Request, Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { createOrder, verifyWebhookSignature, handleWebhookEvent, RazorpayWebhookEvent } from './payments.service';
import { resolvePurchasable } from './payment-plans';
import { env } from '../../config/env';

// ---------------------------------------------------------------------------
// POST /api/v1/payments/create-order
// Protected: requires a valid auth cookie (requireAuth middleware).
//
// Body: { itemId: string }
//   itemId can be a credit pack  → 'pack-10' | 'pack-50' | 'pack-200' | 'pack-500'
//   or a subscription plan       → 'plan-creator' | 'plan-pro' | 'plan-studio'
// ---------------------------------------------------------------------------
export async function createOrderHandler(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!._id.toString();
    const { itemId } = req.body as { itemId?: string };

    if (!itemId || !resolvePurchasable(itemId)) {
      res.status(400).json({
        error: 'Invalid itemId',
        message: 'itemId must be a valid credit pack (pack-10, pack-50, pack-200, pack-500) or subscription plan (plan-creator, plan-pro, plan-studio).',
      });
      return;
    }

    const order = await createOrder({ userId, itemId });

    res.status(200).json({
      success: true,
      orderId: order.orderId,
      amount: order.amount,        // in paise (₹1 = 100 paise)
      amountINR: order.amountINR,  // in rupees (for display)
      currency: order.currency,
      credits: order.credits,
      label: order.label,
      itemId: order.itemId,
      isMock: order.isMock,
      keyId: env.razorpayKeyId,    // public key — the frontend needs this for the popup
    });
  } catch (error) {
    console.error('[Payments] createOrder error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/payments/webhook
// NOT protected by requireAuth — Razorpay sends this, not the browser.
// Security comes from the HMAC-SHA256 signature verification instead.
//
// IMPORTANT: This route uses express.raw() (see routes file) so we get the
// raw Buffer — we must not let express.json() parse this first, because the
// HMAC is computed over the exact raw bytes Razorpay sent.
// ---------------------------------------------------------------------------
export async function webhookHandler(req: Request, res: Response): Promise<void> {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : (req.body as string);
    const signature = req.headers['x-razorpay-signature'] as string | undefined ?? null;

    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn('[Payments] Webhook signature verification failed.');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const event = JSON.parse(rawBody) as RazorpayWebhookEvent;
    const result = await handleWebhookEvent(event);

    res.status(200).json({ received: true, ...result });
  } catch (error) {
    console.error('[Payments] Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}
