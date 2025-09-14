import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  generatePoemsImagePrompts,
  generatePoemsSet,
} from "../services/openai.service.js";
import { generateImageFromPrompt } from "../services/gemini.service.js";
import {
  createSession,
  toPublicSession,
  loadSession,
  setPagePrompt,
  setPageText,
  storePageImage,
  markConfirmed,
  getLastTwoPrevImages,
} from "../services/session.service.js";
import { buildPdf, buildPdfWithText, buildPdfAtSize, buildPdfWithTextAtSize } from "../services/pdf.service.js";
import { saveBook } from "../services/book.service.js";
import { promises as fs } from "fs";
import { chargeCredits } from '../services/billing.service.js';

export const generatePoems = asyncHandler(
  async (req: Request, res: Response) => {
    const { topic, count, style } = (req.body || {}) as {
      topic?: string;
      count?: number;
      style?: string;
    };
    if (!topic || typeof topic !== "string")
      return res.status(400).json({ error: "topic is required (string)" });

    const c = typeof count === "number" ? count : undefined;
    const out = await generatePoemsSet(topic, c, style);
    return res.json({ poems: out.poems });
  }
);

// ========= SESSION WORKFLOW (full-color poem collection) =========
export const planSession = asyncHandler(async (req: Request, res: Response) => {
  const { title, prompt, pageCount, options } = req.body || {};
  if (!title || typeof title !== "string")
    return res.status(400).json({ error: "title is required (string)" });
  if (!prompt || typeof prompt !== "string")
    return res.status(400).json({ error: "prompt is required (string)" });
  const pages = Number(pageCount);
  if (!pages || pages < 1 || pages > 30)
    return res.status(400).json({ error: "pageCount must be 1..30" });

  const plan = await generatePoemsImagePrompts(
    title,
    prompt,
    pages,
    options?.style
  );
  const session = await createSession({
    title,
    basePrompt: prompt,
    pageCount: pages,
    options,
    coverPrompt: plan.coverPagePrompt,
    pagePrompts: plan.items.map((p) => p.prompt),
  });
  return res.status(201).json({ session: toPublicSession(session) });
});

export const getSession = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const state = await loadSession(id);
  if (!state) return res.status(404).json({ error: "Session not found" });
  return res.json({ session: toPublicSession(state) });
});

export const updatePrompt = asyncHandler(
  async (req: Request, res: Response) => {
    const { id, index } = req.params as { id: string; index: string };
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string")
      return res.status(400).json({ error: "prompt is required (string)" });
    const idx = Number(index);
    const state = await setPagePrompt(id, idx, prompt);
    return res.json({ session: toPublicSession(state) });
  }
);

export const updateText = asyncHandler(async (req: Request, res: Response) => {
  const { id, index } = req.params as { id: string; index: string };
  const { text } = req.body || {};
  if (typeof text !== "string")
    return res.status(400).json({ error: "text is required (string)" });
  const idx = Number(index);
  const state = await setPageText(id, idx, text);
  return res.json({ session: toPublicSession(state) });
});

export const generatePage = asyncHandler(
  async (req: Request, res: Response) => {
    const { id, index } = req.params as { id: string; index: string };
    const idx = Number(index);
    const state = await loadSession(id);
    if (!state) return res.status(404).json({ error: "Session not found" });
    if (idx < 0 || idx > state.pageCount)
      return res.status(400).json({ error: "Invalid page index" });
    try { await chargeCredits((req as any).user?.id, 1); } catch (e: any) { return res.status(e?.status || 400).json({ error: e?.message || 'Charge failed' }); }

    const page = idx === 0 ? state.cover : state.items[idx - 1];
    // Full-color with optional print hints
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
    const prev = await getLastTwoPrevImages(id, idx);
    const img = await generateImageFromPrompt(
      finalPrompt,
      (prev.length
        ? { previousImages: prev, printSpec: { widthInches, heightInches, dpi, useCase: 'poems' as const } }
        : { printSpec: { widthInches, heightInches, dpi, useCase: 'poems' as const } }) as any
    );
    const stored = await storePageImage(id, idx, img.buffer, img.mimeType);
    return res.json({ session: toPublicSession(stored.state) });
  }
);

export const editPage = asyncHandler(async (req: Request, res: Response) => {
  const { id, index } = req.params as { id: string; index: string };
  const { prompt } = (req.body || {}) as { prompt?: string };
  const idx = Number(index);
  const state = await loadSession(id);
  if (!state) return res.status(404).json({ error: "Session not found" });
  if (idx < 0 || idx > state.pageCount)
    return res.status(400).json({ error: "Invalid page index" });
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
  const basePrompt =
    typeof prompt === "string" && prompt.trim() ? prompt : page.prompt;
  const finalPrompt = basePrompt + colorExtra;

  let img;
  if (page.imagePath) {
    const buf = await fs.readFile(page.imagePath);
    img = await generateImageFromPrompt(
      finalPrompt,
      { previousImage: { buffer: buf, mimeType: page.mimeType }, printSpec: { widthInches, heightInches, dpi, useCase: 'poems' as const } } as any
    );
  } else {
    const prev = await getLastTwoPrevImages(id, idx);
    img = await generateImageFromPrompt(
      finalPrompt,
      (prev.length
        ? { previousImages: prev, printSpec: { widthInches, heightInches, dpi, useCase: 'poems' as const } }
        : { printSpec: { widthInches, heightInches, dpi, useCase: 'poems' as const } }) as any
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

export const finalizeSession = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const state = await loadSession(id);
    if (!state) return res.status(404).json({ error: "Session not found" });
    const pages = [state.cover, ...state.items];
    const missing = pages.filter((p) => !p.imagePath).map((p) => p.index);
    if (missing.length)
      return res
        .status(400)
        .json({ error: "Some pages have no image", missing });
    const images = [] as { buffer: Buffer; mimeType: string }[];
    for (const p of pages) {
      const buf = await fs.readFile(p.imagePath!);
      images.push({ buffer: buf, mimeType: p.mimeType || "image/png" });
    }
    const texts = [
      state.cover.text || "",
      ...state.items.map((p) => p.text || ""),
    ];
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
    return res
      .status(201)
      .json({ id: doc._id, title: doc.title, pageCount: doc.pageCount });
  }
);

export const replacePageImage = asyncHandler(
  async (req: Request, res: Response) => {
    const { id, index } = req.params as { id: string; index: string };
    const { dataUrl, base64, mimeType } = (req.body || {}) as {
      dataUrl?: string;
      base64?: string;
      mimeType?: string;
    };
    const idx = Number(index);
    let buffer: Buffer | null = null;
    let mt: string | undefined = mimeType;
    if (dataUrl && typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
      const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) return res.status(400).json({ error: "Invalid dataUrl" });
      mt = match[1];
      try {
        buffer = Buffer.from(match[2], "base64");
      } catch {
        buffer = null;
      }
    } else if (base64 && typeof base64 === "string") {
      try {
        buffer = Buffer.from(base64, "base64");
      } catch {
        buffer = null;
      }
    }
    if (!buffer)
      return res.status(400).json({ error: "Provide dataUrl or base64 image" });
    const stored = await storePageImage(id, idx, buffer, mt);
    return res.json({ session: toPublicSession(stored.state) });
  }
);
