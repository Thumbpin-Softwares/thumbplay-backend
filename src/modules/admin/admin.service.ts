import bcrypt from 'bcryptjs';
import { env } from '../../config/env';

// Bcrypt-hash-only credential check. Unlike thumbpinclient's admin login
// (which falls back to a plaintext ADMIN_PASSWORD comparison - and per its
// live .env.local, that fallback is what's actually active today), there is
// no plaintext path here: ADMIN_PASSWORD_HASH is the only accepted credential.
export async function validateAdminCredentials(email: string, password: string): Promise<boolean> {
  if (email !== env.adminEmail) return false;
  return bcrypt.compare(password, env.adminPasswordHash);
}
