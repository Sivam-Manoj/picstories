import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { generatePagePrompts } from "../services/openai.service.js";
import {
  generateImageFromPrompt,
  describeImagesForReference,
} from "../services/gemini.service.js";
import { buildPdf, buildPdfWithText, buildPdfAtSize } from "../services/pdf.service.js";
import {
  saveBook,
  getBookPdfById,
  listRecentBooks,
} from "../services/book.service.js";
import { enhancePrompt as enhanceService } from "../services/promptEnhancer.service.js";
import {
  createSession,
  toPublicSession,
  loadSession,
  setPagePrompt,
  storePageImage,
  markConfirmed,
  getLastTwoPrevImages,
  getLastPrevImages,
  storeContextImages,
  getContextImageBuffers,
} from "../services/session.service.js";
import { promises as fs } from "fs";
import { chargeCredits } from "../services/billing.service.js";

export const createColoringBook = asyncHandler(
  async (req: Request, res: Response) => {
    const { title, prompt, pageCount, options } = req.body || {};

    if (!title || typeof title !== "string") {
      return res.status(400).json({ error: "title is required (string)" });
    }
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required (string)" });
    }
    const pages = Number(pageCount);
    if (!pages || pages < 1 || pages > 150) {
      return res
        .status(400)
        .json({ error: "pageCount must be a number between 1 and 150" });
    }

    // 1) Ask OpenAI to plan prompts per page (includes cover page prompt)
    const plan = await generatePagePrompts(title, prompt, pages, options);
    const coverPagePrompt = plan.coverPagePrompt;
    const pagePrompts = plan.items.map((p) => p.prompt);

    // Optional print specification (page size + dpi)
    const print = (options?.printSpec || options?.print) as
      | { widthInches?: number; heightInches?: number; dpi?: number; fit?: 'cover' | 'contain' }
      | undefined;
    const dpi = Math.max(72, Math.min(1200, Math.floor(print?.dpi || 300)));
    const widthInches = Math.max(1, Math.min(30, Number(print?.widthInches || 8.27)));
    const heightInches = Math.max(1, Math.min(30, Number(print?.heightInches || 11.69)));
    const pxW = Math.round(widthInches * dpi);
    const pxH = Math.round(heightInches * dpi);
    const pageWidthPts = Math.round(widthInches * 72);
    const pageHeightPts = Math.round(heightInches * 72);
    const fitMode: 'cover' | 'contain' = print?.fit === 'cover' ? 'cover' : 'contain';

    // 2) Generate images with Gemini
    // 2a) First page: COLORFUL cover page using coverPagePrompt + extra guidance
    const printExtra = print
      ? `\n\nPrint specifications:\n- Target page size: ${widthInches.toFixed(2)}x${heightInches.toFixed(2)} inches at ${dpi} DPI (≈ ${pxW}×${pxH} px).\n- Compose for portrait orientation and print readability.\n- Keep important content within safe margins; avoid critical details at edges.`
      : '';

    const coverExtra = `\n\nAdditional cover instructions:\n- Full COLOR, vibrant and attractive composition.\n- Include the exact book title text: "${title}" as part of the design (e.g., nice typography).\n- Portrait orientation, polished layout, visually appealing for kids.\n- Do NOT render as black-and-white or line-art.${printExtra}`;
    const images = [] as Awaited<ReturnType<typeof generateImageFromPrompt>>[];
    let prevImage:
      | Awaited<ReturnType<typeof generateImageFromPrompt>>
      | undefined;
    const coverImage = await generateImageFromPrompt(
      coverPagePrompt + coverExtra,
      { printSpec: { widthInches, heightInches, dpi, useCase: 'coloring-book' } }
    );
    images.push(coverImage);
    prevImage = coverImage;

    // 2b) Interior pages: black-and-white line-art; keep prev image as context for consistency
    const interiorExtra = `\n\nAdditional interior instructions:\n- Render as simple, high-contrast BLACK-AND-WHITE line-art (no shading).\n- Keep characters/objects consistent with previous page.\n- Minimal or no background clutter.${printExtra}`;
    for (const p of pagePrompts) {
      const finalPrompt = p + interiorExtra;
      const lastTwo = images
        .slice(-2)
        .map((im) => ({ buffer: im.buffer, mimeType: im.mimeType }));
      const baseOpts = { printSpec: { widthInches, heightInches, dpi, useCase: 'coloring-book' as const } };
      const opts = lastTwo.length ? { ...baseOpts, previousImages: lastTwo } : baseOpts;
      const img = await generateImageFromPrompt(finalPrompt, opts as any);
      images.push(img);
      prevImage = img;
    }

    // 3) Build a PDF (fixed page size if print specified)
    const pdfBytes = print
      ? await buildPdfAtSize(images as any, pageWidthPts, pageHeightPts, fitMode)
      : await buildPdf(images as any);

    // 4) Persist to DB
    const book = await saveBook({
      userId: (req as any).user?.id,
      title,
      basePrompt: prompt,
      pageCount: pages,
      pagePrompts,
      pdfBytes,
    });

    return res
      .status(201)
      .json({ id: book._id, title: book.title, pageCount: book.pageCount });
  }
);

export const downloadPdf = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const book = await getBookPdfById(id);
  if (!book) return res.status(404).json({ error: "Not found" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${sanitizeFileName(book.title)}.pdf"`
  );
  return res.sendFile(book.path);
});

export const listBooks = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  const items = await listRecentBooks(12, userId);
  return res.json({ items });
});

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

// Internal: background generation for an entire session (cover + interiors)
async function backgroundGenerateAll(id: string): Promise<void> {
  const state = await loadSession(id);
  if (!state) return;
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
  const coverExtra = `\n\nAdditional cover instructions:\n- Full COLOR, vibrant and attractive composition.\n- Include the exact book title text: "${state.title}" as part of the design (e.g., nice typography).\n- Portrait orientation, polished layout, visually appealing for kids.\n- Do NOT render as black-and-white or line-art.${printExtra}`;
  const interiorExtra = `\n\nAdditional interior instructions:\n- Render as simple, high-contrast BLACK-AND-WHITE line-art (no shading).\n- Keep characters/objects consistent with previous page.\n- Minimal or no background clutter.${printExtra}`;

  const total = 1 + state.pageCount;
  for (let i = 0; i < total; i++) {
    try {
      const cur = await loadSession(id);
      if (!cur) break;
      const page = i === 0 ? cur.cover : cur.items[i - 1];
      if (page.imagePath) continue;
      const finalPrompt = i === 0 ? page.prompt + coverExtra : page.prompt + interiorExtra;
      const prev = await getLastPrevImages(id, i, 2);
      const refs = await getContextImageBuffers(id);
      const combo: { buffer: Buffer; mimeType?: string }[] = [...prev, ...refs];
      const img = await generateImageFromPrompt(
        finalPrompt,
        (combo.length
          ? { previousImages: combo, printSpec: { widthInches, heightInches, dpi, useCase: 'coloring-book' as const } }
          : { printSpec: { widthInches, heightInches, dpi, useCase: 'coloring-book' as const } }) as any
      );
      // Concurrency guard: if user already generated/edited this page while we were working, don't overwrite
      const after = await loadSession(id);
      if (!after) break;
      const afterPage = i === 0 ? after.cover : after.items[i - 1];
      if (afterPage.imagePath) continue;
      await storePageImage(id, i, img.buffer, img.mimeType);
    } catch (e) {
      console.warn('Background generate page failed:', { id, page: i, error: (e as any)?.message || e });
    }
  }
}

// ============ REVIEW WORKFLOW (SESSION-BASED) ============

export const planSession = asyncHandler(async (req: Request, res: Response) => {
  const { title, prompt, pageCount, options, contextImages } =
    req.body || ({} as any);
  if (!title || typeof title !== "string")
    return res.status(400).json({ error: "title is required (string)" });
  if (!prompt || typeof prompt !== "string")
    return res.status(400).json({ error: "prompt is required (string)" });
  const pages = Number(pageCount);
  if (!pages || pages < 1 || pages > 150)
    return res.status(400).json({ error: "pageCount must be 1..150" });
  // Upfront credits charge: cover + interior pages
  try {
    await chargeCredits((req as any).user?.id, 1 + pages);
  } catch (e: any) {
    return res
      .status(e?.status || 402)
      .json({ error: e?.message || "INSUFFICIENT_CREDITS" });
  }
  let referenceDescription = "";
  // If user provided up to 2 reference images, summarize them for planning cues
  if (Array.isArray(contextImages) && contextImages.length) {
    try {
      const bufs: { buffer: Buffer; mimeType?: string }[] = [];
      for (const it of contextImages.slice(0, 2)) {
        if (
          it?.dataUrl &&
          typeof it.dataUrl === "string" &&
          it.dataUrl.startsWith("data:")
        ) {
          const match = it.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
          if (match) {
            const mt = match[1];
            const buf = Buffer.from(match[2], "base64");
            bufs.push({ buffer: buf, mimeType: mt });
          }
        } else if (it?.base64 && typeof it.base64 === "string") {
          const buf = Buffer.from(it.base64, "base64");
          bufs.push({ buffer: buf, mimeType: it.mimeType });
        }
      }
      if (bufs.length)
        referenceDescription = await describeImagesForReference(bufs);
    } catch {}
  }

  const plan = await generatePagePrompts(title, prompt, pages, {
    ...(options || {}),
    referenceDescription,
  });
  const session = await createSession({
    title,
    basePrompt: prompt,
    pageCount: pages,
    options: {
      ...(options || {}),
      referenceDescription:
        referenceDescription || (options?.referenceDescription ?? undefined),
    },
    coverPrompt: plan.coverPagePrompt,
    pagePrompts: plan.items.map((p) => p.prompt),
  });

  // Persist context images to the session for later generation context
  if (Array.isArray(contextImages) && contextImages.length) {
    try {
      await storeContextImages(session.id, contextImages.slice(0, 2));
    } catch {}
  }

  // Kick off background generation of all pages (cover + interiors) without blocking the response
  try {
    setImmediate(() => {
      backgroundGenerateAll(session.id).catch((err: unknown) => {
        console.error('Background generation failed for session', session.id, err);
      });
    });
  } catch (e) {
    console.warn('Failed to schedule background generation:', e);
  }

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

export const generatePage = asyncHandler(
  async (req: Request, res: Response) => {
    const { id, index } = req.params as { id: string; index: string };
    const { contextImage, async: asyncMode } = (req.body || {}) as {
      contextImage?: { dataUrl?: string; base64?: string; mimeType?: string };
      async?: boolean;
    };
    const idx = Number(index);
    const state = await loadSession(id);
    if (!state) return res.status(404).json({ error: "Session not found" });
    if (idx < 0 || idx > state.pageCount)
      return res.status(400).json({ error: "Invalid page index" });
    // Credits are charged upfront in planSession for coloring books.

    const page = idx === 0 ? state.cover : state.items[idx - 1];
    // Build extra instructions + optional print hints
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
    const coverExtra = `\n\nAdditional cover instructions:\n- Full COLOR, vibrant and attractive composition.\n- Include the exact book title text: "${state.title}" as part of the design (e.g., nice typography).\n- Portrait orientation, polished layout, visually appealing for kids.\n- Do NOT render as black-and-white or line-art.${printExtra}`;
    const interiorExtra = `\n\nAdditional interior instructions:\n- Render as simple, high-contrast BLACK-AND-WHITE line-art (no shading).\n- Keep characters/objects consistent with previous page.\n- Minimal or no background clutter.${printExtra}`;
    const finalPrompt = idx === 0 ? page.prompt + coverExtra : page.prompt + interiorExtra;

    // Visual context: optional per-page user image + session references + last generated images (up to 3 total)
    const prev = await getLastPrevImages(id, idx, 2);
    const refs = await getContextImageBuffers(id);
    const combo: { buffer: Buffer; mimeType?: string }[] = [...prev, ...refs];
    if (contextImage) {
      let buf: Buffer | null = null;
      let mt = contextImage.mimeType;
      if (contextImage.dataUrl && contextImage.dataUrl.startsWith("data:")) {
        const m = contextImage.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
        if (m) {
          mt = m[1];
          try {
            buf = Buffer.from(m[2], "base64");
          } catch {
            buf = null;
          }
        }
      } else if (contextImage.base64) {
        try {
          buf = Buffer.from(contextImage.base64, "base64");
        } catch {
          buf = null;
        }
      }
      if (buf) combo.unshift({ buffer: buf, mimeType: mt });
    }
    const doWork = async () => {
      const img = await generateImageFromPrompt(
        finalPrompt,
        (combo.length
          ? { previousImages: combo, printSpec: { widthInches, heightInches, dpi, useCase: 'coloring-book' as const } }
          : { printSpec: { widthInches, heightInches, dpi, useCase: 'coloring-book' as const } }) as any
      );
      // Concurrency guard: re-check before storing
      const after = await loadSession(id);
      if (!after) return;
      const afterPage = idx === 0 ? after.cover : after.items[idx - 1];
      if (afterPage.imagePath) return; // someone else wrote an image
      await storePageImage(id, idx, img.buffer, img.mimeType);
    };

    if (asyncMode) {
      try { setImmediate(() => { doWork().catch((e) => console.warn('async generate page failed', e)); }); } catch {}
      return res.json({ session: toPublicSession(state) });
    } else {
      await doWork();
      const latest = await loadSession(id);
      return res.json({ session: toPublicSession(latest!) });
    }
  }
);

export const editPage = asyncHandler(async (req: Request, res: Response) => {
  const { id, index } = req.params as { id: string; index: string };
  const { prompt, contextImage, async: asyncMode } = (req.body || {}) as {
    prompt?: string;
    contextImage?: { dataUrl?: string; base64?: string; mimeType?: string };
    async?: boolean;
  };
  const idx = Number(index);
  const state = await loadSession(id);
  if (!state) return res.status(404).json({ error: "Session not found" });
  if (idx < 0 || idx > state.pageCount)
    return res.status(400).json({ error: "Invalid page index" });
  // Credits are charged upfront in planSession for coloring books.

  const page = idx === 0 ? state.cover : state.items[idx - 1];
  // Include printSpec in edit stage as well
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
  const basePrompt = typeof prompt === "string" && prompt.trim() ? prompt : page.prompt;
  const coverExtra = `\n\nAdditional cover instructions:\n- Full COLOR, vibrant and attractive composition.\n- Include the exact book title text: "${state.title}" as part of the design (e.g., nice typography).\n- Portrait orientation, polished layout, visually appealing for kids.\n- Do NOT render as black-and-white or line-art.${printExtra}`;
  const interiorExtra = `\n\nAdditional interior instructions:\n- Render as simple, high-contrast BLACK-AND-WHITE line-art (no shading).\n- Keep characters/objects consistent with previous page.\n- Minimal or no background clutter.${printExtra}`;
  const finalPrompt = idx === 0 ? basePrompt + coverExtra : basePrompt + interiorExtra;

  // Build context: current page (if any), optional per-page user image, plus session refs/recent outputs
  let img;
  const refs = await getContextImageBuffers(id);
  const prev = await getLastPrevImages(id, idx, 2);
  const combo: { buffer: Buffer; mimeType?: string }[] = [...prev, ...refs];
  if (contextImage) {
    let ub: Buffer | null = null;
    let umt = contextImage.mimeType;
    if (contextImage.dataUrl && contextImage.dataUrl.startsWith("data:")) {
      const m = contextImage.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (m) {
        umt = m[1];
        try {
          ub = Buffer.from(m[2], "base64");
        } catch {
          ub = null;
        }
      }
    } else if (contextImage.base64) {
      try {
        ub = Buffer.from(contextImage.base64, "base64");
      } catch {
        ub = null;
      }
    }
    if (ub) combo.unshift({ buffer: ub, mimeType: umt });
  }
  if (page.imagePath) {
    const buf = await fs.readFile(page.imagePath);
    combo.unshift({ buffer: buf, mimeType: page.mimeType });
  }
  const doWork = async () => {
    const out = await generateImageFromPrompt(
      finalPrompt,
      (combo.length
        ? { previousImages: combo, printSpec: { widthInches, heightInches, dpi, useCase: 'coloring-book' as const } }
        : { printSpec: { widthInches, heightInches, dpi, useCase: 'coloring-book' as const } }) as any
    );
    // Concurrency guard
    const after = await loadSession(id);
    if (!after) return;
    const afterPage = idx === 0 ? after.cover : after.items[idx - 1];
    if (afterPage.imagePath && page.imagePath !== afterPage.imagePath) return;
    await storePageImage(id, idx, out.buffer, out.mimeType);
  };

  if (asyncMode) {
    try { setImmediate(() => { doWork().catch((e) => console.warn('async edit page failed', e)); }); } catch {}
    return res.json({ session: toPublicSession(state) });
  } else {
    await doWork();
    const latest = await loadSession(id);
    return res.json({ session: toPublicSession(latest!) });
  }
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

    // Ensure all pages have images; encourage confirmation but don't hard-block
    const pages = [state.cover, ...state.items];
    const missing = pages.filter((p) => !p.imagePath).map((p) => p.index);
    if (missing.length) {
      return res
        .status(400)
        .json({ error: "Some pages have no image", missing });
    }

    // Build PDF from stored images (use fixed page size if provided)
    const images = [] as { buffer: Buffer; mimeType: string }[];
    for (const p of pages) {
      const buf = await fs.readFile(p.imagePath!);
      images.push({ buffer: buf, mimeType: p.mimeType || "image/png" });
    }
    const print = (state.options?.printSpec || state.options?.print) as
      | { widthInches?: number; heightInches?: number; dpi?: number; fit?: 'cover' | 'contain' }
      | undefined;
    let pdfBytes: Uint8Array;
    if (print) {
      const dpi = Math.max(72, Math.min(1200, Math.floor(print.dpi || 300)));
      const widthInches = Math.max(1, Math.min(30, Number(print.widthInches || 8.27)));
      const heightInches = Math.max(1, Math.min(30, Number(print.heightInches || 11.69)));
      const pageWidthPts = Math.round(widthInches * 72);
      const pageHeightPts = Math.round(heightInches * 72);
      const fitMode: 'cover' | 'contain' = print.fit === 'cover' ? 'cover' : 'contain';
      pdfBytes = await buildPdfAtSize(images as any, pageWidthPts, pageHeightPts, fitMode);
    } else {
      pdfBytes = await buildPdf(images as any);
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

// ============ Prompt Enhancement ============
export const enhanceText = asyncHandler(async (req: Request, res: Response) => {
  const { text, kind } = (req.body || {}) as {
    text?: string;
    kind?: "theme" | "cover" | "interior";
  };
  if (!text || typeof text !== "string")
    return res.status(400).json({ error: "text is required (string)" });
  // Charge 0.25 credits for enhancement
  try {
    await chargeCredits((req as any).user?.id, 0.25 as any);
  } catch (e: any) {
    return res
      .status(e?.status || 402)
      .json({ error: e?.message || "INSUFFICIENT_CREDITS" });
  }
  const k = kind === "cover" || kind === "interior" ? kind : "theme";
  const enhanced = await enhanceService(text, k);
  return res.json({ enhanced });
});
