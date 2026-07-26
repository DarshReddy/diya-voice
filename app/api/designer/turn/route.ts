import { NextRequest, NextResponse } from 'next/server';
import { speechToText, textToSpeech, toTtsLanguageCode } from '@/lib/sarvam';
import { runTurnPipeline } from '@/lib/turn';
import { keywordMatchBrief } from '@/lib/keywordMatch';
import { detectScriptLanguage } from '@/lib/language';
import { Brief } from '@/lib/brief';

interface TurnRequestBody {
  text?: string;
  brief?: Partial<Brief>;
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';

  let transcript: string;
  let sttLanguageCode: string | undefined;
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
      sttLanguageCode = stt.languageCode;
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
    const languageCode = sttLanguageCode ? toTtsLanguageCode(sttLanguageCode) : detectScriptLanguage(transcript);

    // Instant deterministic pre-match — seeds the single LLM call below so its
    // reasoning trace is shorter (it's confirming/overriding a hint rather
    // than extracting cold), which is most of why turns are now ~10-18s
    // instead of the old two-call ~45-90s.
    const keywordPatch = keywordMatchBrief(transcript);

    const { patch, redirect, say, status } = await runTurnPipeline(transcript, brief, languageCode, keywordPatch);
    const audioBase64 = await textToSpeech(say, languageCode);

    return NextResponse.json({
      transcript,
      languageCode,
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
