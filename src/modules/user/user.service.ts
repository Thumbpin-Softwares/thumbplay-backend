import bcrypt from 'bcryptjs';
import { User, IUser } from './user.model';

// Must match thumbpinclient/src/lib/users.js exactly — existing hashed
// passwords in the shared DB were created at cost 12.
const BCRYPT_COST = 12;

export async function findUserByEmail(email: string): Promise<IUser | null> {
  return User.findOne({ email: email.toLowerCase() });
}

interface CreateUserInput {
  email: string;
  password: string;
  name?: string | undefined;
}

// Mirrors thumbpinclient/src/lib/users.js createUser().
export async function createUser({ email, password, name }: CreateUserInput) {
  const normalizedEmail = email.toLowerCase();

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new Error('An account with this email already exists.');
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);

  const user = await User.create({
    email: normalizedEmail,
    name: name || email.split('@')[0] || normalizedEmail,
    hashedPassword,
  });

  return { id: user._id.toString(), email: user.email, name: user.name };
}

interface GoogleProfile {
  googleId: string;
  email: string;
  name?: string | undefined;
  image?: string | undefined;
}

// Mirrors thumbpinclient/src/lib/auth-config.js's NextAuth signIn callback:
// find by googleId → else find by email and link (auto-link by email match,
// no confirmation step — same behavior as before) → else create fresh.
export async function findOrCreateGoogleUser({ googleId, email, name, image }: GoogleProfile): Promise<IUser> {
  const normalizedEmail = email.toLowerCase();

  const byGoogleId = await User.findOne({ googleId });
  if (byGoogleId) return byGoogleId;

  const byEmail = await User.findOne({ email: normalizedEmail });
  if (byEmail) {
    byEmail.googleId = googleId;
    if (!byEmail.image && image) byEmail.image = image;
    await byEmail.save();
    return byEmail;
  }

  return User.create({
    email: normalizedEmail,
    name: name || normalizedEmail.split('@')[0] || normalizedEmail,
    googleId,
    credits: 0,
    freeVideoGenerationsUsed: 0,
    freeAvatarGenerationsUsed: 0,
    ...(image ? { image } : {}),
  });
}
