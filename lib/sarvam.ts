/**
 * Thin server-only wrappers around the Sarvam REST APIs. The API key never
 * leaves the server — every function here reads it from process.env and is
 * only ever called from route handlers / server-side lib code.
 *
 * Verified quirks (confirmed by live curl tests against api.sarvam.ai while
 * building this app — see the deviations note in the final report):
 *
 *   - LLM (`sarvam-30b` via /v1/chat/completions) burns a non-trivial chunk of
 *     `reasoning_content` tokens even with `reasoning_effort: "low"` (measured
 *     500-700 completion tokens on trivial prompts, ~4s). It is NOT eliminated
 *     by "low", just reduced from what "high" would cost. The fix is to give
 *     `max_tokens` enough headroom (we use 1400) so the actual JSON `content`
 *     isn't truncated (`finish_reason: "length"` with content: null) once the
 *     hidden reasoning eats its share.
 *   - TTS (`bulbul:v3`) accepts a singular `text` string field (not `inputs`
 *     array) in practice, per the task spec; confirmed working via curl.
 *     NEVER send `pitch` or `loudness` — bulbul:v3 rejects unknown TTS tuning
 *     params for v3. Female speaker chosen: "priya" (confirmed valid for
 *     bulbul:v3 by curling with a bogus speaker and reading the error's valid
 *     list, then verifying "priya" returns real audio bytes).
 *   - STT (`saaras:v3`) takes multipart `file` + `model` + `language_code`.
 *     `language_code=unknown` auto-detects; response includes `language_code`.
 */

import { salvageTruncatedJson } from './jsonSalvage';

const SARVAM_BASE = 'https://api.sarvam.ai';

function apiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error('SARVAM_API_KEY is not configured');
  return key;
}

// ---------------------------------------------------------------------------
// LLM (sarvam-30b chat completions)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface JsonSchemaSpec {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
}

/**
 * sarvam-30b's hidden `reasoning_content` length is stochastic even at
 * `reasoning_effort: "low"` — usually a few hundred tokens, but occasionally
 * it runs long enough to eat the entire max_tokens budget before any JSON
 * `content` is emitted (finish_reason: "length", content: null). 4096 is this
 * account's hard ceiling for sarvam-30b, so we can't just raise max_tokens
 * indefinitely. Instead: request near the ceiling, and retry a couple of
 * times on truncation — an over-long reasoning trace is not consistent
 * run-to-run, so a retry usually succeeds quickly.
 */
const MAX_TOKENS_CEILING = 4096;
const MAX_RETRIES_ON_TRUNCATION = 4;

export async function chatCompletionJson<T>(
  messages: ChatMessage[],
  jsonSchema: JsonSchemaSpec,
  maxTokens = MAX_TOKENS_CEILING
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES_ON_TRUNCATION; attempt++) {
    const res = await fetch(`${SARVAM_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sarvam-30b',
        reasoning_effort: 'low',
        // Lower temperature measurably shortens the hidden reasoning trace on
        // this model for complex schemas (observed truncation on the full
        // patch+say+status schema drop noticeably vs. the default ~0.7).
        temperature: 0.2,
        max_tokens: Math.min(maxTokens, MAX_TOKENS_CEILING),
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: jsonSchema,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Sarvam chat completions failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    const content: string | null = data?.choices?.[0]?.message?.content ?? null;
    const finishReason: string | undefined = data?.choices?.[0]?.finish_reason;

    if (!content) {
      lastError = new Error(
        `Sarvam chat completions returned empty content (finish_reason=${finishReason ?? 'unknown'}) — reasoning trace ran past max_tokens`
      );
      continue;
    }

    try {
      return JSON.parse(content) as T;
    } catch (err) {
      // Before burning another 10-40s on a full network retry, try to salvage
      // the truncated JSON we already have — in practice the patch content is
      // fully present and only trailing structure got cut off. See
      // lib/jsonSalvage.ts for the repair algorithm.
      const salvaged = salvageTruncatedJson(content);
      if (salvaged !== null) {
        console.warn(`[sarvam] attempt ${attempt}: JSON truncated but salvaged successfully, skipping retry`);
        return salvaged as T;
      }

      console.error(`[sarvam] attempt ${attempt} failed to parse JSON content (salvage failed too):`, JSON.stringify(content));
      lastError = err instanceof Error ? err : new Error('Failed to parse JSON content');
      continue;
    }
  }

  throw lastError ?? new Error('Sarvam chat completions failed after retries');
}

// ---------------------------------------------------------------------------
// STT (saaras:v3 speech-to-text)
// ---------------------------------------------------------------------------

export interface SttResult {
  transcript: string;
  languageCode: string;
}

export async function speechToText(file: Blob, filename: string): Promise<SttResult> {
  const form = new FormData();
  form.append('file', file, filename);
  form.append('model', 'saaras:v3');
  form.append('language_code', 'unknown');

  const res = await fetch(`${SARVAM_BASE}/speech-to-text`, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey(),
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sarvam speech-to-text failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    transcript: data.transcript ?? '',
    languageCode: data.language_code ?? 'unknown',
  };
}

// ---------------------------------------------------------------------------
// TTS (bulbul:v3 text-to-speech)
// ---------------------------------------------------------------------------

/** Female speaker confirmed compatible with bulbul:v3 (see module doc comment). */
export const TTS_SPEAKER = 'priya';

/** bulbul:v3 supports only these 11 target language codes. */
export const TTS_SUPPORTED_LANGUAGES = [
  'en-IN',
  'hi-IN',
  'bn-IN',
  'ta-IN',
  'te-IN',
  'gu-IN',
  'kn-IN',
  'ml-IN',
  'mr-IN',
  'pa-IN',
  'od-IN',
] as const;

const TTS_CHAR_LIMIT = 2500;

/** Maps an STT-detected language code (23 possible) down to a TTS-supported one. */
export function toTtsLanguageCode(detected: string | undefined | null): string {
  if (detected && (TTS_SUPPORTED_LANGUAGES as readonly string[]).includes(detected)) {
    return detected;
  }
  // Fallback: Hindi is the safest default for Hinglish/code-mixed India-market speech.
  return 'hi-IN';
}

export async function textToSpeech(text: string, targetLanguageCode: string): Promise<string> {
  const truncated = text.length > TTS_CHAR_LIMIT ? text.slice(0, TTS_CHAR_LIMIT) : text;

  const res = await fetch(`${SARVAM_BASE}/text-to-speech`, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: truncated,
      model: 'bulbul:v3',
      target_language_code: toTtsLanguageCode(targetLanguageCode),
      speaker: TTS_SPEAKER,
      // NEVER add pitch/loudness here — bulbul:v3 rejects them.
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Sarvam text-to-speech failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data?.audios?.[0] ?? '';
}
