import { chatCompletionJson } from './sarvam';
import { PATCH_JSON_SCHEMA, buildExtractionInstructions, sanitizePatch, RawPatchFields } from './extract';
import { Brief, EMPTY_BRIEF, isBriefComplete, mergeBrief } from './brief';
import { OUTFIT_CATEGORY_LABELS, getFabricFolder } from './catalog';

export interface TurnResult {
  patch: Partial<Brief>;
  redirect?: string;
  say: string;
  status: 'collecting' | 'complete';
}

interface RawTurnResponse {
  patch: RawPatchFields;
  redirect: string | null;
  say: string;
  status: 'collecting' | 'complete';
}

/**
 * A SINGLE combined JSON schema for slot extraction + Diya's spoken reply.
 *
 * Originally this was two sequential sarvam-30b calls (extractBriefPatch then
 * composeReply), which meant two full reasoning traces per turn — the
 * dominant cost of the ~45-90s turn latency. Merging them into one call
 * roughly halves the number of reasoning traces per turn while producing the
 * same information, since the model can extract slots and write a reply
 * about "what's still missing" in a single pass.
 */
const TURN_JSON_SCHEMA = {
  name: 'diya_turn',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      patch: PATCH_JSON_SCHEMA,
      redirect: { type: ['string', 'null'] },
      say: { type: 'string' },
      status: { type: 'string', enum: ['collecting', 'complete'] },
    },
    required: ['patch', 'redirect', 'say', 'status'],
    additionalProperties: false,
  },
} as const;

function describeBrief(brief: Brief): string {
  const parts: string[] = [];
  if (brief.occasion) parts.push(`occasion: ${brief.occasion}`);
  if (brief.outfitType) parts.push(`outfit type: ${OUTFIT_CATEGORY_LABELS[brief.outfitType]}`);
  if (brief.fabricFolder) parts.push(`fabric: ${getFabricFolder(brief.fabricFolder)?.label ?? brief.fabricFolder}`);
  if (brief.color) parts.push(`color: ${brief.color}`);
  if (brief.styleDetails) parts.push(`style details: ${brief.styleDetails}`);
  if (brief.size) parts.push(`size: ${brief.size}`);
  if (brief.neededBy) parts.push(`needed by: ${brief.neededBy}`);
  return parts.length ? parts.join('; ') : 'nothing yet';
}

function describeKeywordHint(patch: Partial<Brief>): string {
  const parts = Object.entries(patch)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join(', ') : 'none';
}

function buildSystemPrompt(languageCode: string): string {
  const languageHint =
    languageCode === 'hi-IN'
      ? 'Reply in Hindi (Devanagari script), or Hinglish-flavored Hindi in Devanagari if the user code-mixed English words in.'
      : `Reply in the language with BCP-47 code "${languageCode}".`;

  return `You are Diya, a warm and professional voice fashion designer at DIYO, a custom women's WESTERN-WEAR design studio (maxi dresses, short dresses, jumpsuits, skirts, tops, pants, shorts, and co-ord sets — NEVER lehengas, sarees, kurtas, or other ethnic wear).

You do TWO things in a single pass for each user turn:
1. Extract newly-learned design-brief slot values from the transcript (a patch — leave a slot null if not mentioned).
2. Write your next short spoken reply as Diya, continuing the conversation.

${buildExtractionInstructions()}

Reply-writing rules — ${languageHint}
- Ask exactly ONE question at a time. Never list multiple questions.
- Keep it short — one or two sentences, like a real spoken conversation, not a form.
- Be warm and personal, like a skilled designer chatting with a client — not robotic.
- If, AFTER your patch is applied on top of the known brief, occasion + outfit type + fabric + color are ALL filled, do NOT ask another question — give a short, warm confirmation summarizing her design and say you're ready to show her. Set status to "complete" in that case.
- Otherwise ask about the single most important missing detail next (priority: occasion, outfit type, fabric, color, then optionally size/needed-by), and set status to "collecting".
- Never mention lehengas, sarees, kurtas, or any ethnic wear.

Respond with strict JSON matching the schema: {patch, redirect, say, status}. No markdown, no commentary.`;
}

/**
 * Runs the merged extract+reply sarvam-30b call. `keywordPatch` (from the
 * instant deterministic lib/keywordMatch.ts pre-matcher) is passed in as a
 * hint so the model has less work to do — it can confirm/override a likely
 * slot instead of extracting from scratch, which shortens its reasoning
 * trace and makes output more consistent.
 */
export async function runTurnPipeline(
  transcript: string,
  brief: Partial<Brief>,
  languageCode: string,
  keywordPatch: Partial<Brief>
): Promise<TurnResult> {
  const systemPrompt = buildSystemPrompt(languageCode);
  const userPrompt = `Known brief so far (JSON): ${JSON.stringify(brief)}
Likely slots already detected by fast keyword matching (use as a strong hint — confirm or override if the transcript clearly says otherwise): ${describeKeywordHint(keywordPatch)}
Brief so far (readable): ${describeBrief(mergeBrief(EMPTY_BRIEF, brief))}
Latest user transcript: "${transcript}"

Extract the patch and write your reply now.`;

  const raw = await chatCompletionJson<RawTurnResponse>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    TURN_JSON_SCHEMA
  );

  const patch = sanitizePatch(raw.patch, brief);

  // Computed deterministically from the actual merged brief rather than
  // trusted from the model's self-reported status — belt and suspenders,
  // since the model's boolean claim about completeness is not guaranteed to
  // agree with the slots it actually filled.
  const mergedBrief = mergeBrief(mergeBrief(EMPTY_BRIEF, brief), patch);
  const status = isBriefComplete(mergedBrief) ? 'complete' : 'collecting';

  return { patch, redirect: raw.redirect || undefined, say: raw.say, status };
}
