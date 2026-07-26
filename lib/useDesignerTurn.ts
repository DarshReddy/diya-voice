'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBriefStore } from '@/lib/store/briefStore';
import { keywordMatchBrief } from '@/lib/keywordMatch';
import { createLatestOnlyGate } from '@/lib/latestOnly';

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

  // /api/designer/turn is still LLM-backed (unlike Plan A's now fully
  // deterministic live-call loop), so a rapid-fire sequence of submissions
  // (e.g. a fast double-tap, or overlapping text + push-to-talk submits)
  // could still resolve out of order. Trailing-edge coalescing: only the
  // response to the LATEST request is ever applied — an earlier one landing
  // late is silently discarded rather than clobbering newer state.
  const gateRef = useRef(createLatestOnlyGate());

  const handleResponse = useCallback(
    async (res: Response, isStale: () => boolean) => {
      const data: TurnResponse = await res.json();

      if (isStale()) {
        // A newer submission has since started; this response is discarded
        // regardless of success/failure so it can't apply a stale patch.
        return;
      }

      if (!res.ok || data.error) {
        setError(data.error ?? 'Something went wrong talking to Diya.');
        setTalkState('idle');
        return;
      }

      setError(null);
      pushTurn('user', data.transcript);

      // Instant keyword patch first (no-op if submitText already applied it),
      // then the LLM's patch on top — mergeBrief only overwrites non-null
      // values, so the LLM patch wins on any conflict but never nulls out a
      // slot the keyword matcher already filled.
      const fastPatch = keywordMatchBrief(data.transcript);
      if (Object.keys(fastPatch).length > 0) applyPatch(fastPatch);
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
      // Instant, deterministic chip-fill — lights up before the network
      // round trip even starts. The (slower, more thorough) LLM patch lands
      // in handleResponse once /api/designer/turn responds.
      const fastPatch = keywordMatchBrief(text);
      if (Object.keys(fastPatch).length > 0) applyPatch(fastPatch);

      const { isStale } = gateRef.current.next();
      setTalkState('thinking');
      try {
        const res = await fetch('/api/designer/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, brief: briefRef.current }),
        });
        await handleResponse(res, isStale);
      } catch {
        if (!isStale()) {
          setError('Could not reach Diya. Check your connection and try again.');
          setTalkState('idle');
        }
      }
    },
    [applyPatch, handleResponse, setTalkState]
  );

  const submitAudio = useCallback(
    async (blob: Blob) => {
      const { isStale } = gateRef.current.next();
      setTalkState('thinking');
      try {
        const form = new FormData();
        form.append('audio', blob, 'audio.webm');
        form.append('brief', JSON.stringify(briefRef.current));
        const res = await fetch('/api/designer/turn', {
          method: 'POST',
          body: form,
        });
        await handleResponse(res, isStale);
      } catch {
        if (!isStale()) {
          setError('Could not reach Diya. Check your connection and try again.');
          setTalkState('idle');
        }
      }
    },
    [handleResponse, setTalkState]
  );

  return { submitText, submitAudio, error };
}
