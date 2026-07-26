import { chatCompletionJson } from './sarvam';
import {
  buildCatalogCard,
  OUTFIT_CATEGORIES,
  FABRIC_FOLDER_SLUGS,
  findSwatch,
  findSketch,
  findBestSwatchMatch,
} from './catalog';
import { Brief, OCCASIONS, isValidOccasion, isValidOutfitType } from './brief';

export interface ExtractResult {
  patch: Partial<Brief>;
  redirect?: string | null;
}

export interface RawPatchFields {
  occasion: string | null;
  outfitType: string | null;
  fabricFolder: string | null;
  fabricFile: string | null;
  color: string | null;
  styleDetails: string | null;
  size: string | null;
  neededBy: string | null;
  sketchId: string | null;
}

interface RawExtractResponse {
  patch: RawPatchFields;
  redirect: string | null;
}

/** The `patch` sub-schema, shared between the standalone /api/extract route and the merged turn pipeline. */
export const PATCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    occasion: { type: ['string', 'null'], enum: [...OCCASIONS, null] },
    outfitType: { type: ['string', 'null'], enum: [...OUTFIT_CATEGORIES, null] },
    fabricFolder: { type: ['string', 'null'], enum: [...FABRIC_FOLDER_SLUGS, null] },
    fabricFile: { type: ['string', 'null'] },
    color: { type: ['string', 'null'] },
    styleDetails: { type: ['string', 'null'] },
    size: { type: ['string', 'null'] },
    neededBy: { type: ['string', 'null'] },
    sketchId: { type: ['string', 'null'] },
  },
  required: [
    'occasion',
    'outfitType',
    'fabricFolder',
    'fabricFile',
    'color',
    'styleDetails',
    'size',
    'neededBy',
    'sketchId',
  ],
  additionalProperties: false,
} as const;

const EXTRACT_JSON_SCHEMA = {
  name: 'brief_patch',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      patch: PATCH_JSON_SCHEMA,
      redirect: { type: ['string', 'null'] },
    },
    required: ['patch', 'redirect'],
    additionalProperties: false,
  },
} as const;

/** The extraction-instructions block shared by the standalone extract prompt and the merged turn pipeline. */
export function buildExtractionInstructions(): string {
  const catalogCard = buildCatalogCard();
  return `Brief slots:
- occasion: one of Wedding, Festive, Party, Vacation, Everyday
- outfitType: one of the 8 outfit category slugs below
- fabricFolder: one of the 9 fabric folder slugs below
- fabricFile: always leave this null — it is resolved deterministically after your response, not by you
- color: free text color description (may be in English or the user's own language, transliterated to plain English words, e.g. "मरून" -> "maroon")
- styleDetails: free text — any style/silhouette/detail preferences mentioned
- size: free text size (e.g. S, M, L, XL, or measurements)
- neededBy: free text date/deadline description
- sketchId: only fill if the user references a specific known sketch id

${catalogCard}

CRITICAL — Devanagari and code-mixed input: The user may speak in Hindi (Devanagari script), Hinglish (romanized Hindi mixed with English), Telugu, Kannada, or other Indic languages/scripts. Transliterate and map meaning to the English catalog terms above regardless of script. For example "मरून सैटिन मैक्सी ड्रेस" means "maroon satin maxi dress" -> outfitType: "maxi-dresses", fabricFolder: "satin", color: "maroon".

CRITICAL — non-western-wear requests: If the user asks for a lehenga, saree, kurta, salwar, or other ethnic wear NOT in the 8 outfit categories, do NOT set outfitType. Instead set the top-level "redirect" field to the closest western-wear equivalent category slug (e.g. lehenga -> "maxi-dresses", kurta -> "tops" or "short-dresses" depending on length implied). Leave "redirect" null when the request already fits a western-wear category or no category was mentioned at all.`;
}

function buildSystemPrompt(): string {
  return `You are the slot-extraction brain behind Diya, a voice fashion designer for DIYO, a custom women's WESTERN-WEAR studio (no lehengas, sarees, kurtas, or other ethnic-wear stitching — western wear only).

Given the user's latest transcript and the design brief slots already known, extract ONLY newly-learned slot values as a patch. Never invent values the user didn't say or imply. Leave a slot null if not mentioned in this transcript.

${buildExtractionInstructions()}

Respond with strict JSON matching the schema. No markdown, no commentary.`;
}

/**
 * Validates and sanitizes a raw LLM-produced patch: enum values are checked
 * against the real catalog, fabricFile is deterministically resolved (rather
 * than trusted from the model — see the comment below), and sketchId is
 * checked against real sketch ids. Shared between the standalone /api/extract
 * route and the merged turn pipeline (lib/turn.ts) so both apply identical
 * validation.
 */
export function sanitizePatch(raw: RawPatchFields, brief: Partial<Brief>): Partial<Brief> {
  const patch: Partial<Brief> = {};

  if (isValidOccasion(raw.occasion)) patch.occasion = raw.occasion;
  if (isValidOutfitType(raw.outfitType)) patch.outfitType = raw.outfitType;

  if (raw.fabricFolder && (FABRIC_FOLDER_SLUGS as string[]).includes(raw.fabricFolder)) {
    patch.fabricFolder = raw.fabricFolder;

    // fabricFile is only valid if it's a real folder/file pair from swatch-labels.
    if (raw.fabricFile && findSwatch(raw.fabricFolder, raw.fabricFile)) {
      patch.fabricFile = raw.fabricFile;
    }
  }

  if (raw.color) patch.color = raw.color;

  // Deterministic fabricFile fallback: the model is instructed to always leave
  // fabricFile null (listing all swatch filenames in the prompt previously blew
  // past the 4096 max_tokens ceiling on this account tier). Instead, once both
  // a fabric folder and a color are known, find the closest color-name match
  // among that folder's real swatches ourselves.
  if (!patch.fabricFile) {
    const effectiveFolder = patch.fabricFolder ?? brief.fabricFolder;
    const effectiveColor = patch.color ?? brief.color;
    if (effectiveFolder && effectiveColor) {
      const match = findBestSwatchMatch(effectiveFolder, effectiveColor);
      if (match) {
        patch.fabricFile = match.file;
        if (!patch.fabricFolder) patch.fabricFolder = effectiveFolder;
      }
    }
  }

  if (raw.styleDetails) patch.styleDetails = raw.styleDetails;
  if (raw.size) patch.size = raw.size;
  if (raw.neededBy) patch.neededBy = raw.neededBy;

  if (raw.sketchId && findSketch(raw.sketchId)) {
    patch.sketchId = raw.sketchId;
  }

  return patch;
}

export async function extractBriefPatch(transcript: string, brief: Partial<Brief>): Promise<ExtractResult> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = `Known brief so far (JSON): ${JSON.stringify(brief)}\n\nLatest user transcript: "${transcript}"`;

  const raw = await chatCompletionJson<RawExtractResponse>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    EXTRACT_JSON_SCHEMA
  );

  const patch = sanitizePatch(raw.patch, brief);
  return { patch, redirect: raw.redirect || undefined };
}
