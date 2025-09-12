import { Router } from 'express';
import {
  generatePoems,
  planSession,
  getSession,
  updatePrompt,
  generatePage,
  editPage,
  confirmPage,
  finalizeSession,
  replacePageImage,
  updateText,
} from '../controllers/poems.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/generate', requireAuth, generatePoems);
router.post('/sessions/plan', requireAuth, planSession);
router.get('/sessions/:id', requireAuth, getSession);
router.patch('/sessions/:id/pages/:index', requireAuth, updatePrompt);
router.post('/sessions/:id/pages/:index/generate', requireAuth, generatePage);
router.post('/sessions/:id/pages/:index/edit', requireAuth, editPage);
router.patch('/sessions/:id/pages/:index/text', requireAuth, updateText);
router.post('/sessions/:id/pages/:index/confirm', requireAuth, confirmPage);
router.post('/sessions/:id/pages/:index/replace', requireAuth, replacePageImage);
router.post('/sessions/:id/finalize', requireAuth, finalizeSession);

export default router;
