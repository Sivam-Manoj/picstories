import { GoogleGenAI } from "@google/genai";
import { config } from "../config/env.js";

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
}

export type PrintSpec = {
  widthInches?: number;
  heightInches?: number;
  dpi?: number; // defaults to 300
  useCase?: string; // e.g., 'coloring-book', 'storybook', 'poems'
};

function buildSystemInstruction(spec?: PrintSpec) {
  const dpi = Math.max(72, Math.min(1200, Math.floor(spec?.dpi || 300)));
  const widthInches = Math.max(1, Math.min(30, Number(spec?.widthInches || 8.27)));
  const heightInches = Math.max(1, Math.min(30, Number(spec?.heightInches || 11.69)));
  const useCase = (spec?.useCase || 'children\'s picture/colouring/story book pages for print').trim();
  const isSquare = Math.abs(widthInches - heightInches) <= 0.05;
  const orientation = isSquare ? 'square' : 'portrait';
  return [
    `You are generating images for print-ready ${useCase}.`,
    `Target page size: ${widthInches.toFixed(2)}×${heightInches.toFixed(2)} inches at ${dpi} DPI.`,
    `Compose for ${orientation} orientation. Keep important content within safe margins; avoid placing critical details at the very edges.`,
    `Ensure clean, crisp lines and high contrast where appropriate; avoid artifacts, banding, or heavy compression.`,
    `If an inline size reference image is provided as the first image part, treat it as a CANVAS/ASPECT guide only; do not copy its content. Align composition and framing to that aspect ratio and margins.`,
    `Return the image as inline image data (PNG preferred). Do not return descriptive text unless you cannot produce an image.`,
  ].join("\n");
}

export async function describeImagesForReference(
  images: { buffer: Buffer; mimeType?: string }[]
): Promise<string> {
  if (!images || !images.length) return "";
  const parts: any[] = [];
  for (const img of images.slice(0, 2)) {
    const mimeType = img.mimeType || "image/png";
    const data = img.buffer.toString("base64");
    parts.push({ inlineData: { mimeType, data } });
  }
  parts.push({
    text: "Analyze the reference image(s). In under 40 words, describe persistent character identity and environment/style cues to keep consistent across a kids picture book. No brand names. Output a single concise sentence.",
  });

  let response: any;
  try {
    response = await ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: [{ role: "user", parts }],
    } as any);
  } catch (err: any) {
    return "";
  }

  const candidates = (response as any)?.candidates ?? [];
  const responseParts = candidates[0]?.content?.parts ?? [];
  const textPart = responseParts.find((p: any) => p?.text);
  const text = (textPart?.text || "").trim();
  return text;
}

// Instantiate client with explicit API key from env
const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

export async function generateImageFromPrompt(
  prompt: string,
  opts?: {
    previousImages?: { buffer: Buffer; mimeType?: string }[];
    previousImage?: { buffer: Buffer; mimeType?: string };
    printSpec?: PrintSpec;
  }
): Promise<GeneratedImage> {
  const requestParts: any[] = [];

  // Add previous images as inline context FIRST.
  // Keep the FIRST image (assumed size reference if provided) and the LAST TWO for continuity.
  if (opts?.previousImages && opts.previousImages.length > 0) {
    const src = opts.previousImages;
    let selected: { buffer: Buffer; mimeType?: string }[];
    if (src.length <= 3) {
      selected = src;
    } else {
      const first = src[0];
      const penultimate = src[src.length - 2];
      const last = src[src.length - 1];
      const tmp = [first, penultimate, last];
      selected = tmp.filter((v, i, a) => a.indexOf(v) === i);
    }
    for (const img of selected) {
      const mimeType = img.mimeType || "image/png";
      const data = img.buffer.toString("base64");
      requestParts.push({ inlineData: { mimeType, data } });
    }
  } else if (opts?.previousImage?.buffer) {
    const mimeType = opts.previousImage.mimeType || "image/png";
    const data = opts.previousImage.buffer.toString("base64");
    requestParts.push({ inlineData: { mimeType, data } });
  }

  // Then add the textual prompt
  requestParts.push({ text: prompt });

  let response: any;
  try {
    const systemInstruction = buildSystemInstruction(opts?.printSpec);
    response = await ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: requestParts,
        },
      ],
      systemInstruction,
      generationConfig: {
        responseMimeType: "image/png",
      },
    } as any);
  } catch (err: any) {
    const emsg = err && err.message ? err.message : String(err);
    throw new Error(
      `Gemini generateContent failed (model=${config.GEMINI_MODEL}): ${emsg}`
    );
  }

  const candidates = (response as any)?.candidates ?? [];
  if (!candidates.length) throw new Error("Gemini returned no candidates");

  const responseParts = candidates[0]?.content?.parts ?? [];
  for (const part of responseParts) {
    if (part?.inlineData?.data) {
      const imageData: string = part.inlineData.data;
      const buffer = Buffer.from(imageData, "base64");
      const mimeType: string = part.inlineData.mimeType || "image/png";
      return { buffer, mimeType };
    }
  }

  // Fallback: if text present, but no inline image data
  const textPart = responseParts.find((p: any) => p?.text);
  if (textPart?.text) {
    throw new Error(
      `Gemini returned text instead of image: ${textPart.text.substring(
        0,
        120
      )}...`
    );
  }

  throw new Error("Gemini did not return image inlineData");
}
