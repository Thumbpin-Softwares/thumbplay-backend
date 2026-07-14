import { Response, NextFunction, Request } from 'express';
import { ADMIN_COOKIE_NAME, verifyAdminToken, AdminJwtPayload } from './admin.utils';

export interface AdminRequest extends Request {
  admin?: AdminJwtPayload;
}

export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.[ADMIN_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const payload = verifyAdminToken(token);
    if (payload.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated' });
  }
}
