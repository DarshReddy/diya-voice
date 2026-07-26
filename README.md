# Diya Voice — DIYO Voice Designer

A voice-driven custom western-wear design consultation for DIYO, built for the
Sarvam buildathon. Diya, DIYO's voice designer, collects a design brief
(occasion, outfit type, fabric, color, size, needed-by) through conversation
and shows matching swatches/sketches from the real DIYO catalog as she goes.

## Running locally

```bash
npm install
npm run dev
```

Runs on **port 3001** (diyo-app, the main site, owns 3000). Requires a
`.env.local` with `SARVAM_API_KEY`, `NEXT_PUBLIC_SARVAM_API_KEY`, and
`ASSETS_BASE_URL` — see `.env.local` (git-ignored) for the current values.

## Architecture

- `lib/catalog.ts` — typed loaders over the copied DIYO catalog data
  (`lib/data/*.json`: fabric swatches, sketches, coord-sets) plus the
  `/api/assets` proxy URL builders (the `diyo-assets` GCS bucket's CORS only
  allows `diyo.in`, so the browser can't fetch it directly in local dev).
  Also home to the two deterministic matchers: `findBestSwatchMatch`
  (fabricFile from folder+color) and `findBestSketchMatch` (sketch
  suggestion from outfitType+styleDetails/occasion) — see below.
- `lib/keywordMatch.ts` — instant (<1ms), deterministic keyword pre-matcher
  covering outfit types, fabric folders, occasions, and colors, each with
  English + Hindi/Telugu/Kannada transliterations. Used for immediate chip
  fill, with zero network/LLM involvement.
- `lib/enrichPatch.ts` — shared deterministic enrichment
  (`enrichPatchWithCatalogMatches`) that layers `fabricFile` and
  `suggestedSketchId` onto any patch, used identically by both the live
  voice loop (client-side) and the LLM-extracted patches (server-side).

### The live loop is fully deterministic — sarvam-30b is NOT in it

Two real live calls exposed a pileup problem: the platform emits
partial-then-final versions of the same utterance as separate transcript
lines, and firing an LLM `/api/extract` call per line caused request
pileup, degraded latency (26s → 96s), and out-of-order stale patches.
`components/VoiceSession.tsx` (Plan A) no longer calls any LLM during the
live conversation. Every transcript line is processed instantly and
synchronously:

1. `keywordMatchBrief` (occasion/outfitType/fabricFolder/color, with
   transliterations).
2. A rolling window of recent user utterances accumulates into a free-text
   `styleDetails` (capped ~200 chars).
3. `enrichPatchWithCatalogMatches` fills in `fabricFile` and
   `suggestedSketchId` deterministically from the above.

sarvam-30b is reserved for two places only now:
- `app/api/designer/turn` / `app/api/extract` — the **Plan B** (push-to-talk
  + "type instead") path, which is turn-based (one explicit submission at a
  time), so LLM extraction there is fine. `lib/useDesignerTurn.ts` still adds
  trailing-edge coalescing (`lib/latestOnly.ts`) as a safety net against
  rapid-fire submissions.
- `app/api/compose-prompt` (new) — a single end-of-call sarvam-30b call that
  turns the finished brief + last ~10 transcript lines into one rich,
  single-paragraph English image-generation prompt (garment silhouette from
  the matched sketch, fabric + color, occasion mood). Not yet wired into the
  UI — it's meant to feed a downstream Gemini image-compose step added
  later. Verify it directly:
  ```bash
  curl -s -X POST localhost:3001/api/compose-prompt -H 'content-type: application/json' -d '{
    "brief": {"occasion":"Festive","outfitType":"short-dresses","fabricFolder":"satin","color":"green","styleDetails":"playful ruffles sleeveless","sketchId":"sd-5"},
    "transcript": [{"speaker":"user","text":"I want a frock for a festive occasion"}]
  }'
  ```

- `lib/sarvam.ts` — thin REST wrappers (`sarvam-30b` chat completions, STT,
  TTS). `chatCompletionJson` first tries `lib/jsonSalvage.ts` to repair a
  truncated response (sarvam-30b's hidden reasoning length is stochastic
  even at `reasoning_effort: "low"`, and occasionally eats the whole
  `max_tokens` budget before finishing) before falling back to a full
  network retry — this turned 47-96s worst-case calls back into ~10-25s.
- `components/VoiceSession.tsx` — **Plan A**: a live, full-duplex voice call
  via the Sarvam Agents browser SDK (`sarvam-conv-ai-sdk/browser`).
- `components/TalkControl.tsx` — **Plan B / fallback**: push-to-talk
  (MediaRecorder → STT → extract+reply → TTS playback) plus a "type instead"
  text input, useful for testing without a mic.
- `components/BriefPanel.tsx` — the design-brief chips, plus a **"Start
  over"** button that resets the brief + transcript at any time.

### Brief store lifetime

`lib/store/briefStore.ts` is a plain in-memory zustand store — **no
`persist` middleware**, deliberately, since session persistence across
conversations is not wanted here. Every new live call
(`VoiceSession.start()`) calls the store's `reset()` action before building
`agent_variables`, so a second live call in the same page session always
starts from an empty brief — this is what fixed the leak where a second
call was inheriting the first call's fully-populated slots. One
consequence: manual picker selections made *before* clicking "Talk to Diya"
are cleared at call start too (this is intentional — there's no way to
distinguish "deliberate pre-call setup" from "leftover conversation state"
without additional bookkeeping, and preventing the leak matters more). The
"Start over" button in `BriefPanel` gives explicit manual control over the
same reset at any other time.

## Live voice call (Plan A) — human verification checklist

Live SDK calls have been confirmed working end-to-end in real usage
(including KB retrieval), but re-check the following after any change to
`components/VoiceSession.tsx`:

1. **Connect.** Click the "Talk to Diya" button (above the push-to-talk
   fallback). It should go idle → "Connecting…" → live within a few seconds.
   If it fails, an inline error appears and push-to-talk stays usable —
   confirm that fallback path too.
2. **Greeting audio.** Once live, you should hear Diya's opening line played
   back through the browser (the SDK's own TTS via `BrowserAudioInterface`,
   independent of our `/api/designer/turn` TTS path).
3. **Transcript callbacks firing.** Speak a design ask (e.g. "I want a maroon
   satin maxi dress for a wedding"). Confirm lines appear in the transcript
   pane for BOTH you (`role: 'user'`) and Diya (`role: 'bot'`).
4. **Chips lighting up instantly, no LLM wave.** The moment your transcript
   line lands, the design-brief chips (occasion/outfit/fabric/color) should
   light up immediately — this is now the ONLY update path during a live
   call (keyword match + deterministic catalog matching, zero network
   calls), so there should be no second "LLM refines it a few seconds
   later" update anymore. If you see a delayed second update, something
   regressed back toward calling an LLM per utterance.
5. **Sketch auto-suggestion.** Once outfit type and either style details
   (mentioned naturally in conversation) or occasion are known, a sketch in
   the outfit-style strip should get a gold "Suggested" ring/badge and
   scroll into view automatically (`findBestSketchMatch`). Manually clicking
   a *different* sketch should immediately clear the suggestion styling and
   make your pick authoritative — a suggestion must never override a
   manual pick.
6. **Fresh start per call.** Start a live call, let Diya fill several slots,
   end the call, then start a SECOND live call without reloading the page.
   The brief chips and transcript should be empty at the start of the second
   call (see "Brief store lifetime" above) — this is the fix for the actual
   cross-call slot leak seen in real testing. Also try the "Start over"
   button mid-conversation and confirm chips + transcript clear instantly.
7. **Voice-orb state.** Watch the button label under "Talk to Diya" — it
   should track the SDK's own state machine (Connecting… / Listening… /
   Diya is speaking…) via `stateCallback`, and the button should subtly
   scale with mic input level via `audioLevelCallback`.
8. **End conversation.** Clicking the button again while live should cleanly
   stop the call (`agent.stop()`) and return to idle.
9. **Error path.** Try starting a call with the mic permission denied, or
   temporarily blank out `NEXT_PUBLIC_SARVAM_API_KEY`, and confirm the error
   message appears inline and push-to-talk still works — Plan A failing
   should never brick the app.

### Known adaptations from the original Plan A draft

The draft component (written from docs/educated guesses) used field/callback
shapes that don't match the SDK's actual shipped types
(`node_modules/sarvam-conv-ai-sdk/dist/*.d.ts`). The real ones, used in
`components/VoiceSession.tsx`:

- Transcript messages are `{ role: 'user' | 'bot', content: string }` — the
  field is `content`, not `text`, and role is a lowercase string, not an
  arbitrary label.
- `Role` and `UserIdentifierType` are **type-only** exports from
  `sarvam-conv-ai-sdk/browser` (only `AgentState`, `InteractionType`, and the
  `SDKError` family are real runtime exports at that subpath) — so role
  checks and `user_identifier_type` use plain string literals instead of
  enum values that don't actually exist at that import path.
- `InteractionConfig` also requires `user_identifier_type: string`, which
  the draft omitted.
- `audioLevelCallback` receives `{ direction, rms, peak, db, sampleRate }`,
  not a bare number.
- `agent.waitForConnect(timeout)` resolves to a `boolean` (connected or not),
  not `void` — the code checks it and throws if `false`.

### Production note

`NEXT_PUBLIC_SARVAM_API_KEY` ships the raw account key to the browser, which
is fine for this local hackathon demo but is not how this should work in
production — a real deployment should mint short-lived, scoped session
tokens server-side and hand those to the client instead.
