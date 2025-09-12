import type { Request, Response } from 'express';
import { User } from '../models/User.js';

// Map product identifiers or entitlement identifiers to credit amounts.
// You can override these with env vars if desired.
const LITE_CREDITS = Number(process.env.LITE_CREDITS || 20);
const PRO_CREDITS = Number(process.env.PRO_CREDITS || 60);
const ELITE_CREDITS = Number(process.env.ELITE_CREDITS || 150);

function detectTier(payload: any): 'lite' | 'pro' | 'elite' | null {
  const productId: string = payload?.product_id || payload?.productIdentifier || '';
  const entitlementId: string = payload?.entitlement_id || payload?.entitlement_identifier || '';
  const all = `${productId} ${entitlementId}`.toLowerCase();
  if (/elite/.test(all)) return 'elite';
  if (/pro/.test(all)) return 'pro';
  if (/lite|basic|starter/.test(all)) return 'lite';
  return null;
}

function creditsForTier(tier: 'lite' | 'pro' | 'elite') {
  switch (tier) {
    case 'elite':
      return ELITE_CREDITS;
    case 'pro':
      return PRO_CREDITS;
    case 'lite':
    default:
      return LITE_CREDITS;
  }
}

function isGrantingEvent(eventType?: string) {
  // RevenueCat webhook event types: INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, NON_RENEWING_PURCHASE, etc.
  const t = String(eventType || '').toUpperCase();
  return (
    t === 'INITIAL_PURCHASE' ||
    t === 'RENEWAL' ||
    t === 'NON_RENEWING_PURCHASE' ||
    t === 'PRODUCT_CHANGE'
  );
}

export async function revenuecatWebhook(req: Request, res: Response) {
  try {
    const payload = req.body || {};
    const eventType = payload?.event || payload?.type || payload?.event_type;

    if (!isGrantingEvent(eventType)) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    // App user id is set by the client with Purchases.logIn(user.id)
    const appUserId: string | undefined = payload?.app_user_id || payload?.appUserId;
    if (!appUserId) {
      return res.status(400).json({ error: 'Missing app_user_id' });
    }

    const tier = detectTier(payload) || detectTier(payload?.product_identifier) || null;
    if (!tier) {
      // If unknown product/tier, ignore gracefully
      return res.status(200).json({ ok: true, skipped: true, reason: 'unknown_tier' });
    }

    const creditsToGrant = creditsForTier(tier);

    const user = await User.findById(appUserId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.credits = Math.max(0, (user.credits || 0) + creditsToGrant);
    await user.save();

    return res.status(200).json({ ok: true, granted: creditsToGrant, tier });
  } catch (e: any) {
    console.error('RevenueCat webhook error', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
