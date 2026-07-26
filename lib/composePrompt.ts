import { chatCompletionJson } from './sarvam';
import { Brief } from './brief';
import {
  OUTFIT_CATEGORY_SINGULAR,
  getFabricFolder,
  findSwatch,
  findSketch,
  findCoordSet,
  sanitizeDisplayText,
} from './catalog';

export interface TranscriptLine {
  speaker: 'user' | 'diya';
  text: string;
}

/**
 * The only three things the LLM is allowed to contribute — short creative
 * fields, not the final prompt. A static template (buildFinalPrompt below)
 * assembles the actual Gemini prompt from hard facts (garment category,
 * exact silhouette from sketch-labels, exact fabric + color from
 * swatch-labels) plus these three fields plus a fixed rendering-rules
 * suffix. This way a full LLM failure (even after JSON salvage) can never
 * block the preview — the template still produces a complete, sensible
 * prompt with the three fields simply empty.
 */
export interface PromptFields {
  fabricRendering: string;
  silhouetteFlourish: string;
  moodStyling: string;
}

const EMPTY_PROMPT_FIELDS: PromptFields = {
  fabricRendering: '',
  silhouetteFlourish: '',
  moodStyling: '',
};

const PROMPT_FIELDS_JSON_SCHEMA = {
  name: 'prompt_fields',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      fabricRendering: { type: 'string', maxLength: 160 },
      silhouetteFlourish: { type: 'string', maxLength: 160 },
      moodStyling: { type: 'string', maxLength: 120 },
    },
    required: ['fabricRendering', 'silhouetteFlourish', 'moodStyling'],
    additionalProperties: false,
  },
} as const;

const RENDERING_RULES =
  'Render a clean, professional product-style photograph of the complete garment alone on a plain light background — no real person, no face, no model wearing it. Stay true to the described silhouette structure and the exact fabric color and texture';

/** Hard, structured facts about the matched garment — pulled directly from sketch-labels/swatch-labels/coord-set-labels, never from the LLM. */
interface HardFacts {
  garmentLabel: string;
  silhouetteDescription: string | null;
  fabricLabel: string | null;
  exactColor: string | null;
}

function gatherHardFacts(brief: Partial<Brief>): HardFacts {
  const chosenSketchId = brief.sketchId ?? brief.suggestedSketchId;
  const sketch =
    chosenSketchId && brief.outfitType && brief.outfitType !== 'coord-sets' ? findSketch(chosenSketchId) : null;
  const coordSet =
    chosenSketchId && brief.outfitType === 'coord-sets' ? findCoordSet(Number(chosenSketchId)) : null;

  const garmentLabel =
    sketch?.garment ?? (brief.outfitType ? OUTFIT_CATEGORY_SINGULAR[brief.outfitType] : 'western-wear garment');

  let silhouetteDescription: string | null = null;
  if (sketch) {
    silhouetteDescription = `${sketch.neckline}, ${sketch.sleeves}, ${sketch.length} length, ${sketch.silhouette} silhouette${
      sketch.details.length ? `, featuring ${sketch.details.join(', ')}` : ''
    }`;
  } else if (coordSet) {
    silhouetteDescription = `pairing ${sanitizeDisplayText(coordSet.top)} with ${sanitizeDisplayText(coordSet.bottom)}, ${coordSet.print} print`;
  }

  const fabricLabel = brief.fabricFolder ? (getFabricFolder(brief.fabricFolder)?.label ?? brief.fabricFolder) : null;
  const swatch = brief.fabricFolder && brief.fabricFile ? findSwatch(brief.fabricFolder, brief.fabricFile) : null;
  const exactColor = swatch?.color ?? brief.color ?? null;

  return { garmentLabel, silhouetteDescription, fabricLabel, exactColor };
}

/** The static template — hard facts + the LLM's three fields + fixed rendering rules. Never depends on the LLM succeeding. */
function buildFinalPrompt(facts: HardFacts, fields: PromptFields, brief: Partial<Brief>): string {
  const sentences: string[] = [];

  sentences.push(`A ${facts.garmentLabel}${facts.silhouetteDescription ? ` with ${facts.silhouetteDescription}` : ''}`);

  if (facts.fabricLabel || facts.exactColor) {
    sentences.push(`crafted from ${[facts.exactColor, facts.fabricLabel].filter(Boolean).join(' ')}`);
  }

  if (fields.fabricRendering) sentences.push(fields.fabricRendering);
  if (fields.silhouetteFlourish) sentences.push(fields.silhouetteFlourish);
  if (fields.moodStyling) sentences.push(fields.moodStyling);
  else if (brief.occasion) sentences.push(`Styled for a ${brief.occasion.toLowerCase()} occasion`);

  sentences.push(RENDERING_RULES);

  const prompt = sentences
    .filter(Boolean)
    .map((s) => s.trim().replace(/\.$/, ''))
    .join('. ');

  return sanitizeDisplayText(`${prompt}.`);
}

function describeHardFacts(facts: HardFacts, brief: Partial<Brief>): string {
  const lines = [
    `Garment: ${facts.garmentLabel}`,
    facts.silhouetteDescription ? `Silhouette: ${facts.silhouetteDescription}` : null,
    facts.fabricLabel ? `Fabric: ${facts.fabricLabel}` : null,
    facts.exactColor ? `Color: ${facts.exactColor}` : null,
    brief.occasion ? `Occasion: ${brief.occasion}` : null,
    brief.styleDetails ? `Conversation style notes: ${brief.styleDetails}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function describeTranscript(transcript: TranscriptLine[]): string {
  const lastLines = transcript.slice(-10);
  if (lastLines.length === 0) return '(no transcript available)';
  return lastLines.map((t) => `${t.speaker === 'user' ? 'Client' : 'Diya'}: ${t.text}`).join('\n');
}

/**
 * Asks the LLM for ONLY the three short creative fields (never the full
 * prompt). `model` defaults to sarvam-30b; SARVAM_COMPOSE_MODEL can override
 * it (e.g. to sarvam-105b) — see .env.local.
 */
async function generatePromptFields(
  facts: HardFacts,
  brief: Partial<Brief>,
  transcript: TranscriptLine[],
  model: string
): Promise<PromptFields> {
  const systemPrompt = `You help write an image-generation brief for a custom western-wear garment at DIYO, a women's fashion design studio. You do NOT write the final prompt — a code template assembles that from hard facts (exact garment type, silhouette, fabric, color) plus three short creative fields you provide.

Fields:
- fabricRendering (max 160 chars): how this fabric's color and texture should look when rendered — sheen, drape, weight, how it catches light. Specific and sensory, not generic.
- silhouetteFlourish (max 160 chars): a styling flourish or emphasis consistent with the garment's ALREADY-GIVEN silhouette/details below — describe how to render what's given, never invent new structural elements.
- moodStyling (max 120 chars): occasion-appropriate mood, lighting, and setting for the shot.

Never mention brand names, prices, delivery, ethnic wear (lehenga/saree/kurta), or any real person/model/face — this is a product-style shot of the garment alone.
Respond with strict JSON matching the schema. No markdown, no commentary.`;

  const userPrompt = `Hard facts (already fixed — do not contradict or restate structural details, just complement them):
${describeHardFacts(facts, brief)}

Recent conversation (for tone/nuance only):
${describeTranscript(transcript)}

Fill in the three fields now.`;

  const raw = await chatCompletionJson<PromptFields>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    PROMPT_FIELDS_JSON_SCHEMA,
    undefined,
    model
  );

  return {
    fabricRendering: (raw?.fabricRendering ?? '').slice(0, 160),
    silhouetteFlourish: (raw?.silhouetteFlourish ?? '').slice(0, 160),
    moodStyling: (raw?.moodStyling ?? '').slice(0, 120),
  };
}

/**
 * Builds the final Gemini image-generation prompt: hard facts (always
 * present, deterministic) + LLM-contributed creative fields (best-effort —
 * a full LLM failure falls back to empty fields rather than blocking the
 * preview) + a fixed rendering-rules suffix.
 */
export async function composeImagePrompt(
  brief: Partial<Brief>,
  transcript: TranscriptLine[]
): Promise<{ prompt: string; promptFields: PromptFields }> {
  const facts = gatherHardFacts(brief);
  const model = process.env.SARVAM_COMPOSE_MODEL || 'sarvam-30b';

  let fields: PromptFields;
  try {
    fields = await generatePromptFields(facts, brief, transcript, model);
  } catch (err) {
    console.warn('[composePrompt] LLM prompt-fields call failed, falling back to template-only prompt:', err);
    fields = { ...EMPTY_PROMPT_FIELDS };
  }

  const prompt = buildFinalPrompt(facts, fields, brief);
  return { prompt, promptFields: fields };
}

/** Exposed for direct testing/verification of the LLM fields call in isolation (e.g. trying an alternate model). Not used by the main pipeline. */
export const __internal = { generatePromptFields, gatherHardFacts, buildFinalPrompt };
