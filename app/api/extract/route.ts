import { NextRequest, NextResponse } from 'next/server';
import { extractBriefPatch } from '@/lib/extract';
import { keywordMatchBrief } from '@/lib/keywordMatch';
import { Brief } from '@/lib/brief';

export async function POST(request: NextRequest) {
  let body: { transcript?: string; brief?: Partial<Brief>; mode?: 'fast' | 'llm' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const transcript = body.transcript?.trim();
  if (!transcript) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
  }

  // Fast mode: pure keyword matching, no network call, <1ms — used for
  // instant chip-fill in the UI while the (still LLM-backed) default mode
  // runs in the background. See lib/keywordMatch.ts.
  if (body.mode === 'fast') {
    const patch = keywordMatchBrief(transcript);
    return NextResponse.json({ patch });
  }

  try {
    const result = await extractBriefPatch(transcript, body.brief ?? {});
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
