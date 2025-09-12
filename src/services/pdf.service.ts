import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { GeneratedImage } from './gemini.service.js';

export async function buildPdf(images: GeneratedImage[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  for (const img of images) {
    const buffer = img.buffer;
    const mime = (img.mimeType || '').toLowerCase();

    let embedded: any;
    try {
      if (mime.includes('png')) {
        embedded = await pdfDoc.embedPng(buffer);
      } else if (mime.includes('jpg') || mime.includes('jpeg')) {
        embedded = await pdfDoc.embedJpg(buffer);
      } else {
        // Try png first then jpg as a fallback
        try {
          embedded = await pdfDoc.embedPng(buffer);
        } catch {
          embedded = await pdfDoc.embedJpg(buffer);
        }
      }
    } catch (e) {
      throw new Error('Failed to embed image into PDF');
    }

    const { width, height } = embedded;
    const page = pdfDoc.addPage([width, height]);
    // Ensure all page boxes match the image bounds to avoid any visual margins
    try {
      (page as any).setCropBox(0, 0, width, height);
      (page as any).setBleedBox(0, 0, width, height);
      (page as any).setTrimBox(0, 0, width, height);
      (page as any).setArtBox(0, 0, width, height);
    } catch {}
    page.drawImage(embedded, { x: 0, y: 0, width, height });
  }

  return pdfDoc.save();
}

export async function buildPdfWithText(images: GeneratedImage[], texts: string[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  function wrapText(text: string, maxWidth: number, size: number) {
    const words = (text || '').split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const buffer = img.buffer;
    const mime = (img.mimeType || '').toLowerCase();

    let embedded: any;
    try {
      if (mime.includes('png')) {
        embedded = await pdfDoc.embedPng(buffer);
      } else if (mime.includes('jpg') || mime.includes('jpeg')) {
        embedded = await pdfDoc.embedJpg(buffer);
      } else {
        try {
          embedded = await pdfDoc.embedPng(buffer);
        } catch {
          embedded = await pdfDoc.embedJpg(buffer);
        }
      }
    } catch (e) {
      throw new Error('Failed to embed image into PDF');
    }

    const { width, height } = embedded;
    const page = pdfDoc.addPage([width, height]);
    try {
      (page as any).setCropBox(0, 0, width, height);
      (page as any).setBleedBox(0, 0, width, height);
      (page as any).setTrimBox(0, 0, width, height);
      (page as any).setArtBox(0, 0, width, height);
    } catch {}
    page.drawImage(embedded, { x: 0, y: 0, width, height });

    const text = texts[i] || '';
    if (text && text.trim().length > 0) {
      const margin = Math.max(16, Math.floor(width * 0.04));
      const maxWidth = width - margin * 2;
      const fontSize = Math.max(12, Math.floor(width * 0.018));
      const lines = wrapText(text, maxWidth, fontSize);
      const lineHeight = fontSize * 1.35;
      const padding = Math.floor(fontSize * 0.8);
      const boxHeight = Math.min(Math.max(80, Math.ceil(lines.length * lineHeight) + padding * 2), Math.floor(height * 0.35));
      const boxY = 0; // bottom overlay

      // Background rectangle (opaque white)
      page.drawRectangle({ x: 0, y: boxY, width, height: boxHeight, color: rgb(1, 1, 1) });

      // Draw text lines from bottom area upwards
      let cursorY = boxY + boxHeight - padding - fontSize;
      for (const ln of lines) {
        page.drawText(ln, {
          x: margin,
          y: cursorY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          maxWidth,
        });
        cursorY -= lineHeight;
        if (cursorY < boxY + padding) break; // prevent overflow
      }
    }
  }

  return pdfDoc.save();
}
