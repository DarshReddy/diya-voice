'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBriefStore } from '@/lib/store/briefStore';

interface TurnResponse {
  transcript: string;
  languageCode: string;
  say: string;
  audioBase64: string;
  patch: Record<string, unknown>;
  redirect?: string;
  status: 'collecting' | 'complete';
  error?: string;
}

function playBase64Wav(base64: string): Promise<void> {
  return new Promise((resolve) => {
    if (!base64) {
      resolve();
      return;
    }
    const audio = new Audio(`data:audio/wav;base64,${base64}`);
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}

export function useDesignerTurn() {
  const brief = useBriefStore((s) => s.brief);
  const applyPatch = useBriefStore((s) => s.applyPatch);
  const pushTurn = useBriefStore((s) => s.pushTurn);
  const setTalkState = useBriefStore((s) => s.setTalkState);
  const setStatus = useBriefStore((s) => s.setStatus);
  const [error, setError] = useState<string | null>(null);

  const briefRef = useRef(brief);
  useEffect(() => {
    briefRef.current = brief;
  }, [brief]);

  const handleResponse = useCallback(
    async (res: Response) => {
      const data: TurnResponse = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? 'Something went wrong talking to Diya.');
        setTalkState('idle');
        return;
      }

      setError(null);
      pushTurn('user', data.transcript);
      applyPatch(data.patch ?? {});
      setStatus(data.status);
      pushTurn('diya', data.say);

      setTalkState('speaking');
      await playBase64Wav(data.audioBase64);
      setTalkState('idle');
    },
    [applyPatch, pushTurn, setStatus, setTalkState]
  );

  const submitText = useCallback(
    async (text: string) => {
      setTalkState('thinking');
      try {
        const res = await fetch('/api/designer/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, brief: briefRef.current }),
        });
        await handleResponse(res);
      } catch {
        setError('Could not reach Diya. Check your connection and try again.');
        setTalkState('idle');
      }
    },
    [handleResponse, setTalkState]
  );

  const submitAudio = useCallback(
    async (blob: Blob) => {
      setTalkState('thinking');
      try {
        const form = new FormData();
        form.append('audio', blob, 'audio.webm');
        form.append('brief', JSON.stringify(briefRef.current));
        const res = await fetch('/api/designer/turn', {
          method: 'POST',
          body: form,
        });
        await handleResponse(res);
      } catch {
        setError('Could not reach Diya. Check your connection and try again.');
        setTalkState('idle');
      }
    },
    [handleResponse, setTalkState]
  );

  return { submitText, submitAudio, error };
}
