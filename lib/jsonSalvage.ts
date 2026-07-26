/**
 * Repairs a JSON string truncated mid-generation by an LLM hitting its
 * max_tokens limit. Every "[sarvam] attempt N failed to parse" seen in
 * practice was cut off cleanly at a token boundary with the actual patch
 * content fully present — only trailing structure (a partial token and/or
 * the closing braces/brackets) was missing. Retrying the whole network call
 * for that is wasteful (10-40s) when the data we need is already there.
 *
 * Algorithm:
 *   1. Drop trailing lines that don't end in a character that can legally
 *      terminate a JSON value: a closing quote (`"`), a digit (end of a
 *      number), `l` (end of the `null` literal — this schema never emits
 *      booleans, only strings/null), or a closing `}`/`]`.
 *   2. Strip a resulting dangling trailing comma (the property that used to
 *      follow it was the one just dropped).
 *   3. Count unbalanced `{`/`[` outside of string literals and append the
 *      matching closers, innermost-first. If truncation happened inside an
 *      open string literal, close that string first.
 *   4. Parse the repaired string.
 *
 * Returns null if repair isn't possible or the repaired string still fails
 * to parse — callers should fall back to a network retry in that case.
 */
export function salvageTruncatedJson(raw: string): unknown | null {
  if (!raw || !raw.trim()) return null;

  const isTerminalChar = (ch: string) => ch === '"' || ch === '}' || ch === ']' || ch === 'l' || /[0-9]/.test(ch);

  const lines = raw.split('\n');

  // Drop trailing blank lines, then check the one actual last line: if it
  // doesn't end in a legal terminal character, drop THAT line (once — not
  // recursively). A line ending in `,`, `{`, or `[` is structurally fine
  // (just missing what would have come next) and must NOT be stripped, or
  // we'd cascade all the way back through every earlier complete property.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1].replace(/\s+$/, '');
    const lastChar = lastLine[lastLine.length - 1];
    if (lastChar !== undefined && !isTerminalChar(lastChar)) {
      lines.pop();
    }
  }

  if (lines.length === 0) return null;

  // The new last line may now have a dangling trailing comma (its follow-up
  // property/element was the one we just dropped).
  let text = lines.join('\n').replace(/,\s*$/, '');
  if (!text.trim()) return null;

  // Count unbalanced brackets/braces outside of string literals.
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
    } else if (ch === '}' || ch === ']') {
      stack.pop();
    }
  }

  // Truncation happened mid-string-value — close the open quote before
  // closing brackets, otherwise the repaired JSON is still invalid.
  if (inString) text += '"';

  while (stack.length > 0) {
    text += stack.pop();
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
