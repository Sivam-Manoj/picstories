import OpenAI from "openai";
import { config } from "../config/env.js";

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

type EnhancerKind = 'theme' | 'cover' | 'interior' | 'page';
type EnhancerMode = 'coloring' | 'storybook';

function buildInstructions(mode: EnhancerMode, kind: EnhancerKind = 'theme') {
  if (mode === 'storybook') {
    const base = `You are a prompt refining assistant for FULL-COLOR children's STORYBOOK illustrations. Rewrite the provided user prompt into a clearer, self-contained, high-quality image prompt.
Constraints:
- Friendly, kid-safe, imaginative.
- Preserve named characters/props; strengthen clarity, composition, and continuity cues.
- Concise (1–2 sentences). No extra commentary.`;
    const cover = `\n- Target: COVER PAGE — FULL COLOR, polished layout, portrait orientation. May mention including the title typography tastefully.`;
    const page = `\n- Target: INTERIOR PAGE — FULL COLOR illustration. Keep consistent character identity and environment vibe. Portrait orientation. Clean, readable composition.`;
    const theme = `\n- Target: THEME/PLANNING — general but vivid description suitable for planning a coherent story and consistent characters.`;
    const sel = kind === 'cover' ? cover : kind === 'page' || kind === 'interior' ? page : theme;
    return base + sel + `\nOutput only the enhanced prompt.`;
  }

  // coloring mode (default)
  const base = `You are a prompt refining assistant.
Rewrite the provided user prompt into a clearer, more specific, high-quality prompt for generating images for a kids coloring STORYBOOK.
Constraints:
- Friendly, kid-safe, imaginative.
- Preserve the user's theme and any named characters/props; improve clarity, composition, and simplicity.
- Concise (1–2 sentences). No extra commentary.`;
  const cover = `\n- Target: COVER PAGE — allow vibrant FULL COLOR design cues, polished layout, portrait orientation.`;
  const interior = `\n- Target: INTERIOR COLORING PAGE — emphasize BLACK-AND-WHITE line-art, high contrast, thick outlines, minimal background clutter, large simple shapes, portrait orientation.`;
  const theme = `\n- Target: THEME/PLANNING — keep it general yet vivid, suitable for planning a coherent story and consistent characters.`;
  const sel = kind === 'cover' ? cover : kind === 'interior' || kind === 'page' ? interior : theme;
  return base + sel + `\nOutput only the enhanced prompt.`;
}

export async function enhancePromptFor(mode: EnhancerMode, text: string, kind: EnhancerKind = 'theme'): Promise<string> {
  const response = await client.responses.create({
    model: config.OPENAI_MODEL || "gpt-5",
    reasoning: { effort: "low" },
    instructions: buildInstructions(mode, kind),
    input: text,
  } as any);
  const out = (response as any)?.output_text || "";
  if (!out || typeof out !== "string") throw new Error("Failed to enhance prompt");
  return out.trim();
}

// Backward-compatible coloring-book enhancer
export async function enhancePrompt(text: string, kind: 'theme'|'cover'|'interior' = 'theme'): Promise<string> {
  return enhancePromptFor('coloring', text, kind);
}

// Storybook-specific helper
export async function enhancePromptStorybook(text: string, kind: EnhancerKind = 'theme'): Promise<string> {
  return enhancePromptFor('storybook', text, kind);
}
