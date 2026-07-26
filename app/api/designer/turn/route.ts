import { NextRequest, NextResponse } from 'next/server';
import { speechToText, textToSpeech } from '@/lib/sarvam';
import { extractBriefPatch } from '@/lib/extract';
import { composeReply } from '@/lib/reply';
import { Brief, EMPTY_BRIEF, mergeBrief, isBriefComplete } from '@/lib/brief';

interface TurnRequestBody {
  text?: string;
  brief?: Partial<Brief>;
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';

  let transcript: string;
  let languageCode: string | undefined;
  let brief: Partial<Brief> = {};

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const audio = form.get('audio');
      if (!audio || !(audio instanceof Blob)) {
        return NextResponse.json({ error: 'audio file is required in multipart mode' }, { status: 400 });
      }
      const briefRaw = form.get('brief');
      if (typeof briefRaw === 'string') {
        try {
          brief = JSON.parse(briefRaw);
        } catch {
          brief = {};
        }
      }

      const stt = await speechToText(audio, 'audio.webm');
      transcript = stt.transcript;
      languageCode = stt.languageCode;
    } else {
      const body: TurnRequestBody = await request.json();
      if (!body.text?.trim()) {
        return NextResponse.json({ error: 'text is required in JSON mode' }, { status: 400 });
      }
      transcript = body.text.trim();
      brief = body.brief ?? {};
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!transcript) {
    return NextResponse.json({ error: 'Could not transcribe any speech' }, { status: 422 });
  }

  try {
    const { patch, redirect } = await extractBriefPatch(transcript, brief);
    const mergedBrief = mergeBrief(mergeBrief(EMPTY_BRIEF, brief), patch);
    const status = isBriefComplete(mergedBrief) ? 'complete' : 'collecting';

    const { say, languageCode: replyLanguageCode } = await composeReply(transcript, mergedBrief, languageCode);
    const audioBase64 = await textToSpeech(say, replyLanguageCode);

    return NextResponse.json({
      transcript,
      languageCode: replyLanguageCode,
      say,
      audioBase64,
      patch,
      redirect,
      status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
