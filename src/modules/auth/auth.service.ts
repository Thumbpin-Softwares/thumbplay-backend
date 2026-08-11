import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { IUser } from '../user/user.model';
import { createUser, findUserByEmail, findOrCreateGoogleUser } from '../user/user.service';
import { RegisterInput, LoginInput } from './auth.types';

// Matches thumbpinclient/src/app/api/auth/register/route.js's validation exactly.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRegisterInput({ email, password }: RegisterInput): string | null {
  if (!email || !password) return 'Email and password are required';
  if (!EMAIL_REGEX.test(email)) return 'Please enter a valid email address';
  if (password.length < 6) return 'Password must be at least 6 characters';
  return null;
}

export async function registerUser(input: RegisterInput) {
  return createUser(input);
}

export async function loginWithCredentials({ email, password }: LoginInput): Promise<IUser> {
  const user = await findUserByEmail(email);
  if (!user || !user.hashedPassword) {
    throw new Error('Invalid email or password');
  }
  const valid = await bcrypt.compare(password, user.hashedPassword);
  if (!valid) {
    throw new Error('Invalid email or password');
  }
  return user;
}

export function toPublicUser(user: IUser) {
  return { id: user._id.toString(), email: user.email, name: user.name };
}

// ── Google OAuth (Authorization Code flow, via google-auth-library) ────────
// No NextAuth/Passport here - we drive the redirect + code exchange directly.

const googleClient = new OAuth2Client({
  clientId: env.googleClientId,
  clientSecret: env.googleClientSecret,
  redirectUri: env.googleCallbackUrl,
});

// `state` carries the originating frontend's origin through the OAuth round
// trip - Google's callback request has no Origin/Referer header we could
// otherwise use to know which frontend (localhost, prod, ...) to redirect
// back to, since FRONTEND_URL can list more than one. Caller is responsible
// for validating `state` against the FRONTEND_URL allow-list before trusting
// it (see googleRedirect/googleCallback).
export function getGoogleAuthUrl(state: string): string {
  return googleClient.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
  });
}

// Exchanges the callback `code` for tokens, verifies the ID token, and
// upserts/links the user - mirrors thumbpinclient's NextAuth signIn callback.
export async function completeGoogleSignIn(code: string): Promise<IUser> {
  const { tokens } = await googleClient.getToken(code);
  if (!tokens.id_token) {
    throw new Error('Google did not return an ID token');
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('Google profile is missing required fields');
  }

  return findOrCreateGoogleUser({
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    image: payload.picture,
  });
}
