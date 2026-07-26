'use client';

import { useCallback, useRef, useState } from 'react';
import { useBriefStore } from '@/lib/store/briefStore';
import { useDesignerTurn } from '@/lib/useDesignerTurn';

const STATE_LABEL: Record<string, string> = {
  idle: 'Hold to talk (push-to-talk)',
  listening: 'Listening…',
  thinking: 'Diya is thinking…',
  speaking: 'Diya is speaking…',
};

export default function TalkControl() {
  const talkState = useBriefStore((s) => s.talkState);
  const setTalkState = useBriefStore((s) => s.setTalkState);
  const { submitText, submitAudio, error } = useDesignerTurn();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textValue, setTextValue] = useState('');
  const [micError, setMicError] = useState<string | null>(null);

  const startRecording = useCallback(async () => {
    if (talkState !== 'idle') return;
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setTalkState('listening');
    } catch {
      setMicError('Microphone access denied or unavailable — try "type instead" below.');
    }
  }, [talkState, setTalkState]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (blob.size > 0) {
        await submitAudio(blob);
      } else {
        setTalkState('idle');
      }
    };
    recorder.stop();
  }, [submitAudio, setTalkState]);

  const handleTextSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const value = textValue.trim();
      if (!value) return;
      setTextValue('');
      submitText(value);
    },
    [textValue, submitText]
  );

  const busy = talkState === 'thinking' || talkState === 'speaking';

  return (
    <section aria-label="Push-to-talk fallback" className="w-full flex flex-col items-center gap-4">
      <div className="relative flex items-center justify-center">
        {talkState === 'listening' && (
          <span className="absolute inline-flex h-24 w-24 rounded-full bg-maroon-700 mic-pulse" />
        )}
        <button
          type="button"
          disabled={busy}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onMouseLeave={() => talkState === 'listening' && stopRecording()}
          onTouchStart={(e) => {
            e.preventDefault();
            startRecording();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            stopRecording();
          }}
          className={`relative h-24 w-24 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95 disabled:opacity-60 ${
            talkState === 'listening' ? 'bg-maroon-700' : 'bg-maroon-800 hover:bg-maroon-700'
          }`}
          aria-label="Hold to talk"
        >
          {talkState === 'speaking' ? (
            <span className="flex items-end gap-1 h-8">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="speak-bar w-1.5 rounded-full bg-cream-50"
                  style={{ height: '100%', animationDelay: `${i * 0.12}s` }}
                />
              ))}
            </span>
          ) : talkState === 'thinking' ? (
            <span className="h-6 w-6 rounded-full border-2 border-cream-50 border-t-transparent animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-9 w-9 fill-cream-50">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
              <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A7 7 0 0 0 19 11Z" />
            </svg>
          )}
        </button>
      </div>

      <p className="text-sm font-medium text-maroon-800/80">{STATE_LABEL[talkState]}</p>

      {micError && <p className="text-xs text-maroon-600 text-center max-w-xs">{micError}</p>}
      {error && <p className="text-xs text-maroon-600 text-center max-w-xs">{error}</p>}

      <button
        type="button"
        onClick={() => setShowTextInput((v) => !v)}
        className="text-xs uppercase tracking-wide text-maroon-700/70 underline underline-offset-2"
      >
        {showTextInput ? 'Hide text input' : 'Type instead'}
      </button>

      {showTextInput && (
        <form onSubmit={handleTextSubmit} className="w-full max-w-sm flex gap-2">
          <input
            type="text"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            disabled={busy}
            placeholder="e.g. maroon satin maxi dress for a wedding"
            className="flex-1 rounded-lg border border-maroon-900/15 bg-cream-50 px-3 py-2 text-sm text-maroon-950 placeholder:text-maroon-950/35 focus:outline-none focus:ring-2 focus:ring-maroon-700/40"
          />
          <button
            type="submit"
            disabled={busy || !textValue.trim()}
            className="rounded-lg bg-maroon-800 px-4 py-2 text-sm font-medium text-cream-50 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
    </section>
  );
}
