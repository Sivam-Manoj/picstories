import OpenAI from "openai";
import { config } from "../config/env.js";

export interface PagePlan {
  index: number;
  prompt: string;
  caption?: string;
}

export interface StorybookOut { title: string; story: string }
export async function generateStorybookText(
  title: string,
  basePrompt: string,
  length: 'short' | 'medium' | 'long' = 'short'
): Promise<StorybookOut> {
  const lengthHints =
    length === 'long' ? 'Target length ~1500–2500 words.' : length === 'medium' ? 'Target length ~700–1200 words.' : 'Target length ~300–600 words.';

  const system = `You write complete children's STORYBOOK narratives as clean markdown text (no code fences). The voice is warm, imaginative, and age-appropriate.

- Output must be a SINGLE markdown document containing a title line and the full story body.
- Include clear paragraphs and section breaks where natural. Avoid excessively long paragraphs.
- Avoid brand names, copyrighted characters, or unsafe topics.
- Keep the style consistent with a friendly, modern picture-book narrator.
- ${lengthHints}`;

  const user = `Title: ${title}\nTheme/Prompt: ${basePrompt}`;

  // Structure the output to JSON so the controller can return a stable payload
  const schema: any = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      story: { type: 'string' },
    },
    required: ['title', 'story'],
    additionalProperties: false,
  };

  const resp = await openai.responses.create({
    model: config.OPENAI_MODEL || 'gpt-5',
    reasoning: { effort: 'low' },
    instructions: system,
    input: user,
    text: {
      format: { type: 'json_schema', name: 'StorybookOut', strict: true, schema },
    },
  } as any);

  const content = (resp as any)?.output_text ?? '';
  if (!content) throw new Error('OpenAI returned empty content for storybook');
  let parsed: any;
  try { parsed = JSON.parse(content); } catch { throw new Error('Failed to parse storybook JSON'); }
  return { title: String(parsed.title || title), story: String(parsed.story || '') };
}

export interface PoemsOut { poems: Array<{ title?: string; text: string }> }
export async function generatePoemsSet(
  topic: string,
  count: number = 3,
  style?: string
): Promise<PoemsOut> {
  const clamped = Math.max(1, Math.min(10, Math.floor(count)));
  const styleLine = style ? `Style preference: ${style}.` : '';
  const system = `You write short children's poems with simple language and friendly tone.

- Return a set of ${clamped} poems in JSON.
- Keep poems wholesome and kid-safe. Avoid brand names and unsafe topics.
- ${styleLine}`;

  const user = `Topic: ${topic}`;

  const schema: any = {
    type: 'object',
    properties: {
      poems: {
        type: 'array',
        minItems: clamped,
        maxItems: clamped,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    required: ['poems'],
    additionalProperties: false,
  };

  const resp = await openai.responses.create({
    model: config.OPENAI_MODEL || 'gpt-5',
    reasoning: { effort: 'low' },
    instructions: system,
    input: user,
    text: {
      format: { type: 'json_schema', name: 'PoemsOut', strict: true, schema },
    },
  } as any);

  const content = (resp as any)?.output_text ?? '';
  if (!content) throw new Error('OpenAI returned empty content for poems');
  let parsed: any;
  try { parsed = JSON.parse(content); } catch { throw new Error('Failed to parse poems JSON'); }
  const arr = Array.isArray(parsed.poems) ? parsed.poems : [];
  return { poems: arr.map((p: any) => ({ title: p?.title ? String(p.title) : undefined, text: String(p?.text || '') })) };
}

export interface PlanResult {
  coverPagePrompt: string;
  items: PagePlan[];
}

export interface PlanOptions {
  storyMode?: boolean; // default true
  ageRange?: string; // e.g., "3-5", "6-8"
  difficulty?: "very-simple" | "simple" | "moderate"; // influences complexity of shapes
  styleHints?: string; // e.g., "friendly forest", "storybook style"
  allowCaptions?: boolean; // default true
  focusCharacters?: string; // e.g., "Luna the kitten and her nano-banana"
  avoidList?: string; // comma-separated terms to avoid in content
  referenceDescription?: string; // derived from user-provided context images (characters, environment, style cues)
}

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

function cameraComplexityHints(
  difficulty?: "very-simple" | "simple" | "moderate",
  ageRange?: string
): string {
  // Parse youngest age in a range like "3-5" or "6–8"
  let minAge: number | undefined = undefined;
  if (typeof ageRange === "string") {
    const m = ageRange.match(/(\d{1,2})\s*[–-]/);
    if (m) minAge = Number(m[1]);
  }
  const veryYoung = typeof minAge === "number" ? minAge <= 5 : false;

  if (difficulty === "very-simple" || veryYoung) {
    return `\n- COMPLEXITY TUNING:\n  - Prefer CLOSE-UP or MEDIUM-CLOSE shots; mostly eye-level, centered or simple composition.\n  - Keep backgrounds extremely minimal (very few large shapes). Avoid complex perspective.\n  - One primary character with a single, clear action; avoid crowd scenes.\n  - Emphasize large, bold outlines and big colorable areas.`;
  }
  if (difficulty === "simple") {
    return `\n- COMPLEXITY TUNING:\n  - Prefer MEDIUM shots; eye-level or slight low/high angles; use rule-of-thirds when helpful.\n  - Backgrounds remain simple with 2–3 large environment elements that may evolve across pages.\n  - Typically 1–2 characters; avoid tiny details and busy textures.`;
  }
  // moderate or unspecified
  return `\n- COMPLEXITY TUNING:\n  - Mix MEDIUM and occasional WIDE shots; use rule-of-thirds; sparing low/high angles for drama.\n  - Backgrounds can show clear environmental change but remain uncluttered and readable.\n  - 1–3 characters max per page; keep key identity props consistent; avoid micro details.`;
}

export async function generatePagePrompts(
  title: string,
  basePrompt: string,
  pageCount: number,
  options?: PlanOptions
): Promise<PlanResult> {
  const storyMode = options?.storyMode !== false; // default true
  const ageRange = options?.ageRange
    ? `Target age range: ${options.ageRange}.`
    : "";
  const difficultyLine = options?.difficulty
    ? options.difficulty === "very-simple"
      ? "Use extremely simple outlines and very large shapes suitable for preschoolers."
      : options.difficulty === "simple"
      ? "Use simple outlines and large shapes suitable for young kids."
      : "Use moderately simple outlines and clear shapes suitable for older kids."
    : "";
  const styleHints = options?.styleHints
    ? `Style hints: ${options.styleHints}.`
    : "";
  const referenceLine = options?.referenceDescription ? `Reference cues from user images: ${options.referenceDescription}` : "";
  const captionsLine =
    options?.allowCaptions === false
      ? 'Set "caption": null for each interior item.'
      : 'You may include a very short caption (3–7 words); if not needed, set "caption": null.';
  const focusChars = options?.focusCharacters
    ? `Main characters/props: ${options.focusCharacters}.`
    : "";
  const avoid = options?.avoidList ? `Avoid: ${options.avoidList}.` : "";
  const tuningHints = cameraComplexityHints(options?.difficulty, options?.ageRange);

  const system = `You are the planning engine for a kids coloring STORYBOOK. Produce a complete visual plan as STRICT JSON.

- SYSTEM CONTEXT:
  - Your output will be consumed by an image generator that renders pages sequentially.
  - For EACH interior page, only that page's prompt is sent to the image model, plus up to the last TWO generated images as visual context.
  - Therefore, EACH interior page prompt must be SELF-CONTAINED and repeat essential identity/style cues (e.g., character species/name, signature clothing/props, environment vibe) so visual consistency is maintained.
  - Cover page is rendered separately in FULL COLOR using "coverPagePrompt"; interior pages are rendered in BLACK-and-WHITE line art.
  - The image generator is invoked INDEX-BY-INDEX (cover first, then 1..${pageCount}). Write each prompt as a clear, production-ready IMAGE GENERATION PROMPT that can be used directly without additional rewriting.
  - Do NOT write meta commentary or instructions to humans. Write concrete visual directives only.
  - Ensure strong sequence/continuity across pages: the story should progress meaningfully while preserving consistent character identity, scale, props, and setting vibe.

- INTERIOR PAGE PROMPT REQUIREMENTS (very important):
  - Describe SUBJECT + ACTION succinctly.
  - Specify CAMERA framing and VIEWPOINT: choose one (close-up / medium / wide) and one viewpoint (eye-level / low-angle / high-angle), and mention composition/framing (rule-of-thirds vs centered).
  - Specify CHARACTER DIRECTION and POSE explicitly (e.g., "facing left and walking toward the forest", "profile view to the right", "looking up and waving").
  - Include a concise BACKGROUND/ENVIRONMENT that EVOLVES across pages (e.g., forest clearing → riverside → village gate), yet remains simple and uncluttered for coloring.
  - Add a one-sentence CONTINUITY CUE in each prompt (e.g., "the same kitten with a tiny ribbon and nano-banana").
  - Maintain consistent SCALE and relative positions; keep the main character prominent.
  - Strict line-art constraints: BLACK-and-WHITE only, thick outlines, high contrast, no shading, minimal background detail, no text overlays.

- OUTPUT FORMAT (STRICT JSON, no extra keys, no comments, no markdown):
 ${tuningHints}

 - OUTPUT FORMAT (STRICT JSON, no extra keys, no comments, no markdown):
  {
    "coverPagePrompt": "string",
    "items": [ { "index": 1, "prompt": "string", "caption": "string or null" }, ... ]
  }

- COVER PAGE (FULL COLOR):
  - Create a vibrant, attractive, polished front-cover design (NOT a coloring page).
  - Must include the exact title text: "${title}" in the design (e.g., nice typography). No placeholders.
  - Colorful, appealing to kids, portrait orientation, clean composition.
  - Avoid line-art constraints on the cover; use rich, saturated colors.

- INTERIOR PAGES (BLACK-AND-WHITE LINE-ART):
  - Provide exactly ${pageCount} items in the "items" array, indexed 1..${pageCount}.
  - Each "prompt" describes ONE coloring page in simple, high-contrast line-art (BLACK and WHITE only), thick outlines, no shading, minimal background clutter, large simple shapes.
  - ${storyMode ? "Make the pages read like a sequential story with small, meaningful progression from page to page." : "Pages may be independent but remain thematically coherent."}
  - Maintain character/object consistency across pages (same species/character, key props, overall style, scale).
  - Do NOT mention colors in interior prompts; they are for coloring. Avoid text overlays or paragraph text inside the illustration.
  - EACH interior prompt must restate key identity/style cues in 1 short sentence to help maintain continuity.
  - Keep child-safe, friendly tone; avoid violence, brand names, logos, copyrighted characters.
  - Orientation: portrait.
  - Each prompt must be concise (1–3 sentences), self-contained, and not reference the entire book or other page text.
  - ${captionsLine}

- THEMATIC COHERENCE:
  - Use the provided theme faithfully (e.g., "friendly forest", "jungle adventure").
  - Reflect any style hints in the theme while remaining suitable for coloring.
  - If the user hints at "storybook" or provides a style phrase (e.g., "friendly forest"), ensure the sequence forms a beginning → middle → end progression consistent with that style.

- EXTRA GUIDANCE:
  ${ageRange}
  ${difficultyLine}
  ${styleHints}
  ${focusChars}
  ${avoid}
  ${referenceLine}
  ${tuningHints}

- EXAMPLE (FORMAT ONLY — do NOT copy text; adapt to user inputs; ensure items length = ${pageCount}):
  {
    "coverPagePrompt": "A vibrant, polished cover design that includes the exact title text \"${title}\" in nice typography; colorful, kid-friendly, portrait orientation.",
    "items": [
      { "index": 1, "prompt": "Black-and-white line-art: [main character doing X in simple scene], thick outlines, high contrast, minimal background; restate key identity cues for continuity.", "caption": "optional 3–7 words" },
      { "index": 2, "prompt": "Black-and-white line-art: next step in the story with the same character/props; thick outlines; minimal background.", "caption": null }
    ]
  }

- IMPORTANT: Output MUST be valid JSON only. Do not include explanations, backticks, or extra commentary.`;

  const user = `Title: ${title}\nBase prompt/theme: ${basePrompt}\nPages (interior): ${pageCount}`;

  // Strict JSON schema for our expected structure
  const schema: any = {
    type: "object",
    properties: {
      coverPagePrompt: { type: "string", minLength: 1 },
      items: {
        type: "array",
        minItems: pageCount,
        maxItems: pageCount,
        items: {
          type: "object",
          properties: {
            index: { type: "integer", minimum: 1, maximum: pageCount },
            prompt: { type: "string", minLength: 1 },
            caption: { type: ["string", "null"] },
          },
          required: ["index", "prompt", "caption"],
          additionalProperties: false,
        },
      },
    },
    required: ["coverPagePrompt", "items"],
    additionalProperties: false,
  };

  const resp = await openai.responses.create({
    model: config.OPENAI_MODEL || "gpt-5",
    reasoning: { effort: "low" },
    instructions: system,
    input: user,
    text: {
      format: {
        type: "json_schema",
        name: "ColoringBookPlan",
        strict: true,
        schema,
      },
    },
  } as any);

  const content = (resp as any)?.output_text ?? "";
  if (!content) {
    throw new Error("OpenAI returned empty content for page prompts");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error("Failed to parse OpenAI JSON response");
  }

  const coverPagePrompt: string =
    typeof parsed.coverPagePrompt === "string" ? parsed.coverPagePrompt : "";
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  if (!coverPagePrompt) {
    throw new Error("Missing coverPagePrompt in OpenAI response");
  }
  if (items.length !== pageCount) {
    throw new Error(
      `Expected ${pageCount} interior page prompts, got ${items.length}`
    );
  }

  const plans: PagePlan[] = items.map((it: any, idx: number) => ({
    index: Number(it.index ?? idx + 1),
    prompt: String(it.prompt ?? ""),
    caption: it.caption ? String(it.caption) : undefined,
  }));

  return { coverPagePrompt, items: plans };
}

export async function generateStoryImagePrompts(
  title: string,
  basePrompt: string,
  pageCount: number,
  options?: PlanOptions
): Promise<PlanResult> {
  const storyMode = options?.storyMode !== false;
  const ageRange = options?.ageRange ? `Target age range: ${options.ageRange}.` : '';
  const styleHints = options?.styleHints ? `Style hints: ${options.styleHints}.` : '';
  const referenceLine = options?.referenceDescription ? `Reference cues from user images: ${options.referenceDescription}` : '';
  const focusChars = options?.focusCharacters ? `Main characters/props: ${options.focusCharacters}.` : '';
  const avoid = options?.avoidList ? `Avoid: ${options.avoidList}.` : '';

  const system = `You plan a FULL-COLOR children's STORYBOOK as STRICT JSON for an image generator.

- SYSTEM CONTEXT:
  - Pages are rendered sequentially (cover, then 1..${pageCount}).
  - The image model receives only the current page prompt plus up to the last TWO generated images as visual context.
  - Therefore EACH interior prompt must be SELF-CONTAINED and restate essential identity/style cues (main character name/species, signature clothing/props, environment vibe) for visual continuity.

- COVER + INTERIOR PAGES:
  - All pages are FULL COLOR, kid-friendly, portrait orientation.
  - Write direct IMAGE GENERATION PROMPTS only. No meta commentary or human instructions.
  - Ensure strong sequence/continuity across pages; the story should progress meaningfully while preserving consistent character identity, scale, props, and setting vibe.

- PER-PAGE PROMPT REQUIREMENTS (very important):
  - SUBJECT + ACTION succinctly.
  - CAMERA framing + VIEWPOINT: pick one (close-up / medium / wide) and one viewpoint (eye-level / low-angle / high-angle); mention composition (rule-of-thirds vs centered).
  - CHARACTER DIRECTION + POSE explicitly (e.g., "facing left and running toward the river", "profile view to the right", "looking up and waving").
  - BACKGROUND/ENVIRONMENT: include concise details that EVOLVE across pages (e.g., forest path → rickety bridge → cozy village) while staying readable and uncluttered.
  - CONTINUITY CUE: add one short clause that restates identity/style props (e.g., "the same kitten with the tiny ribbon and nano-banana").
  - Maintain consistent SCALE and relative positions; keep the main character prominent and readable.
  - Avoid heavy text overlays; keep composition clear, with safe margins.

OUTPUT JSON ONLY (STRICT, no extra keys/comments/markdown):
{
  "coverPagePrompt": "string",
  "items": [ { "index": 1, "prompt": "string", "caption": null }, ... ]
}`;

  const user = `Title: ${title}\nTheme: ${basePrompt}\nPages: ${pageCount}\n${ageRange}\n${styleHints}\n${focusChars}\n${avoid}`;
  const instructions = system + (referenceLine ? `\n\n${referenceLine}` : '');

  const schema: any = {
    type: 'object',
    properties: {
      coverPagePrompt: { type: 'string', minLength: 1 },
      items: {
        type: 'array',
        minItems: pageCount,
        maxItems: pageCount,
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', minimum: 1, maximum: pageCount },
            prompt: { type: 'string', minLength: 1 },
            caption: { type: ['string', 'null'] },
          },
          required: ['index', 'prompt', 'caption'],
          additionalProperties: false,
        },
      },
    },
    required: ['coverPagePrompt', 'items'],
    additionalProperties: false,
  };

  const resp = await openai.responses.create({
    model: config.OPENAI_MODEL || 'gpt-5',
    reasoning: { effort: 'low' },
    instructions: instructions,
    input: user,
    text: { format: { type: 'json_schema', name: 'StoryImagePlan', strict: true, schema } },
  } as any);

  const content = (resp as any)?.output_text ?? '';
  if (!content) throw new Error('OpenAI returned empty content for story image plan');
  let parsed: any; try { parsed = JSON.parse(content); } catch { throw new Error('Failed to parse story image plan JSON'); }
  const coverPagePrompt: string = typeof parsed.coverPagePrompt === 'string' ? parsed.coverPagePrompt : '';
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  if (!coverPagePrompt) throw new Error('Missing coverPagePrompt');
  if (items.length !== pageCount) throw new Error(`Expected ${pageCount} items, got ${items.length}`);
  const plans: PagePlan[] = items.map((it: any, idx: number) => ({ index: Number(it.index ?? idx + 1), prompt: String(it.prompt ?? ''), caption: it.caption ? String(it.caption) : undefined }));
  return { coverPagePrompt, items: plans };
}

export async function generatePoemsImagePrompts(
  title: string,
  topic: string,
  count: number,
  style?: string
): Promise<PlanResult> {
  const clamped = Math.max(1, Math.min(30, Math.floor(count)));
  const styleHints = style ? `Style hints: ${style}.` : '';
  const system = `You plan FULL-COLOR illustration prompts for a children's POEM COLLECTION as STRICT JSON.

- Provide a cover prompt and ${clamped} interior prompts.
- Cover and interiors are FULL COLOR, friendly, portrait orientation.
- Each interior prompt should visualize the poem's vibe from the topic; keep prompts self-contained with consistent style cues.
OUTPUT JSON ONLY.`;

  const user = `Collection title: ${title}\nPoem topic: ${topic}\nCount: ${clamped}\n${styleHints}`;

  const schema: any = {
    type: 'object',
    properties: {
      coverPagePrompt: { type: 'string', minLength: 1 },
      items: {
        type: 'array',
        minItems: clamped,
        maxItems: clamped,
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', minimum: 1, maximum: clamped },
            prompt: { type: 'string', minLength: 1 },
            caption: { type: ['string', 'null'] },
          },
          required: ['index', 'prompt', 'caption'],
          additionalProperties: false,
        },
      },
    },
    required: ['coverPagePrompt', 'items'],
    additionalProperties: false,
  };

  const resp = await openai.responses.create({
    model: config.OPENAI_MODEL || 'gpt-5',
    reasoning: { effort: 'low' },
    instructions: system,
    input: user,
    text: { format: { type: 'json_schema', name: 'PoemsImagePlan', strict: true, schema } },
  } as any);

  const content = (resp as any)?.output_text ?? '';
  if (!content) throw new Error('OpenAI returned empty content for poems image plan');
  let parsed: any; try { parsed = JSON.parse(content); } catch { throw new Error('Failed to parse poems image plan JSON'); }
  const coverPagePrompt: string = typeof parsed.coverPagePrompt === 'string' ? parsed.coverPagePrompt : '';
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  if (!coverPagePrompt) throw new Error('Missing coverPagePrompt');
  if (items.length !== clamped) throw new Error(`Expected ${clamped} items, got ${items.length}`);
  const plans: PagePlan[] = items.map((it: any, idx: number) => ({ index: Number(it.index ?? idx + 1), prompt: String(it.prompt ?? ''), caption: it.caption ? String(it.caption) : undefined }));
  return { coverPagePrompt, items: plans };
}
