import { promises as fs } from "fs";
import path from "path";
import { SESSIONS_DIR, UPLOADS_DIR, toPublicUrl } from "../utils/paths.js";
import { uploadBufferToR2 } from "../utils/r2Upload.js";

export interface SessionPageState {
  index: number; // 0 = cover, 1..N = interior pages
  prompt: string;
  text?: string; // optional story/poem text for this page
  imagePath?: string; // absolute path on disk
  imageUrl?: string; // public URL (R2)
  mimeType?: string;
  confirmed?: boolean;
}

export async function storeContextImages(
  id: string,
  inputs: Array<{ dataUrl?: string; base64?: string; mimeType?: string }>
): Promise<SessionState> {
  const state = await loadSession(id);
  if (!state) throw new Error("Session not found");
  const imgDir = sessionImagesDir(id);
  await fs.mkdir(imgDir, { recursive: true });
  const stored: { imagePath: string; mimeType?: string }[] = [];
  for (let i = 0; i < Math.min(2, inputs.length); i++) {
    const item = inputs[i];
    let buffer: Buffer | null = null;
    let mt = item.mimeType;
    if (
      item.dataUrl &&
      typeof item.dataUrl === "string" &&
      item.dataUrl.startsWith("data:")
    ) {
      const match = item.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (match) {
        mt = match[1];
        try {
          buffer = Buffer.from(match[2], "base64");
        } catch {
          buffer = null;
        }
      }
    } else if (item.base64 && typeof item.base64 === "string") {
      try {
        buffer = Buffer.from(item.base64, "base64");
      } catch {
        buffer = null;
      }
    }
    if (!buffer) continue;
    const ext = mt?.includes("png")
      ? "png"
      : mt?.includes("jpg") || mt?.includes("jpeg")
      ? "jpg"
      : "png";
    const filename = `context-${i + 1}-${Date.now()}.${ext}`;
    const absPath = path.join(imgDir, filename);
    await fs.writeFile(absPath, buffer);
    stored.push({ imagePath: absPath, mimeType: mt || "image/png" });
  }
  state.contextImages = stored.length ? stored : undefined;
  await saveSession(state);
  return state;
}

export async function getContextImageBuffers(
  id: string
): Promise<{ buffer: Buffer; mimeType?: string }[]> {
  const state = await loadSession(id);
  if (!state || !state.contextImages || !state.contextImages.length) return [];
  const out: { buffer: Buffer; mimeType?: string }[] = [];
  for (const c of state.contextImages) {
    try {
      const buf = await fs.readFile(c.imagePath);
      out.push({ buffer: buf, mimeType: c.mimeType });
    } catch {}
  }
  return out;
}

export interface SessionState {
  id: string;
  title: string;
  basePrompt: string;
  options?: any;
  pageCount: number; // interior count
  cover: SessionPageState; // index 0
  items: SessionPageState[]; // indices 1..N
  contextImages?: { imagePath: string; mimeType?: string }[]; // optional user-provided reference images
  createdAt: number;
  updatedAt: number;
}

function sessionDir(id: string) {
  return path.join(SESSIONS_DIR, id);
}

function sessionStatePath(id: string) {
  return path.join(sessionDir(id), "state.json");
}

function sessionImagesDir(id: string) {
  return path.join(sessionDir(id), "images");
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function createSession(params: {
  title: string;
  basePrompt: string;
  pageCount: number;
  options?: any;
  coverPrompt: string;
  pagePrompts: string[];
}): Promise<SessionState> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  const id = randomId();
  const dir = sessionDir(id);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(sessionImagesDir(id), { recursive: true });

  const now = Date.now();
  const state: SessionState = {
    id,
    title: params.title,
    basePrompt: params.basePrompt,
    pageCount: params.pageCount,
    options: params.options || undefined,
    cover: { index: 0, prompt: params.coverPrompt },
    items: params.pagePrompts.map((p, i) => ({ index: i + 1, prompt: p })),
    createdAt: now,
    updatedAt: now,
  };
  await saveSession(state);
  return state;
}

export async function loadSession(id: string): Promise<SessionState | null> {
  try {
    const data = await fs.readFile(sessionStatePath(id), "utf-8");
    return JSON.parse(data) as SessionState;
  } catch (e) {
    return null;
  }
}

export async function saveSession(state: SessionState): Promise<void> {
  state.updatedAt = Date.now();
  await fs.mkdir(sessionDir(state.id), { recursive: true });
  await fs.writeFile(
    sessionStatePath(state.id),
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}

export function pageCountTotal(state: SessionState) {
  return 1 + state.pageCount; // cover + interiors
}

export function ensureValidIndex(state: SessionState, idx: number) {
  if (idx < 0 || idx > state.pageCount) throw new Error("Invalid page index");
}

export function getPage(state: SessionState, idx: number): SessionPageState {
  ensureValidIndex(state, idx);
  if (idx === 0) return state.cover;
  return state.items[idx - 1];
}

export async function setPagePrompt(
  id: string,
  idx: number,
  prompt: string
): Promise<SessionState> {
  const state = await loadSession(id);
  if (!state) throw new Error("Session not found");
  const page = getPage(state, idx);
  page.prompt = prompt;
  await saveSession(state);
  return state;
}

export async function setPageText(
  id: string,
  idx: number,
  text: string
): Promise<SessionState> {
  const state = await loadSession(id);
  if (!state) throw new Error("Session not found");
  const page = getPage(state, idx);
  page.text = text;
  await saveSession(state);
  return state;
}

export async function storePageImage(
  id: string,
  idx: number,
  buffer: Buffer,
  mimeType?: string
): Promise<{ state: SessionState; imagePath: string }> {
  const state = await loadSession(id);
  if (!state) throw new Error("Session not found");
  const imgDir = sessionImagesDir(id);
  await fs.mkdir(imgDir, { recursive: true });
  const ext = mimeType?.includes("png")
    ? "png"
    : mimeType?.includes("jpg") || mimeType?.includes("jpeg")
    ? "jpg"
    : "png";
  const ts = Date.now();
  const filename = `page-${idx}-${ts}.${ext}`;
  const absPath = path.join(imgDir, filename);
  await fs.writeFile(absPath, buffer);
  const page = getPage(state, idx);
  page.imagePath = absPath;
  page.mimeType = mimeType || "image/png";
  // Also upload to R2 (if configured) and store a public URL for the client
  try {
    const bucket = process.env.R2_BUCKET_NAME;
    if (bucket) {
      const key = `uploads/sessions/${id}/${filename}`;
      const loc = await uploadBufferToR2(buffer, bucket, key, page.mimeType);
      const domain = process.env.DOMAIN;
      page.imageUrl = domain ? `https://${domain}/${key}` : loc;
      if (process.env.NODE_ENV === "development") {
        console.log("[DEV] R2 page image upload OK", {
          sessionId: id,
          idx,
          key,
          url: page.imageUrl,
          mimeType: page.mimeType,
        });
      }
    } else {
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[DEV] R2 disabled for page image (missing R2_BUCKET_NAME). Using local only.",
          {
            sessionId: id,
            idx,
            path: absPath,
          }
        );
      }
    }
  } catch (e) {
    // Non-fatal: keep local path if upload fails
    console.warn("R2 upload failed for page image", {
      id,
      idx,
      error: (e as any)?.message || e,
    });
    if (process.env.NODE_ENV === "development") {
      console.warn("[DEV] Falling back to local image for page", {
        sessionId: id,
        idx,
        path: absPath,
      });
    }
  }
  await saveSession(state);
  return { state, imagePath: absPath };
}

export async function markConfirmed(
  id: string,
  idx: number,
  confirmed: boolean
): Promise<SessionState> {
  const state = await loadSession(id);
  if (!state) throw new Error("Session not found");
  const page = getPage(state, idx);
  page.confirmed = confirmed;
  await saveSession(state);
  return state;
}

export async function getLastTwoPrevImages(
  id: string,
  idx: number
): Promise<{ buffer: Buffer; mimeType?: string }[]> {
  const state = await loadSession(id);
  if (!state) throw new Error("Session not found");
  const all: SessionPageState[] = [state.cover, ...state.items];
  const prev = all.slice(0, idx).filter((p) => !!p.imagePath);
  const lastTwo = prev.slice(-2);
  const out: { buffer: Buffer; mimeType?: string }[] = [];
  for (const p of lastTwo) {
    if (!p.imagePath) continue;
    try {
      const buf = await fs.readFile(p.imagePath);
      out.push({ buffer: buf, mimeType: p.mimeType });
    } catch {}
  }
  return out;
}

export async function getLastPrevImages(
  id: string,
  idx: number,
  count: number = 2
): Promise<{ buffer: Buffer; mimeType?: string }[]> {
  const state = await loadSession(id);
  if (!state) throw new Error("Session not found");
  const all: SessionPageState[] = [state.cover, ...state.items];
  const prev = all.slice(0, idx).filter((p) => !!p.imagePath);
  const lastN = prev.slice(-Math.max(1, Math.floor(count)));
  const out: { buffer: Buffer; mimeType?: string }[] = [];
  for (const p of lastN) {
    if (!p.imagePath) continue;
    try {
      const buf = await fs.readFile(p.imagePath);
      out.push({ buffer: buf, mimeType: p.mimeType });
    } catch {}
  }
  return out;
}

export function toPublicSession(state: SessionState) {
  const mapPage = (p: SessionPageState) => ({
    index: p.index,
    prompt: p.prompt,
    text: p.text,
    confirmed: !!p.confirmed,
    imageUrl:
      p.imageUrl || (p.imagePath ? toPublicUrl(p.imagePath) : undefined),
  });
  return {
    id: state.id,
    title: state.title,
    basePrompt: state.basePrompt,
    options: state.options,
    pageCount: state.pageCount,
    cover: mapPage(state.cover),
    items: state.items.map(mapPage),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}
