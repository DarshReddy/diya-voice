'use client';

// Plan A: live browser voice call via the Sarvam Agents SDK, wired against
// diya-voice's real brief store and catalog-matching helpers. Loaded
// statically from app/page.tsx as a 'use client' component (verified safe —
// the SDK's compiled JS guards all browser-API access behind
// `typeof window !== "undefined"` checks or defers it to methods only
// invoked from the start() click handler, never at module load).
//
// Adapted from the Plan A draft against the SDK's ACTUAL exported types
// (inspected in node_modules/sarvam-conv-ai-sdk/dist/*.d.ts) rather than the
// draft's educated guesses — differences worth flagging:
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
//
// IMPORTANT — the live per-utterance loop is fully deterministic, no LLM:
// two real live calls exposed sarvam-30b /api/extract firing once per
// transcript line (the platform emits partial-then-final versions of the
// same utterance as separate lines), which caused request pileup, degraded
// latency (26s -> 96s), and out-of-order stale patches. sarvam-30b is no
// longer called during the live loop at all — every transcript line is
// processed instantly via keywordMatchBrief + enrichPatchWithCatalogMatches
// (fabricFile from folder+color, suggestedSketchId from outfitType+style/
// occasion), all pure/synchronous, all client-side. sarvam-30b is reserved
// for the end-of-call /api/compose-prompt step (see README).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationAgent, BrowserAudioInterface, InteractionType, AgentState } from 'sarvam-conv-ai-sdk/browser';
import type { ServerTranscriptMsg } from 'sarvam-conv-ai-sdk/browser';
import { useBriefStore } from '@/lib/store/briefStore';
import { keywordMatchBrief } from '@/lib/keywordMatch';
import { enrichPatchWithCatalogMatches } from '@/lib/enrichPatch';
import { EMPTY_BRIEF, Brief, isBriefComplete } from '@/lib/brief';

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

/** Rolling accumulation of user utterances into a free-text styleDetails string, capped ~200 chars. */
const STYLE_DETAILS_CHAR_CAP = 200;

function randomIdentifier(): string {
  return `demo-${Math.random().toString(36).slice(2, 10)}`;
}

export default function VoiceSession() {
  const brief = useBriefStore((s) => s.brief);
  const applyPatch = useBriefStore((s) => s.applyPatch);
  const pushTurn = useBriefStore((s) => s.pushTurn);
  const resetBrief = useBriefStore((s) => s.reset);
  const requestAutoPreview = useBriefStore((s) => s.requestAutoPreview);

  const briefRef = useRef(brief);
  useEffect(() => {
    briefRef.current = brief;
  }, [brief]);

  // Rolling window of recent user utterances, joined into a styleDetails
  // free-text string (see the module doc comment — this replaces the
  // per-line LLM extract call that used to feed styleDetails).
  const recentLinesRef = useRef<string[]>([]);

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

    // Every new live call starts from a clean brief. Without this, a second
    // live call in the same page session inherited the first call's fully
    // populated slots (occasion/outfit/fabric/etc.) both as agent_variables
    // AND as the "known so far" context for every subsequent utterance,
    // which is the exact leak two real calls exposed. Reset the ref
    // immediately too — the store update from resetBrief() only reaches
    // `brief` (and this ref, via the effect above) on the next render, which
    // is too late for the agent_variables built just below.
    resetBrief();
    briefRef.current = { ...EMPTY_BRIEF };
    recentLinesRef.current = [];

    const agent = new ConversationAgent({
      apiKey,
      config: {
        ...SARVAM_CONFIG,
        user_identifier_type: 'custom',
        user_identifier: randomIdentifier(),
        agent_variables: {
          occasion: '',
          outfit_type: '',
          fabric: '',
          color: '',
          size: '',
          needed_by: '',
          style_details: '',
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

        // Fully deterministic, synchronous, no network call — see the
        // module doc comment for why sarvam-30b is no longer in this loop.
        const fastPatch = keywordMatchBrief(msg.content);

        recentLinesRef.current = [...recentLinesRef.current, msg.content.trim()].filter(Boolean);
        while (
          recentLinesRef.current.length > 1 &&
          recentLinesRef.current.join(' ').length > STYLE_DETAILS_CHAR_CAP
        ) {
          recentLinesRef.current.shift();
        }
        const styleDetails = recentLinesRef.current.join(' ').slice(-STYLE_DETAILS_CHAR_CAP);

        const patch: Partial<Brief> = { ...fastPatch };
        if (styleDetails) patch.styleDetails = styleDetails;

        const enriched = enrichPatchWithCatalogMatches(patch, briefRef.current);
        applyPatch(enriched);
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
        // Auto-trigger the preview once the call ends, if the conversation
        // reached a complete brief. PreviewCard hashes the brief itself so
        // this never double-fires a generation for the same design.
        if (isBriefComplete(briefRef.current)) requestAutoPreview();
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
  }, [applyPatch, pushTurn, resetBrief, requestAutoPreview, sessionState]);

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
