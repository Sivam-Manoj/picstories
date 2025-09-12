import jwt, { SignOptions, Secret } from 'jsonwebtoken';
import { config } from '../config/env.js';

export type JwtPayload = { sub: string; email: string } & Record<string, any>;

export function signAccessToken(payload: JwtPayload) {
  const opts: SignOptions = { expiresIn: config.JWT_ACCESS_EXPIRES_IN as any };
  return jwt.sign(payload, config.JWT_ACCESS_SECRET as Secret, opts);
}

export function signRefreshToken(payload: JwtPayload) {
  const opts: SignOptions = { expiresIn: config.JWT_REFRESH_EXPIRES_IN as any };
  return jwt.sign(payload, config.JWT_REFRESH_SECRET as Secret, opts);
}

export function verifyAccess(token: string): JwtPayload {
  return jwt.verify(token, config.JWT_ACCESS_SECRET as Secret) as JwtPayload;
}

export function verifyRefresh(token: string): JwtPayload {
  return jwt.verify(token, config.JWT_REFRESH_SECRET as Secret) as JwtPayload;
}
