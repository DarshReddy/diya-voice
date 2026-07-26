/**
 * Trailing-edge coalescing for a rapid-fire sequence of async calls where
 * only the newest one's result matters — e.g. the push-to-talk / "type
 * instead" path firing /api/designer/turn faster than it can respond. A
 * monotonically increasing sequence number is stamped on each call; when it
 * resolves, the caller checks whether it's still the newest before acting
 * on the result. No queueing, no cancellation of the actual network
 * request — a superseded response is simply ignored when it lands.
 *
 * (Originally built for VoiceSession's per-utterance /api/extract calls,
 * which fired concurrently for the platform's partial-then-final transcript
 * lines. That call was removed entirely — Plan A's live loop is now fully
 * deterministic, see components/VoiceSession.tsx — but the same pileup risk
 * exists wherever /api/designer/turn is still LLM-backed, so this utility is
 * shared and used there instead.)
 */
export interface LatestOnlyGate {
  /** Registers a new in-flight call. Call `isStale()` after it resolves — if true, a newer call has since started and this result should be discarded. */
  next(): { seq: number; isStale: () => boolean };
}

export function createLatestOnlyGate(): LatestOnlyGate {
  let currentSeq = 0;
  return {
    next() {
      const seq = ++currentSeq;
      return {
        seq,
        isStale: () => seq !== currentSeq,
      };
    },
  };
}
