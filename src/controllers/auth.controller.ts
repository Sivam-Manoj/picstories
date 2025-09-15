import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.js';
import { hashPassword, verifyPassword, hashString, verifyHash } from '../services/hash.service.js';
import { signAccessToken, signRefreshToken, verifyRefresh } from '../utils/jwt.js';
import { sendVerificationEmail, sendWelcomeEmail } from '../services/email.service.js';
import { verifyAppleIdentityToken } from '../services/apple.service.js';
import { config } from '../config/env.js';

function genCode(len = 6) {
  const n = Math.floor(Math.random() * 10 ** len).toString().padStart(len, '0');
  return n;
}

function sanitizeUser(u: any) {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name || '',
    verified: !!u.verified,
    credits: u.credits ?? 0,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const existing = await User.findOne({ email });
  const code = genCode(6);
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  if (existing) {
    if (existing.verified) return res.status(400).json({ error: 'Account already exists' });
    existing.passwordHash = await hashPassword(password);
    existing.name = name || existing.name;
    existing.verificationCode = code;
    existing.verificationCodeExpires = expires;
    existing.verificationLastSentAt = new Date();
    await existing.save();
    await sendVerificationEmail(existing.email, code).catch(() => {});
    return res.json({ message: 'Verification code sent', user: sanitizeUser(existing) });
  }
  const passwordHash = await hashPassword(password);
  const user = await User.create({ email, name, passwordHash, verified: false, verificationCode: code, verificationCodeExpires: expires, verificationLastSentAt: new Date(), credits: 10 });
  await sendVerificationEmail(user.email, code).catch(() => {});
  return res.status(201).json({ message: 'Verification code sent', user: sanitizeUser(user) });
});

export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.verified) return res.status(400).json({ error: 'Already verified' });
  // Cooldown: 60 seconds
  const now = Date.now();
  const last = user.verificationLastSentAt ? user.verificationLastSentAt.getTime() : 0;
  const remainingMs = 60_000 - (now - last);
  if (remainingMs > 0) {
    const retryAfter = Math.ceil(remainingMs / 1000);
    return res.status(429).json({ error: 'Too many requests. Please wait before resending.', retryAfter });
  }
  const code = genCode(6);
  user.verificationCode = code;
  user.verificationCodeExpires = new Date(Date.now() + 15 * 60 * 1000);
  user.verificationLastSentAt = new Date();
  await user.save();
  await sendVerificationEmail(user.email, code).catch(() => {});
  return res.json({ message: 'Verification code sent', retryAfter: 60 });
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'email and code required' });
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.verified) return res.json({ message: 'Already verified' });
  if (!user.verificationCode || !user.verificationCodeExpires) return res.status(400).json({ error: 'No code issued' });
  if (String(code) !== user.verificationCode) return res.status(400).json({ error: 'Invalid code' });
  if (user.verificationCodeExpires.getTime() < Date.now()) return res.status(400).json({ error: 'Code expired' });
  user.verified = true;
  user.verificationCode = undefined;
  user.verificationCodeExpires = undefined;
  await user.save();
  // Issue tokens on verification
  const access = signAccessToken({ sub: String(user._id), email: user.email });
  const refresh = signRefreshToken({ sub: String(user._id), email: user.email });
  user.refreshTokenHash = await hashString(refresh);
  await user.save();
  // Send a welcome email on first successful verification (non-blocking)
  try { await sendWelcomeEmail(user.email, user.name).catch(() => {}); } catch {}
  return res.json({ user: sanitizeUser(user), accessToken: access, refreshToken: refresh });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  if (!user.verified) return res.status(403).json({ error: 'Email not verified' });
  if (!user.passwordHash) return res.status(400).json({ error: 'Password auth not available' });
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const access = signAccessToken({ sub: String(user._id), email: user.email });
  const refresh = signRefreshToken({ sub: String(user._id), email: user.email });
  user.refreshTokenHash = await hashString(refresh);
  await user.save();
  return res.json({ user: sanitizeUser(user), accessToken: access, refreshToken: refresh });
});

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  const payload = verifyRefresh(refreshToken);
  const user = await User.findById(payload.sub);
  if (!user || !user.refreshTokenHash) return res.status(401).json({ error: 'Unauthorized' });
  const ok = await verifyHash(refreshToken, user.refreshTokenHash);
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  const access = signAccessToken({ sub: String(user._id), email: user.email });
  const newRefresh = signRefreshToken({ sub: String(user._id), email: user.email });
  user.refreshTokenHash = await hashString(newRefresh);
  await user.save();
  return res.json({ accessToken: access, refreshToken: newRefresh });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: sanitizeUser(user) });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { name } = req.body || {};
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (typeof name === 'string') user.name = name.trim();
  await user.save();
  return res.json({ user: sanitizeUser(user) });
});

export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  await User.findByIdAndDelete(userId);
  return res.json({ ok: true });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = await User.findById(userId);
  if (user) {
    user.refreshTokenHash = undefined;
    await user.save();
  }
  return res.json({ ok: true });
});

// ==== Apple Sign-In ====
export const appleSignIn = asyncHandler(async (req: Request, res: Response) => {
  const { identityToken, fullName, email: emailFromBody } = req.body || {};
  if (!identityToken) return res.status(400).json({ error: 'identityToken required' });
  if (!config.APPLE_BUNDLE_ID) return res.status(500).json({ error: 'Server missing APPLE_BUNDLE_ID' });

  // Verify token with Apple and extract stable subject and optional email
  const claims = await verifyAppleIdentityToken(identityToken);
  const appleSub = String(claims.sub);
  const email = (claims.email as string | undefined) || (emailFromBody as string | undefined);

  // Find by provider first
  let user = await User.findOne({ providers: { $elemMatch: { provider: 'apple', providerId: appleSub } } });

  // If not found via provider, try by email (Apple sometimes only provides email on first sign-in)
  if (!user && email) {
    user = await User.findOne({ email });
  }

  // If still not found, create a new user
  if (!user) {
    const providers = [{ provider: 'apple' as const, providerId: appleSub }];
    const fallbackName = fullName?.toString().trim() || (email ? email.split('@')[0] : 'Friend');
    user = await User.create({
      email: email || `${appleSub}@priv.apple.local`,
      name: fallbackName,
      verified: true,
      providers,
      credits: 10,
    });
    // Send welcome email for newly created Apple accounts when we have a real email
    if (email) { try { await sendWelcomeEmail(email, fallbackName).catch(() => {}); } catch {} }
  } else {
    // Link provider if missing
    const hasApple = (user.providers || []).some((p) => p.provider === 'apple' && p.providerId === appleSub);
    if (!hasApple) {
      user.providers = [...(user.providers || []), { provider: 'apple', providerId: appleSub }];
    }
    // If user has no name yet and client provided one OR we can derive from email, set it once
    if (!user.name || user.name.trim().length === 0) {
      const derived = fullName?.toString().trim() || (user.email ? user.email.split('@')[0] : undefined);
      if (derived) user.name = derived;
    }
    // Treat Apple auth as verified email
    if (!user.verified) user.verified = true;
    await user.save();
  }

  const access = signAccessToken({ sub: String(user._id), email: user.email });
  const refresh = signRefreshToken({ sub: String(user._id), email: user.email });
  user.refreshTokenHash = await hashString(refresh);
  await user.save();

  return res.json({ user: sanitizeUser(user), accessToken: access, refreshToken: refresh });
});
