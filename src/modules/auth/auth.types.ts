import { Request } from 'express';
import { IUser } from '../user/user.model';

export interface RegisterInput {
  email: string;
  password: string;
  // `| undefined` (not just `?`) because exactOptionalPropertyTypes is on and
  // callers may pass an explicit `undefined` through (e.g. `name?.trim() || undefined`).
  name?: string | undefined;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UserJwtPayload {
  sub: string;
}

export interface AuthedRequest extends Request {
  user?: IUser;
}
