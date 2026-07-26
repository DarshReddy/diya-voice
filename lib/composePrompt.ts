import { chatCompletionJson } from './sarvam';
import { Brief } from './brief';
import {
  OUTFIT_CATEGORY_LABELS,
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

interface RawComposePromptResponse {
  prompt: string;
}

const COMPOSE_PROMPT_JSON_SCHEMA = {
  name: 'compose_prompt',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
} as const;

/** Fallback used if JSON salvage recovers a response missing `prompt` entirely (rare). */
function fallbackPrompt(brief: Partial<Brief>): string {
  const parts = [
    brief.color,
    brief.fabricFolder ? getFabricFolder(brief.fabricFolder)?.label : undefined,
    brief.outfitType ? OUTFIT_CATEGORY_LABELS[brief.outfitType] : 'western-wear outfit',
  ].filter(Boolean);
  return `A ${parts.join(' ')} for a ${brief.occasion ?? 'special'} occasion.`;
}

/** Builds a structured description of the matched garment (sketch/coord-set + fabric) for the compose prompt. */
function describeGarment(brief: Partial<Brief>): string {
  const lines: string[] = [];

  if (brief.outfitType) {
    lines.push(`Garment category: ${OUTFIT_CATEGORY_LABELS[brief.outfitType]}.`);
  }

  const chosenSketchId = brief.sketchId ?? brief.suggestedSketchId;
  if (chosenSketchId && brief.outfitType && brief.outfitType !== 'coord-sets') {
    const sketch = findSketch(chosenSketchId);
    if (sketch) {
      lines.push(
        `Silhouette reference: ${sanitizeDisplayText(sketch.suggestedName)} — neckline: ${sketch.neckline}; sleeves: ${sketch.sleeves}; length: ${sketch.length}; silhouette: ${sketch.silhouette}; waist: ${sketch.waist}; back: ${sketch.back}; details: ${sketch.details.join(', ')}.`
      );
    }
  } else if (brief.outfitType === 'coord-sets' && chosenSketchId) {
    const coordSet = findCoordSet(Number(chosenSketchId));
    if (coordSet) {
      lines.push(
        `Co-ord set reference: ${sanitizeDisplayText(coordSet.top)} paired with ${sanitizeDisplayText(coordSet.bottom)}; print: ${coordSet.print}; vibe: ${coordSet.vibe}.`
      );
    }
  }

  if (brief.fabricFolder) {
    const folder = getFabricFolder(brief.fabricFolder);
    const swatch = brief.fabricFile ? findSwatch(brief.fabricFolder, brief.fabricFile) : null;
    lines.push(
      `Fabric: ${folder?.promptDescriptor ?? brief.fabricFolder}${swatch?.pattern ? ` — pattern: ${swatch.pattern}` : ''}.`
    );
  }

  if (brief.color) lines.push(`Color: ${brief.color}.`);
  if (brief.styleDetails) lines.push(`Style notes from the conversation: ${brief.styleDetails}.`);
  if (brief.occasion) lines.push(`Occasion mood: ${brief.occasion}.`);
  if (brief.size) lines.push(`Size: ${brief.size}.`);

  return lines.join('\n');
}

function describeTranscript(transcript: TranscriptLine[]): string {
  const lastLines = transcript.slice(-10);
  if (lastLines.length === 0) return '(no transcript available)';
  return lastLines.map((t) => `${t.speaker === 'user' ? 'Client' : 'Diya'}: ${t.text}`).join('\n');
}

/**
 * Composes a rich, single-paragraph English image-generation prompt
 * describing the garment — the only place sarvam-30b is still called from
 * the live-call (Plan A) flow, once at the end of a conversation rather than
 * per utterance. Feeds a downstream image-generation step (Gemini compose,
 * added later) with a structured natural-language description assembled
 * from the matched sketch/coord-set details, fabric family + color, and
 * occasion mood, plus the tail of the conversation for extra nuance.
 */
export async function composeImagePrompt(
  brief: Partial<Brief>,
  transcript: TranscriptLine[]
): Promise<{ prompt: string }> {
  const garmentDescription = describeGarment(brief);
  const transcriptDescription = describeTranscript(transcript);

  const systemPrompt = `You write a single, rich, English-language image-generation prompt describing a custom western-wear garment for DIYO, a women's fashion design studio. The prompt will be fed directly into an image generator, so it must be vivid, concrete, and self-contained — a fashion photograph brief in one paragraph.

Rules:
- Output ONE paragraph, 2-4 sentences, no line breaks, no bullet points, no markdown.
- Describe: the garment category and silhouette (neckline, sleeves, length, details), the fabric (material feel/texture + exact color), and the overall mood/occasion.
- Write as a photography/illustration brief — e.g. "A flowing maxi dress in deep wine-maroon lustrous satin, featuring a V-neckline and flutter sleeves with a pleated skirt, styled for an elegant evening wedding look, softly lit studio photograph."
- Never mention brand names, prices, or delivery. Describe fit/construction with words like "structured", "fitted", or "custom-designed" only.
- Never mention lehengas, sarees, kurtas, or other ethnic wear — DIYO is western-wear only.
- If some details are missing, write a plausible, tasteful default rather than leaving gaps or hedging ("possibly", "maybe") — commit to a concrete description.`;

  const userPrompt = `Structured design brief:
${garmentDescription || '(brief is mostly empty — infer a tasteful default western-wear look)'}

Recent conversation (for tone/nuance only):
${transcriptDescription}

Write the single-paragraph image-generation prompt now.`;

  const raw = await chatCompletionJson<RawComposePromptResponse>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    COMPOSE_PROMPT_JSON_SCHEMA
  );

  // Belt-and-suspenders: launder the model's free-text output through the
  // same sanitizer used for copied catalog data, regardless of how well it
  // followed the system prompt's fit/construction wording rule above.
  return { prompt: sanitizeDisplayText(raw?.prompt || fallbackPrompt(brief)) };
}
