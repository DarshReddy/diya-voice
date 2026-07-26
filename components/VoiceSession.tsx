'use client';

// Plan A: live browser voice call via the Sarvam Agents SDK, wired against
// bolke-design-karo's real brief store, keyword pre-matcher, and /api/extract
// route. Loaded via next/dynamic({ ssr: false }) from app/page.tsx so the SDK
// never touches the server-render / prerender path (see the guard note near
// the export at the bottom of this file too).
//
// Adapted from the Plan A draft against the SDK's ACTUAL exported types
// (inspected in node_modules/sarvam-conv-ai-sdk/dist/*.d.ts) rather than the
// draft's educated guesses — three real differences worth flagging:
//   1. transcriptCallback's message shape is `{ role: Role, content: string }`
//      (Role is 'user' | 'bot'), not `{ role: string, text: string }` as the
//      draft assumed — the field is `content`, not `text`.
//   2. `Role` and `UserIdentifierType` are TYPE-ONLY exports from the
//      "sarvam-conv-ai-sdk/browser" subpath (only AgentState, InteractionType,
//      and the SDKError family are re-exported as runtime values there) — so
//      role/identifier-type comparisons below use plain string literals
//      ('user', 'custom') instead of importing enum values that don't
//      actually exist at that import path.
//   3. `InteractionConfig` also requires `user_identifier_type: string`,
//      which the draft's SARVAM_CONFIG omitted.
//   4. `audioLevelCallback` receives an `AudioLevel` object
//      (`{direction, rms, peak, db, sampleRate}`), not a bare number.
//   5. `agent.waitForConnect(timeout)` resolves to a `boolean`, not `void`.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationAgent, BrowserAudioInterface, InteractionType, AgentState } from 'sarvam-conv-ai-sdk/browser';
import type { ServerTranscriptMsg } from 'sarvam-conv-ai-sdk/browser';
import { useBriefStore } from '@/lib/store/briefStore';
import { keywordMatchBrief } from '@/lib/keywordMatch';

/** Static per-app config for this DIYO Sarvam Agents workspace. */
const SARVAM_CONFIG = {
  org_id: '019f980d-141c-7d14-9e8e-acfa4cf04924',
  workspace_id: '019f980d-1420-741c-b4a2-73b613d8617b',
  app_id: 'Conversatio-81e03d68-e712',
  interaction_type: InteractionType.CALL,
  input_sample_rate: 16000 as const,
  output_sample_rate: 16000 as const,
};

type SessionState = 'idle' | 'connecting' | 'live' | 'error';

const AGENT_STATE_LABEL: Record<AgentState, string> = {
  [AgentState.IDLE]: 'Idle',
  [AgentState.CONNECTING]: 'Connecting…',
  [AgentState.CONNECTED]: 'Connected',
  [AgentState.LISTENING]: 'Listening…',
  [AgentState.SPEAKING]: 'Diya is speaking…',
  [AgentState.ERROR]: 'Error',
};

function randomIdentifier(): string {
  return `demo-${Math.random().toString(36).slice(2, 10)}`;
}

export default function VoiceSession() {
  const brief = useBriefStore((s) => s.brief);
  const applyPatch = useBriefStore((s) => s.applyPatch);
  const pushTurn = useBriefStore((s) => s.pushTurn);

  const briefRef = useRef(brief);
  useEffect(() => {
    briefRef.current = brief;
  }, [brief]);

  const agentRef = useRef<ConversationAgent | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [agentState, setAgentState] = useState<AgentState>(AgentState.IDLE);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (sessionState === 'connecting' || sessionState === 'live') return;

    const apiKey = process.env.NEXT_PUBLIC_SARVAM_API_KEY;
    if (!apiKey) {
      setError('Voice session is not configured (missing NEXT_PUBLIC_SARVAM_API_KEY). Use push-to-talk fallback below.');
      setSessionState('error');
      return;
    }

    setError(null);
    setSessionState('connecting');

    const agent = new ConversationAgent({
      apiKey,
      config: {
        ...SARVAM_CONFIG,
        user_identifier_type: 'custom',
        user_identifier: randomIdentifier(),
        // Prefill: manual picks made before starting voice reach Diya so she never re-asks.
        agent_variables: {
          occasion: briefRef.current.occasion ?? '',
          outfit_type: briefRef.current.outfitType ?? '',
          fabric: briefRef.current.fabricFolder ?? '',
          color: briefRef.current.color ?? '',
          size: briefRef.current.size ?? '',
          needed_by: briefRef.current.neededBy ?? '',
          style_details: briefRef.current.styleDetails ?? '',
          user_name: '',
          gender: '',
          call_summary: '',
          consultation_outcome: '',
        },
      },
      audioInterface: new BrowserAudioInterface(),
      transcriptCallback: async (msg: ServerTranscriptMsg) => {
        const isUser = msg.role === 'user';
        pushTurn(isUser ? 'user' : 'diya', msg.content);
        if (!isUser) return;

        // Instant, deterministic chip-fill — applied synchronously the
        // moment the transcript line arrives, before any network call.
        const fastPatch = keywordMatchBrief(msg.content);
        if (Object.keys(fastPatch).length > 0) applyPatch(fastPatch);

        // Background LLM extraction — never blocks or interrupts the live
        // call; applies on top when it lands (wins on conflict, never nulls
        // a slot the keyword matcher already filled — see mergeBrief).
        try {
          const res = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ transcript: msg.content, brief: briefRef.current }),
          });
          const data = await res.json();
          if (data?.patch && Object.keys(data.patch).length > 0) applyPatch(data.patch);
        } catch {
          // Extraction is best-effort; the live conversation continues regardless.
        }
      },
      stateCallback: (newState) => {
        setAgentState(newState);
      },
      audioLevelCallback: (lvl) => {
        setLevel(lvl.rms);
      },
      endCallback: async () => {
        setSessionState('idle');
        setAgentState(AgentState.IDLE);
        setLevel(0);
      },
    });

    agentRef.current = agent;

    try {
      await agent.start();
      const connected = await agent.waitForConnect(10);
      if (!connected) throw new Error('Timed out waiting for the live call to connect.');
      setSessionState('live');
    } catch (err) {
      console.error('[VoiceSession] failed to start', err);
      setError(err instanceof Error ? err.message : 'Could not start the live call.');
      setSessionState('error');
      agentRef.current = null;
    }
  }, [applyPatch, pushTurn, sessionState]);

  const stop = useCallback(async () => {
    try {
      await agentRef.current?.stop();
    } catch {
      // best-effort teardown
    }
    agentRef.current = null;
    setSessionState('idle');
    setAgentState(AgentState.IDLE);
    setLevel(0);
  }, []);

  // Clean up an in-progress session if the component unmounts.
  useEffect(() => {
    return () => {
      agentRef.current?.stop().catch(() => {});
    };
  }, []);

  const isLive = sessionState === 'live';
  const busy = sessionState === 'connecting';

  const buttonLabel =
    sessionState === 'idle'
      ? 'Talk to Diya'
      : sessionState === 'connecting'
        ? 'Connecting…'
        : sessionState === 'live'
          ? 'End conversation'
          : 'Retry live call';

  return (
    <section aria-label="Talk to Diya (live call)" className="w-full flex flex-col items-center gap-3">
      <h2 className="font-display text-sm uppercase tracking-[0.18em] text-maroon-700/70">Talk to Diya</h2>

      <button
        type="button"
        onClick={isLive ? stop : start}
        disabled={busy}
        className={`relative rounded-full px-8 py-4 text-base font-semibold shadow-lg transition-transform active:scale-95 disabled:opacity-70 ${
          isLive ? 'bg-maroon-700 text-cream-50' : 'bg-gradient-to-br from-maroon-800 to-maroon-900 text-cream-50'
        }`}
        style={{ transform: `scale(${1 + Math.min(level, 1) * 0.12})` }}
      >
        {isLive && <span className="absolute inset-0 rounded-full mic-pulse pointer-events-none" />}
        <span className="relative">{buttonLabel}</span>
      </button>

      {isLive && <p className="text-sm font-medium text-maroon-800/80">{AGENT_STATE_LABEL[agentState]}</p>}

      {error && (
        <p className="text-xs text-maroon-600 text-center max-w-xs">
          {error} Push-to-talk fallback is available below.
        </p>
      )}
    </section>
  );
}
