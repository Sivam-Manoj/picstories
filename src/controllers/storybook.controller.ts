import { Request, Response } from 'express';
import { chargeCredits } from '../services/billing.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { generateStorybookText, generateStoryImagePrompts } from '../services/openai.service.js';
import { generateImageFromPrompt, describeImagesForReference } from '../services/gemini.service.js';
import {
  createSession,
  toPublicSession,
  loadSession,
  setPagePrompt,
  setPageText,
  storePageImage,
  markConfirmed,
  getLastPrevImages,
  storeContextImages,
  getContextImageBuffers,
} from '../services/session.service.js';
import { enhancePromptStorybook } from '../services/promptEnhancer.service.js';
import { buildPdf, buildPdfWithText, buildPdfAtSize, buildPdfWithTextAtSize } from '../services/pdf.service.js';
import { saveBook } from '../services/book.service.js';
import { promises as fs } from 'fs';

export const generateStorybook = asyncHandler(async (req: Request, res: Response) => {
  const { title, prompt, length } = (req.body || {}) as { title?: string; prompt?: string; length?: 'short' | 'medium' | 'long' };
  if (!title || typeof title !== 'string') return res.status(400).json({ error: 'title is required (string)' });
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt is required (string)' });
  const len: 'short' | 'medium' | 'long' = (length === 'medium' || length === 'long') ? length : 'short';
  const out = await generateStorybookText(title, prompt, len);
  return res.json({ title: out.title, story: out.story });
});

// ========= SESSION WORKFLOW (full-color pages) =========

export const planSession = asyncHandler(async (req: Request, res: Response) => {
  const { title, prompt, pageCount, options, contextImages } = (req.body || {}) as any;
  if (!title || typeof title !== 'string') return res.status(400).json({ error: 'title is required (string)' });
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt is required (string)' });
  const pages = Number(pageCount);
  if (!pages || pages < 1 || pages > 30) return res.status(400).json({ error: 'pageCount must be 1..30' });
  // Build a brief reference description from up to 2 uploaded images
  let referenceDescription = '';
  if (Array.isArray(contextImages) && contextImages.length) {
    try {
      const bufs: { buffer: Buffer; mimeType?: string }[] = [];
      for (const it of contextImages.slice(0, 2)) {
        if (it?.dataUrl && typeof it.dataUrl === 'string' && it.dataUrl.startsWith('data:')) {
          const match = it.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
          if (match) {
            const mt = match[1];
            const buf = Buffer.from(match[2], 'base64');
            bufs.push({ buffer: buf, mimeType: mt });
          }
        } else if (it?.base64 && typeof it.base64 === 'string') {
          const buf = Buffer.from(it.base64, 'base64');
          bufs.push({ buffer: buf, mimeType: it.mimeType });
        }
      }
      if (bufs.length) referenceDescription = await describeImagesForReference(bufs);
    } catch {}
  }

  const plan = await generateStoryImagePrompts(title, prompt, pages, { ...(options || {}), referenceDescription });
  const session = await createSession({
    title,
    basePrompt: prompt,
    pageCount: pages,
    options: { ...(options || {}), referenceDescription: referenceDescription || (options?.referenceDescription ?? undefined) },
    coverPrompt: plan.coverPagePrompt,
    pagePrompts: plan.items.map((p) => p.prompt),
  });

  // Persist user-provided context images to the session
  if (Array.isArray(contextImages) && contextImages.length) {
    try { await storeContextImages(session.id, contextImages.slice(0, 2)); } catch {}
  }

  return res.status(201).json({ session: toPublicSession(session) });
});

// ============ Prompt Enhancement (storybook) ============
export const enhanceText = asyncHandler(async (req: Request, res: Response) => {
  const { text, kind } = (req.body || {}) as { text?: string; kind?: 'theme'|'cover'|'interior'|'page' };
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text is required (string)' });
  const k = (kind === 'cover' || kind === 'interior' || kind === 'page') ? (kind === 'interior' ? 'page' : kind) : 'theme';
  const enhanced = await enhancePromptStorybook(text, k as any);
  return res.json({ enhanced });
});

export const getSession = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const state = await loadSession(id);
  if (!state) return res.status(404).json({ error: 'Session not found' });
  return res.json({ session: toPublicSession(state) });
});

export const updatePrompt = asyncHandler(async (req: Request, res: Response) => {
  const { id, index } = req.params as { id: string; index: string };
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt is required (string)' });
  const idx = Number(index);
  const state = await setPagePrompt(id, idx, prompt);
  return res.json({ session: toPublicSession(state) });
});

export const updateText = asyncHandler(async (req: Request, res: Response) => {
  const { id, index } = req.params as { id: string; index: string };
  const { text } = req.body || {};
  if (typeof text !== 'string') return res.status(400).json({ error: 'text is required (string)' });
  const idx = Number(index);
  const state = await setPageText(id, idx, text);
  return res.json({ session: toPublicSession(state) });
});

export const generatePage = asyncHandler(async (req: Request, res: Response) => {
  const { id, index } = req.params as { id: string; index: string };
  const { contextImage } = (req.body || {}) as { contextImage?: { dataUrl?: string; base64?: string; mimeType?: string } };
  const idx = Number(index);
  const state = await loadSession(id);
  if (!state) return res.status(404).json({ error: 'Session not found' });
  if (idx < 0 || idx > state.pageCount) return res.status(400).json({ error: 'Invalid page index' });
  try { await chargeCredits((req as any).user?.id, 1); } catch (e: any) { return res.status(e?.status || 400).json({ error: e?.message || 'Charge failed' }); }

  const page = idx === 0 ? state.cover : state.items[idx - 1];
  // Full-color guidance + optional print hints for all pages
  const print = (state.options?.printSpec || state.options?.print) as
    | { widthInches?: number; heightInches?: number; dpi?: number }
    | undefined;
  const dpi = Math.max(72, Math.min(1200, Math.floor(print?.dpi || 300)));
  const widthInches = Math.max(1, Math.min(30, Number(print?.widthInches || 8.27)));
  const heightInches = Math.max(1, Math.min(30, Number(print?.heightInches || 11.69)));
  const pxW = Math.round(widthInches * dpi);
  const pxH = Math.round(heightInches * dpi);
  const printExtra = print
    ? `\n\nPrint specifications:\n- Target page size: ${widthInches.toFixed(2)}x${heightInches.toFixed(2)} inches at ${dpi} DPI (≈ ${pxW}×${pxH} px).\n- Compose for portrait orientation and print readability.`
    : '';
  const colorExtra = `\n\nFull COLOR, kid-friendly, portrait orientation. Clean, readable composition.${printExtra}`;
  const finalPrompt = page.prompt + colorExtra;

  // Visual context: recent outputs + user references (prefer to include refs among last three)
  const prev = await getLastPrevImages(id, idx, 3);
  const refs = await getContextImageBuffers(id);
  const combo: { buffer: Buffer; mimeType?: string }[] = [...prev, ...refs];
  if (contextImage) {
    let buf: Buffer | null = null; let mt = contextImage.mimeType;
    if (contextImage.dataUrl && contextImage.dataUrl.startsWith('data:')) {
      const m = contextImage.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (m) { mt = m[1]; try { buf = Buffer.from(m[2], 'base64'); } catch { buf = null; } }
    } else if (contextImage.base64) {
      try { buf = Buffer.from(contextImage.base64, 'base64'); } catch { buf = null; }
    }
    if (buf) combo.unshift({ buffer: buf, mimeType: mt });
  }
  const img = await generateImageFromPrompt(
    finalPrompt,
    (combo.length
      ? { previousImages: combo, printSpec: { widthInches, heightInches, dpi, useCase: 'storybook' as const } }
      : { printSpec: { widthInches, heightInches, dpi, useCase: 'storybook' as const } }) as any
  );
  const stored = await storePageImage(id, idx, img.buffer, img.mimeType);
  return res.json({ session: toPublicSession(stored.state) });
});

export const editPage = asyncHandler(async (req: Request, res: Response) => {
  const { id, index } = req.params as { id: string; index: string };
  const { prompt, contextImage } = (req.body || {}) as { prompt?: string; contextImage?: { dataUrl?: string; base64?: string; mimeType?: string } };
  const idx = Number(index);
  const state = await loadSession(id);
  if (!state) return res.status(404).json({ error: 'Session not found' });
  if (idx < 0 || idx > state.pageCount) return res.status(400).json({ error: 'Invalid page index' });
  try { await chargeCredits((req as any).user?.id, 1); } catch (e: any) { return res.status(e?.status || 400).json({ error: e?.message || 'Charge failed' }); }

  const page = idx === 0 ? state.cover : state.items[idx - 1];
  const print = (state.options?.printSpec || state.options?.print) as
    | { widthInches?: number; heightInches?: number; dpi?: number }
    | undefined;
  const dpi = Math.max(72, Math.min(1200, Math.floor(print?.dpi || 300)));
  const widthInches = Math.max(1, Math.min(30, Number(print?.widthInches || 8.27)));
  const heightInches = Math.max(1, Math.min(30, Number(print?.heightInches || 11.69)));
  const pxW = Math.round(widthInches * dpi);
  const pxH = Math.round(heightInches * dpi);
  const printExtra = print
    ? `\n\nPrint specifications:\n- Target page size: ${widthInches.toFixed(2)}x${heightInches.toFixed(2)} inches at ${dpi} DPI (≈ ${pxW}×${pxH} px).\n- Compose for portrait orientation and print readability.`
    : '';
  const colorExtra = `\n\nFull COLOR, kid-friendly, portrait orientation. Clean, readable composition.${printExtra}`;
  const basePrompt = typeof prompt === 'string' && prompt.trim() ? prompt : page.prompt;
  const finalPrompt = basePrompt + colorExtra;

  // Build context: current page image (if any), plus user refs and recent outputs
  const refs = await getContextImageBuffers(id);
  let img;
  if (page.imagePath) {
    const buf = await fs.readFile(page.imagePath);
    const prev = await getLastPrevImages(id, idx, 2);
    const combo: { buffer: Buffer; mimeType?: string }[] = [{ buffer: buf, mimeType: page.mimeType }, ...prev, ...refs];
    if (contextImage) {
      let ub: Buffer | null = null; let umt = contextImage.mimeType;
      if (contextImage.dataUrl && contextImage.dataUrl.startsWith('data:')) {
        const m = contextImage.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
        if (m) { umt = m[1]; try { ub = Buffer.from(m[2], 'base64'); } catch { ub = null; } }
      } else if (contextImage.base64) {
        try { ub = Buffer.from(contextImage.base64, 'base64'); } catch { ub = null; }
      }
      if (ub) combo.unshift({ buffer: ub, mimeType: umt });
    }
    img = await generateImageFromPrompt(
      finalPrompt,
      { previousImages: combo, printSpec: { widthInches, heightInches, dpi, useCase: 'storybook' as const } } as any
    );
  } else {
    const prev = await getLastPrevImages(id, idx, 3);
    const combo: { buffer: Buffer; mimeType?: string }[] = [...prev, ...refs];
    if (contextImage) {
      let ub: Buffer | null = null; let umt = contextImage.mimeType;
      if (contextImage.dataUrl && contextImage.dataUrl.startsWith('data:')) {
        const m = contextImage.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
        if (m) { umt = m[1]; try { ub = Buffer.from(m[2], 'base64'); } catch { ub = null; } }
      } else if (contextImage.base64) {
        try { ub = Buffer.from(contextImage.base64, 'base64'); } catch { ub = null; }
      }
      if (ub) combo.unshift({ buffer: ub, mimeType: umt });
    }
    img = await generateImageFromPrompt(
      finalPrompt,
      (combo.length
        ? { previousImages: combo, printSpec: { widthInches, heightInches, dpi, useCase: 'storybook' as const } }
        : { printSpec: { widthInches, heightInches, dpi, useCase: 'storybook' as const } }) as any
    );
  }

  const stored = await storePageImage(id, idx, img.buffer, img.mimeType);
  return res.json({ session: toPublicSession(stored.state) });
});

export const confirmPage = asyncHandler(async (req: Request, res: Response) => {
  const { id, index } = req.params as { id: string; index: string };
  const { confirmed } = req.body || {};
  const idx = Number(index);
  const state = await markConfirmed(id, idx, !!confirmed);
  return res.json({ session: toPublicSession(state) });
});

export const finalizeSession = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const state = await loadSession(id);
  if (!state) return res.status(404).json({ error: 'Session not found' });

  const pages = [state.cover, ...state.items];
  const missing = pages.filter((p) => !p.imagePath).map((p) => p.index);
  if (missing.length) return res.status(400).json({ error: 'Some pages have no image', missing });

  const images = [] as { buffer: Buffer; mimeType: string }[];
  for (const p of pages) {
    const buf = await fs.readFile(p.imagePath!);
    images.push({ buffer: buf, mimeType: p.mimeType || 'image/png' });
  }
  const texts = [state.cover.text || '', ...state.items.map((p) => p.text || '')];
  const hasAnyText = texts.some((t) => !!t && t.trim().length > 0);
  const print = (state.options?.printSpec || state.options?.print) as
    | { widthInches?: number; heightInches?: number; dpi?: number; fit?: 'cover' | 'contain' }
    | undefined;
  let pdfBytes: Uint8Array;
  if (print) {
    const widthInches = Math.max(1, Math.min(30, Number(print.widthInches || 8.27)));
    const heightInches = Math.max(1, Math.min(30, Number(print.heightInches || 11.69)));
    const pageWidthPts = Math.round(widthInches * 72);
    const pageHeightPts = Math.round(heightInches * 72);
    const fitMode: 'cover' | 'contain' = print.fit === 'cover' ? 'cover' : 'contain';
    pdfBytes = hasAnyText
      ? await buildPdfWithTextAtSize(images as any, texts, pageWidthPts, pageHeightPts, fitMode)
      : await buildPdfAtSize(images as any, pageWidthPts, pageHeightPts, fitMode);
  } else {
    pdfBytes = hasAnyText ? await buildPdfWithText(images as any, texts) : await buildPdf(images as any);
  }

  const doc = await saveBook({
    userId: (req as any).user?.id,
    title: state.title,
    basePrompt: state.basePrompt,
    pageCount: state.pageCount,
    pagePrompts: state.items.map((x) => x.prompt),
    pdfBytes,
  });
  return res.status(201).json({ id: doc._id, title: doc.title, pageCount: doc.pageCount });
});

export const replacePageImage = asyncHandler(async (req: Request, res: Response) => {
  const { id, index } = req.params as { id: string; index: string };
  const { dataUrl, base64, mimeType } = (req.body || {}) as { dataUrl?: string; base64?: string; mimeType?: string };
  const idx = Number(index);
  let buffer: Buffer | null = null;
  let mt: string | undefined = mimeType;
  if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return res.status(400).json({ error: 'Invalid dataUrl' });
    mt = match[1];
    try { buffer = Buffer.from(match[2], 'base64'); } catch { buffer = null; }
  } else if (base64 && typeof base64 === 'string') {
    try { buffer = Buffer.from(base64, 'base64'); } catch { buffer = null; }
  }
  if (!buffer) return res.status(400).json({ error: 'Provide dataUrl or base64 image' });
  const stored = await storePageImage(id, idx, buffer, mt);
  return res.json({ session: toPublicSession(stored.state) });
});
