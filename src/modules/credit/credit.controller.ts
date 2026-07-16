import { Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { buildQuotaSnapshot, listTransactionsForUser } from './credit.service';

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

export async function transactions(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.user!._id.toString();
  const limit = Number(req.query.limit) || undefined;
  const skip = Number(req.query.skip) || undefined;

  // exactOptionalPropertyTypes rejects `{ limit: undefined }` for an
  // optional `limit?: number` field — only include the key when it's set.
  const { transactions: rows, hasMore } = await listTransactionsForUser({
    userId,
    ...(limit != null ? { limit } : {}),
    ...(skip != null ? { skip } : {}),
  });
  res.status(200).json({ success: true, transactions: rows, hasMore });
}
