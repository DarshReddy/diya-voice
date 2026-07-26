import { create } from 'zustand';
import { Brief, EMPTY_BRIEF, mergeBrief } from '@/lib/brief';

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
  applyPatch: (patch: Partial<Brief>) => void;
  setTalkState: (state: TalkState) => void;
  pushTurn: (speaker: 'user' | 'diya', text: string) => void;
  setStatus: (status: 'collecting' | 'complete') => void;
  reset: () => void;
}

export const useBriefStore = create<BriefStoreState>((set) => ({
  brief: { ...EMPTY_BRIEF },
  talkState: 'idle',
  transcript: [],
  status: 'collecting',
  applyPatch: (patch) =>
    set((state) => ({
      brief: mergeBrief(state.brief, patch),
    })),
  setTalkState: (talkState) => set({ talkState }),
  pushTurn: (speaker, text) =>
    set((state) => ({
      transcript: [...state.transcript, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, speaker, text }],
    })),
  setStatus: (status) => set({ status }),
  reset: () => set({ brief: { ...EMPTY_BRIEF }, talkState: 'idle', transcript: [], status: 'collecting' }),
}));
