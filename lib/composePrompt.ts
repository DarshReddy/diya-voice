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

/**
 * Per-category output-scope rules, ported from diyo-app's battle-tested
 * promptBuilder (outfit-only flow) — they stop the model from inventing
 * extra garments, and give tops/bottoms an understated black placeholder
 * counterpart so the hero garment stays the focus.
 */
function buildGarmentScope(outfitType: string | null | undefined): string[] {
  switch (outfitType) {
    case 'maxi-dresses':
    case 'short-dresses':
      return ['Output scope: single dress garment only. Do not add separate tops, bottoms, jackets, or unrelated layers.'];
    case 'jumpsuits':
      return ['Output scope: jumpsuit only. Do not split into separate top and bottom garments or add jackets.'];
    case 'coord-sets':
      return ['Output scope: matching co-ord set only. Do not add unrelated extra garments or random layering pieces.'];
    case 'tops':
      return [
        'Output scope: top only. Do not generate skirts, pants, shorts, jackets, or layered lower garments.',
        'If a lower garment is needed for completeness, use only a simple plain black fitted bottom as a placeholder — understated, so the selected top remains the clear focus.',
      ];
    case 'skirts':
      return [
        'Output scope: skirt only. Do not generate tops, pants, shorts, dresses, or layered upper garments.',
        'If an upper garment is needed for completeness, use only a simple plain black fitted top as a placeholder — no prints, logos, or embellishments.',
      ];
    case 'pants':
      return [
        'Output scope: pants only. Do not generate tops, skirts, shorts, dresses, or layered upper garments.',
        'If an upper garment is needed for completeness, use only a simple plain black fitted top as a placeholder — no prints, logos, or embellishments.',
      ];
    case 'shorts':
      return [
        'Output scope: shorts only. Do not generate tops, skirts, pants, dresses, or layered upper garments.',
        'If an upper garment is needed for completeness, use only a simple plain black fitted top as a placeholder — no prints, logos, or embellishments.',
      ];
    default:
      return ['Garment scope: generate only one coherent garment and avoid adding extra clothing items.'];
  }
}

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

/**
 * The static template — hard facts + the LLM's three fields, assembled in
 * the magazine-editorial-flatlay structure ported from diyo-app's
 * promptBuilder outfit-only flow (which reliably produces realistic,
 * magazine-style product shots). Never depends on the LLM succeeding.
 */
function buildFinalPrompt(facts: HardFacts, fields: PromptFields, brief: Partial<Brief>): string {
  const hasSketchImage = Boolean((brief.sketchId ?? brief.suggestedSketchId) && brief.outfitType);
  const hasSwatchImage = Boolean(brief.fabricFolder && brief.fabricFile);
  const fabricMeta = brief.fabricFolder ? getFabricFolder(brief.fabricFolder) : null;

  const fabricLine = [facts.exactColor, facts.fabricLabel].filter(Boolean).join(' ');

  const parts: (string | null)[] = [
    'Create a high-quality photorealistic editorial flatlay of the garment. No mannequin, no model, no body.',
    'Output must look like a real DSLR fashion studio photograph — not an illustration, sketch, 3D render, or CGI.',
    'Use realistic fabric micro-wrinkles, natural shadow gradients, and accurate textile surface depth.',
    `The garment: a ${facts.garmentLabel}${facts.silhouetteDescription ? ` with ${facts.silhouetteDescription}` : ''}.`,
    hasSketchImage
      ? 'Shape source: the GARMENT SKETCH guides construction only — shape, seam flow, cut lines, and proportions. Render it as a fully photorealistic garment with no line-art edges, flat fills, or drawn-line appearance.'
      : null,
    fabricLine ? `Fabric: ${fabricLine}${fabricMeta ? ` — ${fabricMeta.promptDescriptor}` : ''}.` : null,
    hasSwatchImage
      ? 'COLOUR AND TEXTURE RULE: the FABRIC SWATCH is the only permitted colour, print, and texture source for the garment. Apply it faithfully across the whole garment surface, and do not derive colour from any other image.'
      : facts.exactColor
        ? `Maintain the exact ${facts.exactColor} garment colour throughout.`
        : null,
    fields.fabricRendering || null,
    fields.silhouetteFlourish || null,
    ...buildGarmentScope(brief.outfitType),
    'Lay the garment flat on a clean softly-lit surface (white marble, linen, or muted pastel paper).',
    'Style with a small number of complementary accessories (jewellery, a bag, footwear) — the garment is the clear hero.',
    fields.moodStyling || (brief.occasion ? `Mood: styled for a ${brief.occasion.toLowerCase()} occasion.` : null),
    'Magazine-worthy composition with intentional overlaps and soft even studio lighting. Aspect ratio 3:4, no text or watermarks.',
    'Commercially usable fashion output with clean stitching and realistic fabric construction.',
  ];

  const prompt = parts
    .filter((p): p is string => Boolean(p))
    .map((s) => s.trim().replace(/\.?$/, '.'))
    .join(' ');

  return sanitizeDisplayText(prompt);
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
/**
 * Hard wall-clock budget for the LLM flourish fields. sarvam-30b's hidden
 * reasoning is stochastic — with salvage retries a single fields call was
 * observed taking 2m+ end-to-end, which is unusable while a customer stares
 * at "bringing your design to life…". Past the deadline we proceed with the
 * template-only prompt (fully factual, verified to render well) and let the
 * LLM call die in the background. COMPOSE_FIELDS=off skips the LLM entirely.
 */
const COMPOSE_FIELDS_TIMEOUT_MS = Number(process.env.COMPOSE_FIELDS_TIMEOUT_MS || 15000);

export async function composeImagePrompt(
  brief: Partial<Brief>,
  transcript: TranscriptLine[]
): Promise<{ prompt: string; promptFields: PromptFields }> {
  const facts = gatherHardFacts(brief);
  const model = process.env.SARVAM_COMPOSE_MODEL || 'sarvam-30b';

  let fields: PromptFields = { ...EMPTY_PROMPT_FIELDS };
  if (process.env.COMPOSE_FIELDS !== 'off') {
    try {
      const deadline = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), COMPOSE_FIELDS_TIMEOUT_MS)
      );
      const result = await Promise.race([
        generatePromptFields(facts, brief, transcript, model),
        deadline,
      ]);
      if (result) {
        fields = result;
      } else {
        console.warn(
          `[composePrompt] LLM prompt-fields call exceeded ${COMPOSE_FIELDS_TIMEOUT_MS}ms — using template-only prompt`
        );
      }
    } catch (err) {
      console.warn('[composePrompt] LLM prompt-fields call failed, falling back to template-only prompt:', err);
    }
  }

  const prompt = buildFinalPrompt(facts, fields, brief);
  return { prompt, promptFields: fields };
}

/** Exposed for direct testing/verification of the LLM fields call in isolation (e.g. trying an alternate model). Not used by the main pipeline. */
export const __internal = { generatePromptFields, gatherHardFacts, buildFinalPrompt };
