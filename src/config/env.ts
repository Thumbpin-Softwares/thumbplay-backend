import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function requiredList(name: string): string[] {
  const value = required(name);
  const list = value
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (list.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return list;
}

const nodeEnv = optional('NODE_ENV', 'development');

// This backend's own publicly-reachable base URL (e.g. https://api.thumbpin.in,
// or http://localhost:5000 for local dev). Single source of truth for any URL
// this backend needs to describe itself with — derive from this instead of
// hardcoding or separately configuring the same domain in multiple env vars,
// which is exactly how googleCallbackUrl went stale pointing at localhost
// after a redeploy to a new domain.
const backendPublicUrl = optional('BACKEND_PUBLIC_URL', `http://localhost:${optional('PORT', '5000')}`);

// Parsed and validated once at import time — fails fast on boot if the
// deployment is misconfigured, instead of surfacing as a cryptic runtime
// error the first time a request needs a missing var.
export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(optional('PORT', '5000')),
  backendPublicUrl,

  // Shared with thumbpinclient — same MongoDB database/User collection.
  mongodbUri: required('MONGODB_URI'),

  // Plain JWTs signed by this backend — distinct from NextAuth's NEXTAUTH_SECRET,
  // which encrypts a JWE and isn't compatible with jsonwebtoken's HS256 signing.
  jwtSecret: required('JWT_SECRET'),
  // Separate secret for admin tokens so a leaked user-token secret alone
  // can't be used to forge admin access.
  jwtAdminSecret: required('JWT_ADMIN_SECRET'),

  googleClientId: required('GOOGLE_CLIENT_ID'),
  googleClientSecret: required('GOOGLE_CLIENT_SECRET'),
  // Derived from backendPublicUrl by default — only set GOOGLE_CALLBACK_URL
  // explicitly if it needs to differ from this backend's own public URL.
  googleCallbackUrl: optional('GOOGLE_CALLBACK_URL', `${backendPublicUrl}/api/v1/auth/google/callback`),

  // CORS allow-list (credentials:true requires an explicit origin, not "*").
  // Comma-separated, e.g. FRONTEND_URL=http://localhost:3000,https://ai.thumbpin.in
  frontendUrls: requiredList('FRONTEND_URL'),
  // First entry is the post-OAuth redirect target — Google's callback has no
  // Origin header to route by, so we redirect to a single primary frontend.
  get frontendUrl(): string {
    // requiredList() throws if empty, so this is always defined.
    return this.frontendUrls[0]!;
  },
  // Validates a caller-supplied origin (e.g. Google OAuth's `state`, or an
  // `?origin=` query param) against the FRONTEND_URL allow-list, so it's
  // safe to redirect to — never trust an unvalidated origin for a redirect
  // target. Falls back to the primary frontend if missing/unrecognized.
  resolveFrontendUrl(candidate: string | undefined | null): string {
    const normalized = candidate?.trim().replace(/\/+$/, '');
    if (normalized && this.frontendUrls.includes(normalized)) {
      return normalized;
    }
    return this.frontendUrls[0]!;
  },

  adminEmail: required('ADMIN_EMAIL'),
  // bcrypt hash only — no plaintext admin-password fallback exists in this backend.
  adminPasswordHash: required('ADMIN_PASSWORD_HASH'),

  // Reel pipelines — Seedance video gen, script-splitting LLM, and ElevenLabs
  // TTS all go through fal.ai (FAL_KEY only); Sarvam TTS is a direct provider.
  falKey: required('FAL_KEY'),
  sarvamApiKey: required('SARVAM_API_KEY'),
  r2AccountId: required('R2_ACCOUNT_ID'),
  r2AccessKeyId: required('R2_ACCESS_KEY_ID'),
  r2SecretAccessKey: required('R2_SECRET_ACCESS_KEY'),
  r2BucketName: required('R2_BUCKET_NAME'),
  r2PublicUrl: required('R2_PUBLIC_URL'),

  // n8n workflows.
  n8nSplitterWebhookUrl: optional(
    'N8N_SPLITTER_WEBHOOK_URL',
    'https://wrk-413d.apps.excloud.co.in/webhook/366dbdd2-7128-4265-9e91-55cdf8c9daf2',
  ),

  // ---------------------------------------------------------------------------
  // Razorpay payment gateway
  // Get these from: https://dashboard.razorpay.com → Settings → API Keys
  //
  // razorpayKeyId     — public key, goes in the frontend too (NEXT_PUBLIC_RAZORPAY_KEY_ID)
  // razorpayKeySecret — secret key, backend only — NEVER expose this to the browser
  // razorpayWebhookSecret — from Dashboard → Webhooks → your webhook → Secret
  //
  // All three are optional: if unset, createOrder() returns a mock order so
  // you can test the full UI flow without a real Razorpay account.
  // ---------------------------------------------------------------------------
  razorpayKeyId: optional('RAZORPAY_KEY_ID', ''),
  razorpayKeySecret: optional('RAZORPAY_KEY_SECRET', ''),
  razorpayWebhookSecret: optional('RAZORPAY_WEBHOOK_SECRET', ''),
} as const;
