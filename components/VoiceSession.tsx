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
import { keywordMatchBrief, extractStyleTerms } from '@/lib/keywordMatch';
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

/** Compact FAB labels while a call is live. */
const AGENT_STATE_FAB_LABEL: Record<AgentState, string> = {
  [AgentState.IDLE]: 'Live',
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

  // Accumulated clean style TERMS (not raw utterances). A raw rolling window
  // was tried first and a real call polluted styleDetails with call-control
  // chatter ("Yes correct… End the call. Hello.") while pushing the actual
  // style words out of the cap — so only vocabulary hits accumulate now.
  const styleTermsRef = useRef<Set<string>>(new Set());

  const agentRef = useRef<ConversationAgent | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [agentState, setAgentState] = useState<AgentState>(AgentState.IDLE);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Floating chat panel state: auto-opens with a call, collapsible; while
  // collapsed, turns that arrived since the last collapse show an unread
  // pulse. The seen-count is stamped in the collapse handler (not an
  // effect) to satisfy react-hooks/set-state-in-effect.
  const transcript = useBriefStore((s) => s.transcript);
  const [chatOpen, setChatOpen] = useState(false);
  const [seenAtCollapse, setSeenAtCollapse] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [chatOpen, transcript.length]);

  const collapseChat = useCallback(() => {
    setSeenAtCollapse(transcript.length);
    setChatOpen(false);
  }, [transcript.length]);

  const unread = !chatOpen && transcript.length > seenAtCollapse;

  const start = useCallback(async () => {
    if (sessionState === 'connecting' || sessionState === 'live') return;

    const apiKey = process.env.NEXT_PUBLIC_SARVAM_API_KEY;
    if (!apiKey) {
      setError('Voice session is not configured (missing NEXT_PUBLIC_SARVAM_API_KEY).');
      setSessionState('error');
      return;
    }

    setError(null);
    setSessionState('connecting');
    setChatOpen(true);

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
    styleTermsRef.current = new Set();

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

        // Only style-vocabulary hits accumulate (deduped); lines with no
        // style content leave styleDetails untouched.
        const newTerms = extractStyleTerms(msg.content);
        newTerms.forEach((t) => styleTermsRef.current.add(t));

        const patch: Partial<Brief> = { ...fastPatch };
        if (newTerms.length > 0) {
          patch.styleDetails = Array.from(styleTermsRef.current).join(', ').slice(0, STYLE_DETAILS_CHAR_CAP);
        }

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

  const fabLabel =
    sessionState === 'idle'
      ? 'Talk to Diya'
      : sessionState === 'connecting'
        ? 'Connecting…'
        : sessionState === 'live'
          ? AGENT_STATE_FAB_LABEL[agentState]
          : 'Retry call';

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {/* Floating conversation panel */}
      {chatOpen && (
        <section
          aria-label="Conversation with Diya"
          className="w-[min(360px,calc(100vw-40px))] rounded-2xl border border-maroon-900/10 bg-cream-50/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
        >
          <header className="flex items-center justify-between gap-2 px-4 py-2.5 bg-gradient-to-r from-maroon-600 to-gold-500 text-cream-50">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight truncate">Diya — your DIY Outfit designer</p>
              {isLive && <p className="text-[11px] opacity-80 leading-tight">{AGENT_STATE_LABEL[agentState]}</p>}
            </div>
            <button
              type="button"
              onClick={collapseChat}
              aria-label="Collapse conversation"
              className="shrink-0 rounded-full p-1 hover:bg-white/15 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </header>

          <div className="h-72 overflow-y-auto p-3 flex flex-col gap-2">
            {transcript.length === 0 && (
              <p className="text-sm text-maroon-950/40 m-auto text-center px-4">
                Tap “Talk to Diya” and describe the outfit you have in mind — in any language.
              </p>
            )}
            {transcript.map((turn) => (
              <div
                key={turn.id}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-snug ${
                  turn.speaker === 'user'
                    ? 'self-end bg-maroon-800 text-cream-50'
                    : 'self-start bg-cream-200 text-maroon-950'
                }`}
              >
                <span className="block text-[10px] uppercase tracking-wide opacity-60 mb-0.5">
                  {turn.speaker === 'user' ? 'You' : 'Diya'}
                </span>
                {turn.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </section>
      )}

      {/* Error toast above the FAB */}
      {error && !chatOpen && (
        <p className="max-w-[280px] rounded-xl border border-maroon-900/10 bg-cream-50 px-3 py-2 text-xs text-maroon-600 shadow-md text-right">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {/* Reopen-chat pill (visible when there is a conversation but the panel is collapsed) */}
        {!chatOpen && transcript.length > 0 && (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            aria-label="Open conversation"
            className="relative rounded-full bg-cream-50 border border-maroon-900/15 p-3 shadow-lg hover:border-maroon-600/40 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-maroon-700">
              <path
                d="M21 12a8 8 0 0 1-8 8H4l1.6-3.2A8 8 0 1 1 21 12z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {unread && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-gold-500 mic-pulse" />}
          </button>
        )}

        {/* The floating Talk-to-Diya button */}
        <button
          type="button"
          onClick={isLive ? stop : start}
          disabled={busy}
          aria-label={isLive ? 'End the call with Diya' : 'Talk to Diya (live call)'}
          className={`relative flex items-center gap-2.5 rounded-full px-5 py-3.5 text-sm font-semibold text-cream-50 shadow-xl transition-transform active:scale-95 disabled:opacity-70 ${
            isLive ? 'bg-maroon-700' : 'bg-gradient-to-br from-maroon-600 to-gold-500'
          }`}
          style={{ transform: `scale(${1 + Math.min(level, 1) * 0.1})` }}
        >
          {isLive && <span className="absolute inset-0 rounded-full mic-pulse pointer-events-none" />}
          {isLive ? (
            <span className="relative flex items-center gap-2.5">
              <span className="flex items-end gap-[3px] h-4" aria-hidden="true">
                <span className="w-[3px] h-full bg-cream-50/90 rounded-full speak-bar" />
                <span className="w-[3px] h-full bg-cream-50/90 rounded-full speak-bar [animation-delay:0.15s]" />
                <span className="w-[3px] h-full bg-cream-50/90 rounded-full speak-bar [animation-delay:0.3s]" />
              </span>
              {fabLabel}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="opacity-80">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </span>
          ) : (
            <span className="relative flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zM19 11a7 7 0 0 1-14 0M12 18v3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {fabLabel}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
