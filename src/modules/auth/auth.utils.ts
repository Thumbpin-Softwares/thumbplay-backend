import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { Response } from 'express';
import { env } from '../../config/env';
import { UserJwtPayload } from './auth.types';

export const AUTH_COOKIE_NAME = 'auth_token';
// 30 days — matches NextAuth's session maxAge in thumbpinclient/src/lib/auth-config.js.
const TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Payload is intentionally minimal (just the user id) — request handlers
// always reload fresh user data from the DB rather than trusting token claims.
export function signUserToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: TOKEN_MAX_AGE_SECONDS });
}

export function verifyUserToken(token: string): UserJwtPayload {
  return jwt.verify(token, env.jwtSecret) as UserJwtPayload;
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    maxAge: TOKEN_MAX_AGE_SECONDS * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
}

// ── One-time OAuth handoff code ─────────────────────────────────────────
// The frontend lives on a different registrable domain than this backend,
// so the auth_token cookie this backend sets after Google OAuth never
// reaches the frontend's own server (browsers don't forward cross-site
// cookies). Instead we hand the frontend a short-lived, single-use opaque
// code via the redirect URL; its server then exchanges that code
// server-to-server (POST /auth/exchange) for a token it can set as its own
// same-domain cookie. In-memory only — fine for a single backend instance;
// switch to Redis if this backend is ever horizontally scaled.
const ONE_TIME_CODE_TTL_MS = 60 * 1000;
const oneTimeCodes = new Map<string, { userId: string; expiresAt: number }>();

export function createOneTimeCode(userId: string): string {
  const code = randomBytes(32).toString('hex');
  oneTimeCodes.set(code, { userId, expiresAt: Date.now() + ONE_TIME_CODE_TTL_MS });
  return code;
}

export function consumeOneTimeCode(code: string): string | null {
  const entry = oneTimeCodes.get(code);
  oneTimeCodes.delete(code); // single use regardless of outcome
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.userId;
}
