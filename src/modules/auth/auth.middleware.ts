import { Response, NextFunction } from 'express';
import { AuthedRequest } from './auth.types';
import { AUTH_COOKIE_NAME, verifyUserToken } from './auth.utils';
import { User } from '../user/user.model';

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const payload = verifyUserToken(token);
    // Excluded at the source so req.user never carries the hash anywhere downstream.
    const user = await User.findById(payload.sub).select('-hashedPassword');
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated' });
  }
}
