import { Request, Response, NextFunction } from 'express';
import { verifyAccess } from '../utils/jwt.js';
import { User } from '../models/User.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = verifyAccess(token);
    const user = await User.findById(payload.sub).lean();
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    (req as any).user = { id: String(user._id), email: user.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
