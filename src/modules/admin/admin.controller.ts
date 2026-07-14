import { Request, Response } from 'express';
import { validateAdminCredentials } from './admin.service';
import { signAdminToken, setAdminCookie, clearAdminCookie } from './admin.utils';
import { AdminRequest } from './admin.middleware';

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const valid = await validateAdminCredentials(email, password);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signAdminToken(email);
  setAdminCookie(res, token);
  res.status(200).json({ success: true });
}

export function logout(_req: Request, res: Response): void {
  clearAdminCookie(res);
  res.status(200).json({ success: true });
}

// requireAdmin already verified the token and loaded req.admin.
export function me(req: AdminRequest, res: Response): void {
  res.status(200).json({ success: true, admin: req.admin });
}
