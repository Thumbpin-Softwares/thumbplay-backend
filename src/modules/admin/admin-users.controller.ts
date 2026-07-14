import { Request, Response } from 'express';
import { User } from '../user/user.model';
import { CreditTransaction } from '../credit/credit-transaction.model';
import { adminAdjustCredits, AdminCreditAction } from '../credit/credit.service';
import { AdminRequest } from './admin.middleware';

// Express 5 (path-to-regexp v6+) types repeatable route params as
// string | string[] — normalize since a plain `:id` segment is always a
// single string at runtime.
function singleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// GET /admin/users/:id/credits — port of thumbpinclient's GET handler.
export async function getUserCredits(req: Request, res: Response): Promise<void> {
  const id = singleParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Missing user id' });
    return;
  }

  const [user, transactions] = await Promise.all([
    User.findById(id).select('_id email name credits plan freeVideoGenerationsUsed freeAvatarGenerationsUsed createdAt'),
    CreditTransaction.find({ userId: id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.status(200).json({ user, transactions });
}

const VALID_ACTIONS: AdminCreditAction[] = ['set', 'add', 'remove'];

// PATCH /admin/users/:id/credits — port of thumbpinclient's PATCH handler.
export async function updateUserCredits(req: AdminRequest, res: Response): Promise<void> {
  const id = singleParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Missing user id' });
    return;
  }

  const { action, amount } = req.body ?? {};

  if (!VALID_ACTIONS.includes(action)) {
    res.status(400).json({ error: "action must be 'set', 'add', or 'remove'" });
    return;
  }
  if (typeof amount !== 'number' || amount < 0) {
    res.status(400).json({ error: 'amount must be a non-negative number' });
    return;
  }

  try {
    const updated = await adminAdjustCredits({
      userId: id,
      action,
      amount,
      adminEmail: req.admin?.email ?? 'unknown',
    });
    res.status(200).json({ success: true, user: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update credits';
    res.status(message === 'User not found' ? 404 : 400).json({ error: message });
  }
}
