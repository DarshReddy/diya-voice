import { NextRequest, NextResponse } from 'next/server';
import { composeImagePrompt, TranscriptLine } from '@/lib/composePrompt';
import { Brief } from '@/lib/brief';

interface ComposePromptRequestBody {
  brief?: Partial<Brief>;
  transcript?: TranscriptLine[];
}

export async function POST(request: NextRequest) {
  let body: ComposePromptRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const brief = body.brief ?? {};
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];

  try {
    const result = await composeImagePrompt(brief, transcript);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
