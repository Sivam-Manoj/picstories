import { Book } from '../models/Book.js';
import { promises as fs } from 'fs';
import path from 'path';
import { ROOT_DIR, UPLOADS_DIR } from '../utils/paths.js';
import { uploadBufferToR2 } from '../utils/r2Upload.js';

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function saveBook(params: {
  userId: string;
  title: string;
  basePrompt: string;
  pageCount: number;
  pagePrompts: string[];
  pdfBytes: Uint8Array;
}) {
  const ts = Date.now();
  const base = slugify(params.title) || 'book';
  const filename = `${base}-${ts}.pdf`;
  const r2Bucket = process.env.R2_BUCKET_NAME;
  const domain = process.env.DOMAIN;

  let pdfPath: string | undefined;
  let pdfUrl: string | undefined;

  // Try R2 first if configured
  if (r2Bucket) {
    try {
      const key = `uploads/pdf/${filename}`;
      const loc = await uploadBufferToR2(Buffer.from(params.pdfBytes), r2Bucket, key, 'application/pdf');
      pdfUrl = domain ? `https://${domain}/${key}` : loc;
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEV] R2 PDF upload OK', { key, url: pdfUrl, bytes: (params.pdfBytes as any)?.length });
      }
    } catch (e: any) {
      console.warn('R2 upload failed for PDF, falling back to local fs:', e?.message || e);
      if (process.env.NODE_ENV === 'development') {
        console.warn('[DEV] Falling back to local PDF write', { filename });
      }
    }
  } else {
    if (process.env.NODE_ENV === 'development') {
      console.log('[DEV] R2 disabled for PDF (missing R2_BUCKET_NAME). Will write local file.', { filename });
    }
  }

  // Fallback to local filesystem if needed or desired
  if (!pdfUrl) {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const absPath = path.join(UPLOADS_DIR, filename);
    await fs.writeFile(absPath, Buffer.from(params.pdfBytes));
    pdfPath = absPath;
    if (process.env.NODE_ENV === 'development') {
      console.log('[DEV] Local PDF written', { path: absPath });
    }
  }

  const doc = await Book.create({
    user: params.userId as any,
    title: params.title,
    basePrompt: params.basePrompt,
    pageCount: params.pageCount,
    pagePrompts: params.pagePrompts,
    ...(pdfPath ? { pdfPath } : {}),
    ...(pdfUrl ? { pdfUrl } : {}),
  });
  return doc;
}

export async function getBookPdfById(id: string) {
  const doc = await Book.findById(id).select('pdfPath pdfUrl title');
  if (!doc) return null;
  const anyDoc = doc as any;
  const pathOrNull: string | undefined = anyDoc.pdfPath || undefined;
  const urlOrNull: string | undefined = anyDoc.pdfUrl || undefined;
  return { path: pathOrNull, url: urlOrNull, title: doc.title };
}

export async function listRecentBooks(limit = 10, userId?: string) {
  const match = userId ? { user: userId as any } : {};
  const docs = await Book.find(match, { title: 1, pageCount: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return docs.map((d: any) => ({ id: String(d._id), title: d.title, pageCount: d.pageCount, createdAt: d.createdAt }));
}
