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
