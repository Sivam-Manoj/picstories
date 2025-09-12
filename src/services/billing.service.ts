import { User } from '../models/User.js';

export async function chargeCredits(userId: string, amount = 1) {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  const current = user.credits ?? 0;
  if (current < amount) {
    const err: any = new Error('INSUFFICIENT_CREDITS');
    err.status = 402;
    throw err;
  }
  user.credits = current - amount;
  await user.save();
  return user.credits;
}
