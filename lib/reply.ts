import { chatCompletionJson } from './sarvam';
import { toTtsLanguageCode } from './sarvam';
import { Brief, isBriefComplete } from './brief';
import { OUTFIT_CATEGORY_LABELS, getFabricFolder } from './catalog';

interface RawReply {
  say: string;
}

// Only "say" is asked of the model — languageCode used to also be a required
// field here, but that gave the model one more thing to reason about on top
// of an already-verbose reasoning trace, which made truncation at the 4096
// max_tokens ceiling more likely. Language is now detected deterministically
// (detectScriptLanguage below) instead.
const REPLY_JSON_SCHEMA = {
  name: 'diya_reply',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      say: { type: 'string' },
    },
    required: ['say'],
    additionalProperties: false,
  },
} as const;

/** Unicode-range based script detection, used when STT hasn't already told us the language. */
const SCRIPT_RANGES: { code: string; pattern: RegExp }[] = [
  { code: 'hi-IN', pattern: /[ऀ-ॿ]/ }, // Devanagari (Hindi, Marathi, etc.)
  { code: 'bn-IN', pattern: /[ঀ-৿]/ }, // Bengali
  { code: 'ta-IN', pattern: /[஀-௿]/ }, // Tamil
  { code: 'te-IN', pattern: /[ఀ-౿]/ }, // Telugu
  { code: 'gu-IN', pattern: /[઀-૿]/ }, // Gujarati
  { code: 'kn-IN', pattern: /[ಀ-೿]/ }, // Kannada
  { code: 'ml-IN', pattern: /[ഀ-ൿ]/ }, // Malayalam
  { code: 'pa-IN', pattern: /[਀-੿]/ }, // Gurmukhi (Punjabi)
  { code: 'od-IN', pattern: /[଀-୿]/ }, // Odia
];

/** Detects a TTS-supported language from a transcript's script. Latin script (English/Hinglish) defaults to Hindi, since code-mixed romanized Hindi is common and bulbul:v3 handles it well. */
export function detectScriptLanguage(text: string): string {
  for (const { code, pattern } of SCRIPT_RANGES) {
    if (pattern.test(text)) return code;
  }
  return 'hi-IN';
}

function missingSlotsSummary(brief: Brief): string[] {
  const missing: string[] = [];
  if (!brief.occasion) missing.push('occasion (Wedding, Festive, Party, Vacation, or Everyday)');
  if (!brief.outfitType) missing.push('outfit type (which western-wear category she wants)');
  if (!brief.fabricFolder) missing.push('fabric preference');
  if (!brief.color) missing.push('color');
  if (!brief.size) missing.push('size (optional, ask only after the core 4 are filled)');
  if (!brief.neededBy) missing.push('when she needs it by (optional, ask only after the core 4 are filled)');
  return missing;
}

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

/**
 * Composes Diya's next natural-language reply given the (already patched)
 * brief. Asks exactly one question at a time, in a warm designer tone, in
 * the user's detected/hinted language.
 *
 * If `knownLanguageCode` is passed (from STT detection), it's used directly
 * for the final TTS language. Otherwise the transcript's script is detected
 * deterministically (see detectScriptLanguage) rather than asking the LLM —
 * one less required JSON field means less reasoning overhead per call.
 */
export async function composeReply(
  transcript: string,
  brief: Brief,
  knownLanguageCode?: string
): Promise<{ say: string; languageCode: string }> {
  const complete = isBriefComplete(brief);
  const missing = missingSlotsSummary(brief);
  const languageCode = knownLanguageCode ? toTtsLanguageCode(knownLanguageCode) : detectScriptLanguage(transcript);

  const languageHint =
    languageCode === 'hi-IN'
      ? 'Reply in Hindi (Devanagari script), or Hinglish-flavored Hindi in Devanagari if the user code-mixed English words in.'
      : `Reply in the language with BCP-47 code "${languageCode}".`;

  const systemPrompt = `You are Diya, a warm and professional voice fashion designer at DIYO, a custom women's western-wear design studio (maxi dresses, short dresses, jumpsuits, skirts, tops, pants, shorts, and co-ord sets — NEVER lehengas, sarees, kurtas, or other ethnic wear).

You are mid-conversation with a client, collecting her design brief one detail at a time. ${languageHint}

Rules:
- Ask exactly ONE question at a time. Never list multiple questions.
- Keep it short — one or two sentences, like a real spoken conversation, not a form.
- Be warm and personal, like a skilled designer chatting with a client — not robotic.
- If the brief is already complete (occasion, outfit type, fabric, and color are all known), do NOT ask another question — give a short, warm confirmation summarizing her design and say you're ready to show her.
- If not complete, ask about the single most important missing detail next (priority: occasion, outfit type, fabric, color, then optionally size/needed-by).
- Never mention lehengas, sarees, kurtas, or any ethnic wear.`;

  const userPrompt = `Brief so far: ${describeBrief(brief)}.
Missing slots (in priority order): ${missing.length ? missing.join(', ') : 'none — all core slots filled'}.
Brief status: ${complete ? 'complete' : 'collecting'}.
User's latest message: "${transcript}"

Write Diya's next spoken reply now.`;

  const raw = await chatCompletionJson<RawReply>(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    REPLY_JSON_SCHEMA
  );

  return { say: raw.say, languageCode };
}
