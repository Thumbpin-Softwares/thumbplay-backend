import { Request, Response } from 'express';
import {
  validateRegisterInput,
  registerUser,
  loginWithCredentials,
  toPublicUser,
  getGoogleAuthUrl,
  completeGoogleSignIn,
} from './auth.service';
import {
  signUserToken,
  setAuthCookie,
  clearAuthCookie,
  createOneTimeCode,
  consumeOneTimeCode,
} from './auth.utils';
import { AuthedRequest } from './auth.types';
import { env } from '../../config/env';
import { User } from '../user/user.model';

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

// `?origin=` is sent by the frontend's own "Continue with Google" link (it
// knows its own window.location.origin) so we know which of possibly several
// allowed frontends (FRONTEND_URL) to send the user back to — validated
// against the allow-list, then round-tripped through Google as `state`.
export function googleRedirect(req: Request, res: Response): void {
  const origin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
  const state = env.resolveFrontendUrl(origin);
  res.redirect(getGoogleAuthUrl(state));
}

export async function googleCallback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  // Re-validate rather than trust verbatim — `state` is a query param on this
  // request and could in principle be tampered with before it reaches us.
  const frontendUrl = env.resolveFrontendUrl(typeof req.query.state === 'string' ? req.query.state : undefined);

  if (!code) {
    res.redirect(`${frontendUrl}/auth/login?error=google_oauth_failed`);
    return;
  }

  try {
    const user = await completeGoogleSignIn(code);
    const token = signUserToken(user._id.toString());
    // Set for direct backend calls (e.g. this backend's own /auth/me), but
    // the frontend lives on a different domain and will never see this
    // cookie — it exchanges the one-time code below for its own instead.
    setAuthCookie(res, token);
    const handoffCode = createOneTimeCode(user._id.toString());
    res.redirect(`${frontendUrl}/auth/callback?code=${handoffCode}`);
  } catch (error) {
    console.error('[auth] Google sign-in failed:', error);
    res.redirect(`${frontendUrl}/auth/login?error=google_oauth_failed`);
  }
}

// POST /auth/exchange — called server-to-server by the frontend's own
// backend (not the browser) to trade a one-time handoff code for a fresh
// token + user, so the frontend can mint its own same-domain cookie.
export async function exchangeCode(req: Request, res: Response): Promise<void> {
  const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
  if (!code) {
    res.status(400).json({ error: 'Missing code' });
    return;
  }

  const userId = consumeOneTimeCode(code);
  if (!userId) {
    res.status(401).json({ error: 'Invalid or expired code' });
    return;
  }

  const user = await User.findById(userId).select('-hashedPassword');
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  const token = signUserToken(user._id.toString());
  setAuthCookie(res, token);
  res.status(200).json({ success: true, user, token });
}
