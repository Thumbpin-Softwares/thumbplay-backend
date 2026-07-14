import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { env } from '../../config/env';

export const ADMIN_COOKIE_NAME = 'admin_token';
// 8 hours — matches thumbpinclient's admin_session cookie maxAge.
const ADMIN_TOKEN_MAX_AGE_SECONDS = 8 * 60 * 60;

export interface AdminJwtPayload {
  email: string;
  role: 'admin';
}

// Signed with a secret separate from the user JWT secret (env.jwtAdminSecret)
// so a leaked user-token secret alone can't be used to forge admin access.
export function signAdminToken(email: string): string {
  const payload: AdminJwtPayload = { email, role: 'admin' };
  return jwt.sign(payload, env.jwtAdminSecret, { expiresIn: ADMIN_TOKEN_MAX_AGE_SECONDS });
}

export function verifyAdminToken(token: string): AdminJwtPayload {
  return jwt.verify(token, env.jwtAdminSecret) as AdminJwtPayload;
}

export function setAdminCookie(res: Response, token: string): void {
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    maxAge: ADMIN_TOKEN_MAX_AGE_SECONDS * 1000,
    path: '/',
  });
}

export function clearAdminCookie(res: Response): void {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: '/' });
}
