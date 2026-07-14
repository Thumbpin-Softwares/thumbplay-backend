import { Request, Response } from 'express';
import {
  validateRegisterInput,
  registerUser,
  loginWithCredentials,
  toPublicUser,
  getGoogleAuthUrl,
  completeGoogleSignIn,
} from './auth.service';
import { signUserToken, setAuthCookie, clearAuthCookie } from './auth.utils';
import { AuthedRequest } from './auth.types';
import { env } from '../../config/env';

export async function register(req: Request, res: Response): Promise<void> {
  const { email, password, name } = req.body ?? {};

  const validationError = validateRegisterInput({ email, password });
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  try {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const user = await registerUser({
      email,
      password,
      ...(trimmedName ? { name: trimmedName } : {}),
    });

    const token = signUserToken(user.id);
    setAuthCookie(res, token);
    res.status(201).json({ success: true, user });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Registration failed' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  try {
    const user = await loginWithCredentials({ email, password });
    const token = signUserToken(user._id.toString());
    setAuthCookie(res, token);
    res.status(200).json({ success: true, user: toPublicUser(user) });
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : 'Login failed' });
  }
}

export function logout(_req: Request, res: Response): void {
  clearAuthCookie(res);
  res.status(200).json({ success: true });
}

// requireAuth already loaded req.user (hashedPassword excluded at the source).
export function me(req: AuthedRequest, res: Response): void {
  res.status(200).json({ success: true, user: req.user });
}

export function googleRedirect(_req: Request, res: Response): void {
  res.redirect(getGoogleAuthUrl());
}

export async function googleCallback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  if (!code) {
    res.redirect(`${env.frontendUrl}/auth/login?error=google_oauth_failed`);
    return;
  }

  try {
    const user = await completeGoogleSignIn(code);
    const token = signUserToken(user._id.toString());
    setAuthCookie(res, token);
    res.redirect(`${env.frontendUrl}/dashboard`);
  } catch (error) {
    console.error('[auth] Google sign-in failed:', error);
    res.redirect(`${env.frontendUrl}/auth/login?error=google_oauth_failed`);
  }
}
