import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { createOrderHandler, webhookHandler } from './payments.controller';

const router: Router = Router();

/**
 * @openapi
 * /payments/create-order:
 *   post:
 *     summary: Create a Razorpay order for a credit pack purchase
 *     description: |
 *       **How payment works (step by step):**
 *
 *       1. Frontend calls this endpoint with a `packId` (e.g. `"pack-50"`)
 *       2. Backend creates an order on Razorpay's servers and returns an `orderId`
 *       3. Frontend opens the Razorpay checkout popup using `orderId` + `keyId`
 *       4. User completes payment inside the popup
 *       5. Razorpay fires a `payment.captured` webhook → backend credits the user
 *
 *       Available packs: `pack-10` (₹199 / 10 credits), `pack-50` (₹799 / 50 credits),
 *       `pack-200` (₹2499 / 200 credits), `pack-500` (₹4999 / 500 credits).
 *
 *       If Razorpay keys are not configured, a mock order is returned (development mode).
 *     tags: [Payments]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId]
 *             properties:
 *               itemId:
 *                 type: string
 *                 description: |
 *                   Credit pack ID: pack-10 | pack-50 | pack-200 | pack-500
 *                   Subscription plan ID: plan-creator | plan-pro | plan-studio
 *                 example: plan-pro
 *     responses:
 *       200:
 *         description: Razorpay order created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 orderId: { type: string, example: order_AbCd1234EfGh }
 *                 amount: { type: number, example: 79900, description: "Amount in paise (₹1 = 100 paise)" }
 *                 amountINR: { type: number, example: 799, description: "Amount in rupees for display" }
 *                 currency: { type: string, example: INR }
 *                 credits: { type: number, example: 50 }
 *                 label: { type: string, example: "50 Credits" }
 *                 keyId: { type: string, description: "Razorpay public key for the checkout widget" }
 *                 isMock: { type: boolean, description: "true in dev when Razorpay keys are not set" }
 *       400:
 *         description: Invalid packId
 *       401:
 *         description: Not authenticated
 */
router.post('/create-order', requireAuth, createOrderHandler);

/**
 * @openapi
 * /payments/webhook:
 *   post:
 *     summary: Razorpay webhook receiver (called by Razorpay, not by your frontend)
 *     description: |
 *       Razorpay POSTs payment events here when things happen (payment captured,
 *       subscription activated, etc.). The raw body is HMAC-SHA256 verified before
 *       any processing — set `RAZORPAY_WEBHOOK_SECRET` to the value from your
 *       Razorpay Dashboard → Webhooks page.
 *
 *       **Do NOT call this from the frontend.** Only Razorpay should hit this URL.
 *
 *       Handled events:
 *       - `payment.captured` → credits added to the user's account
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Razorpay event payload (see Razorpay webhook docs)
 *     responses:
 *       200:
 *         description: Event received and processed
 *       401:
 *         description: Signature verification failed
 *       500:
 *         description: Processing error
 */
// express.raw() here is CRITICAL — it gives us the raw Buffer instead of parsed JSON.
// The HMAC signature is computed over the raw bytes, so we must verify before parsing.
router.post('/webhook', express.raw({ type: 'application/json' }), webhookHandler);

export default router;
