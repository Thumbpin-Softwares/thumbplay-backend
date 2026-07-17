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

// GET /admin/users?q=&page=&limit= — port of thumbpinclient's GET handler.
export async function listUsers(req: Request, res: Response): Promise<void> {
  const search = typeof req.query.q === 'string' ? req.query.q : '';
  const page = parseInt(typeof req.query.page === 'string' ? req.query.page : '1', 10) || 1;
  const limit = parseInt(typeof req.query.limit === 'string' ? req.query.limit : '20', 10) || 20;
  const skip = (page - 1) * limit;

  const query = search
    ? {
        $or: [
          { email: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    User.find(query).select('-hashedPassword -googleId').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(query),
  ]);

  res.status(200).json({ users, total, page, totalPages: Math.ceil(total / limit) });
}

const UPDATABLE_FIELDS = ['plan', 'role', 'name'] as const;

// PATCH /admin/users/:id — update plan, role, name.
export async function updateUser(req: Request, res: Response): Promise<void> {
  const id = singleParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Missing user id' });
    return;
  }

  const body = req.body ?? {};
  const update: Record<string, unknown> = {};
  for (const key of UPDATABLE_FIELDS) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }

  const updated = await User.findByIdAndUpdate(id, { $set: update }, { new: true }).select('-hashedPassword -googleId');
  if (!updated) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.status(200).json({ success: true, user: updated });
}

// DELETE /admin/users/:id — delete user account.
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const id = singleParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Missing user id' });
    return;
  }

  const user = await User.findByIdAndDelete(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.status(200).json({ success: true });
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
