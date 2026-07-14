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

const nodeEnv = optional('NODE_ENV', 'development');

// Parsed and validated once at import time — fails fast on boot if the
// deployment is misconfigured, instead of surfacing as a cryptic runtime
// error the first time a request needs a missing var.
export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(optional('PORT', '5000')),

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
  googleCallbackUrl: required('GOOGLE_CALLBACK_URL'),

  // CORS origin (credentials:true requires an explicit origin, not "*") and
  // the post-OAuth redirect target.
  frontendUrl: required('FRONTEND_URL'),

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
} as const;
