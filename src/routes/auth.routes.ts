import { Router } from 'express';
import { register, resendVerification, verifyEmail, login, refreshToken, me, deleteAccount, logout } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/resend', resendVerification);
router.post('/verify', verifyEmail);
router.post('/login', login);
router.post('/refresh', refreshToken);

router.get('/me', requireAuth, me);
router.delete('/me', requireAuth, deleteAccount);
router.post('/logout', requireAuth, logout);

export default router;
