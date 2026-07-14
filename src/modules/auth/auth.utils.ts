import jwt from 'jsonwebtoken';
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
