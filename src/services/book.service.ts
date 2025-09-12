import { Book } from '../models/Book.js';
import { promises as fs } from 'fs';
import path from 'path';
import { ROOT_DIR, UPLOADS_DIR } from '../utils/paths.js';

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
  // Ensure uploads directory exists
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  const ts = Date.now();
  const base = slugify(params.title) || 'book';
  const filename = `${base}-${ts}.pdf`;
  const absPath = path.join(UPLOADS_DIR, filename);

  await fs.writeFile(absPath, Buffer.from(params.pdfBytes));

  const doc = await Book.create({
    user: params.userId as any,
    title: params.title,
    basePrompt: params.basePrompt,
    pageCount: params.pageCount,
    pagePrompts: params.pagePrompts,
    pdfPath: absPath,
  });
  return doc;
}

export async function getBookPdfById(id: string) {
  const doc = await Book.findById(id).select('pdfPath title');
  if (!doc) return null;
  return { path: (doc as any).pdfPath as string, title: doc.title };
}

export async function listRecentBooks(limit = 10, userId?: string) {
  const match = userId ? { user: userId as any } : {};
  const docs = await Book.find(match, { title: 1, pageCount: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return docs.map((d: any) => ({ id: String(d._id), title: d.title, pageCount: d.pageCount, createdAt: d.createdAt }));
}
