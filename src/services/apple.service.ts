import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { config } from '../config/env.js';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');

const jwks = createRemoteJWKSet(APPLE_JWKS_URL);

export type AppleClaims = JWTPayload & {
  sub: string;
  email?: string;
  email_verified?: string | boolean;
  is_private_email?: string | boolean;
  auth_time?: number;
  nonce_supported?: boolean;
};

export async function verifyAppleIdentityToken(identityToken: string): Promise<AppleClaims> {
  const audiences = [config.APPLE_BUNDLE_ID].filter(Boolean) as string[];
  // Allow Expo Go audience in development so testing works
  if (config.NODE_ENV !== 'production') audiences.push('host.exp.exponent', 'host.exp.Exponent');
  const { payload } = await jwtVerify(identityToken, jwks, {
    issuer: APPLE_ISSUER,
    audience: audiences,
  });
  // Basic sanity checks
  if (!payload.sub) throw new Error('Invalid Apple token: missing sub');
  return payload as AppleClaims;
}
