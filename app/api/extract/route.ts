import { NextRequest, NextResponse } from 'next/server';
import { extractBriefPatch } from '@/lib/extract';
import { Brief } from '@/lib/brief';

export async function POST(request: NextRequest) {
  let body: { transcript?: string; brief?: Partial<Brief> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const transcript = body.transcript?.trim();
  if (!transcript) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
  }

  try {
    const result = await extractBriefPatch(transcript, body.brief ?? {});
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
