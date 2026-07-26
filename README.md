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
- `lib/keywordMatch.ts` — instant (<1ms), deterministic keyword pre-matcher
  covering outfit types, fabric folders, occasions, and colors, each with
  English + Hindi/Telugu/Kannada transliterations. Used for immediate chip
  fill before any LLM call lands.
- `lib/turn.ts` / `lib/extract.ts` — the Sarvam-backed (`sarvam-30b`) slot
  extraction + reply composition, merged into a single LLM call per turn.
- `app/api/designer/turn`, `app/api/extract`, `app/api/assets/[...path]` —
  the three server routes; see inline comments for Sarvam API quirks
  (`reasoning_effort`, `bulbul:v3` speaker/params, STT/TTS field names).
- `components/VoiceSession.tsx` — **Plan A**: a live, full-duplex voice call
  via the Sarvam Agents browser SDK (`sarvam-conv-ai-sdk/browser`).
- `components/TalkControl.tsx` — **Plan B / fallback**: push-to-talk
  (MediaRecorder → STT → extract+reply → TTS playback) plus a "type instead"
  text input, useful for testing without a mic.

## Live voice call (Plan A) — human verification checklist

`components/VoiceSession.tsx` cannot be exercised headlessly — it needs a
real microphone and a human in the loop. `npm run build` and `npm run lint`
both pass and the page renders both controls (verified), but **the actual
live call has not been tested end-to-end**. Whoever runs the spike should
check, in order:

1. **Connect.** Click the "Talk to Diya" button (above the push-to-talk
   fallback). It should go idle → "Connecting…" → live within a few seconds.
   If it fails, an inline error appears and push-to-talk stays usable —
   confirm that fallback path too.
2. **Greeting audio.** Once live, you should hear Diya's opening line played
   back through the browser (the SDK's own TTS via `BrowserAudioInterface`,
   independent of our `/api/designer/turn` TTS path).
3. **Transcript callbacks firing.** Speak a design ask (e.g. "I want a maroon
   satin maxi dress for a wedding"). Confirm lines appear in the transcript
   pane for BOTH you (`role: 'user'`) and Diya (`role: 'bot'`) as the SDK's
   `transcriptCallback` fires — this is a strong signal the WebSocket session
   and STT/TTS pipeline are actually working, not just "connected."
4. **Chips lighting up while speaking.** The moment your transcript line
   lands, the design-brief chips (occasion/outfit/fabric/color) should light
   up almost instantly from the keyword pre-matcher (`lib/keywordMatch.ts`,
   client-side, no network round trip) — check this happens noticeably
   before any perceptible delay, then confirm the chips may update again a
   few seconds later once the background `/api/extract` LLM call lands (it
   should only ever fill in more detail or correct a value, never blank out
   something the keyword matcher already set).
5. **Prefilled context.** If you set fabric/color/occasion manually via the
   swatch/sketch pickers *before* starting the call, confirm Diya doesn't
   re-ask for that slot — the current brief is sent as `agent_variables` at
   session start.
6. **Voice-orb state.** Watch the button label under "Talk to Diya" — it
   should track the SDK's own state machine (Connecting… / Listening… /
   Diya is speaking…) via `stateCallback`, and the button should subtly
   scale with mic input level via `audioLevelCallback`.
7. **End conversation.** Clicking the button again while live should cleanly
   stop the call (`agent.stop()`) and return to idle.
8. **Error path.** Try starting a call with the mic permission denied, or
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
