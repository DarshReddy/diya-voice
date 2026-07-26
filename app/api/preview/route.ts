import { NextRequest, NextResponse } from 'next/server';
import { generatePreview } from '@/lib/preview';
import { TranscriptLine } from '@/lib/composePrompt';
import { Brief } from '@/lib/brief';

interface PreviewRequestBody {
  brief?: Partial<Brief>;
  transcript?: TranscriptLine[];
}

/**
 * Simple in-flight de-dup, keyed by a stable stringification of the brief:
 * identical concurrent requests (e.g. a duplicate click, or the UI's
 * auto-trigger racing a manual click) share one in-progress Gemini call
 * instead of firing duplicates. No cache beyond the lifetime of the
 * in-flight request itself — a second request for the same brief AFTER the
 * first has resolved still generates a fresh image.
 */
const inFlight = new Map<string, Promise<{ imageBase64: string; prompt: string }>>();

function briefKey(brief: Partial<Brief>): string {
  return JSON.stringify(brief, Object.keys(brief).sort());
}

export async function POST(request: NextRequest) {
  let body: PreviewRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const brief = body.brief ?? {};
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const key = briefKey(brief);

  let promise = inFlight.get(key);
  if (!promise) {
    promise = generatePreview(brief, transcript).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
  }

  try {
    const result = await promise;
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
