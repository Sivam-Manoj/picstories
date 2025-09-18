import { Router } from "express";
import {
  createColoringBook,
  downloadPdf,
  listBooks,
  planSession,
  getSession,
  updatePrompt,
  generatePage,
  editPage,
  confirmPage,
  finalizeSession,
  replacePageImage,
  enhanceText,
  downloadSessionImagesZip,
} from "../controllers/coloringBook.controller.js";
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Create a coloring book
router.post("/", requireAuth, createColoringBook);

// Download PDF by id (left unauthenticated to allow Google viewer to load)
router.get("/:id/download", downloadPdf);

// List recent books
router.get("/", requireAuth, listBooks);

// Review workflow (sessions)
router.post("/sessions/plan", requireAuth, planSession);
router.get("/sessions/:id", requireAuth, getSession);
router.patch("/sessions/:id/pages/:index", requireAuth, updatePrompt);
router.post("/sessions/:id/pages/:index/generate", requireAuth, generatePage);
router.post("/sessions/:id/pages/:index/edit", requireAuth, editPage);
router.post("/sessions/:id/pages/:index/confirm", requireAuth, confirmPage);
router.post("/sessions/:id/pages/:index/replace", requireAuth, replacePageImage);
router.post("/sessions/:id/finalize", requireAuth, finalizeSession);
router.get("/sessions/:id/download-images", downloadSessionImagesZip);

// Prompt enhancement
router.post("/enhance", requireAuth, enhanceText);

export default router;
