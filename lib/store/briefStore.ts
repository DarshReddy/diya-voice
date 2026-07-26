import { create } from 'zustand';
import { Brief, EMPTY_BRIEF, mergeBrief, isBriefComplete } from '@/lib/brief';

export type TalkState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface TranscriptTurn {
  id: string;
  speaker: 'user' | 'diya';
  text: string;
}

interface BriefStoreState {
  brief: Brief;
  talkState: TalkState;
  transcript: TranscriptTurn[];
  status: 'collecting' | 'complete';
  /** Bumped by VoiceSession's endCallback when a live call ends with a complete brief — PreviewCard watches this to auto-trigger generation once per brief. */
  previewAutoTriggerSignal: number;
  applyPatch: (patch: Partial<Brief>) => void;
  setTalkState: (state: TalkState) => void;
  pushTurn: (speaker: 'user' | 'diya', text: string) => void;
  setStatus: (status: 'collecting' | 'complete') => void;
  requestAutoPreview: () => void;
  reset: () => void;
}

export const useBriefStore = create<BriefStoreState>((set) => ({
  brief: { ...EMPTY_BRIEF },
  talkState: 'idle',
  transcript: [],
  status: 'collecting',
  previewAutoTriggerSignal: 0,
  applyPatch: (patch) =>
    set((state) => {
      const brief = mergeBrief(state.brief, patch);
      // Derived from the actual merged brief, not just whatever a caller
      // separately reports via setStatus — this way manual picker-only or
      // fully-deterministic (Plan A / VoiceSession) completions also flip
      // to "complete" correctly, not just LLM-turn-driven ones.
      return { brief, status: isBriefComplete(brief) ? 'complete' : 'collecting' };
    }),
  setTalkState: (talkState) => set({ talkState }),
  pushTurn: (speaker, text) =>
    set((state) => ({
      transcript: [...state.transcript, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, speaker, text }],
    })),
  setStatus: (status) => set({ status }),
  requestAutoPreview: () => set((state) => ({ previewAutoTriggerSignal: state.previewAutoTriggerSignal + 1 })),
  reset: () =>
    set({ brief: { ...EMPTY_BRIEF }, talkState: 'idle', transcript: [], status: 'collecting' }),
}));
