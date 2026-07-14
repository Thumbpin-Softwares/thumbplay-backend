import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { buildQuotaSnapshot } from './credit.service';

// requireAuth already loaded req.user (hashedPassword excluded) — no extra
// DB round-trip needed here.
export function me(req: AuthedRequest, res: Response): void {
  const user = req.user;
  res.status(200).json({
    success: true,
    credits: user?.credits ?? 0,
    plan: user?.plan || 'free',
    freeQuota: buildQuotaSnapshot(user),
  });
}
