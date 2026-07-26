'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBriefStore } from '@/lib/store/briefStore';
import { OUTFIT_CATEGORY_LABELS, getFabricFolder } from '@/lib/catalog';
import { Brief } from '@/lib/brief';
import SummaryCard from './SummaryCard';

type PreviewState = 'idle' | 'loading' | 'success' | 'error';

/** Stable stringification used as an equality key — not cryptographic, just enough to detect "is this the same brief we already (auto-)generated for". */
function hashBrief(brief: Partial<Brief>): string {
  return JSON.stringify(brief, Object.keys(brief).sort());
}

/**
 * Shown once the brief is complete (occasion + outfitType + fabricFolder +
 * color — same `status === 'complete'` the store already derives). Calls
 * POST /api/preview, which internally composes the prompt, fetches the
 * chosen sketch + swatch images from GCS, and runs one Vertex Gemini
 * image-generation call.
 *
 * Auto-triggers once when VoiceSession's endCallback bumps
 * previewAutoTriggerSignal with a complete brief — but never twice for the
 * same brief (hashed via hashBrief), whether that repeat came from another
 * call ending unchanged or a manual "Create my preview" click that already
 * covered it.
 */
export default function PreviewCard() {
  const brief = useBriefStore((s) => s.brief);
  const status = useBriefStore((s) => s.status);
  const transcript = useBriefStore((s) => s.transcript);
  const autoTriggerSignal = useBriefStore((s) => s.previewAutoTriggerSignal);

  const [state, setState] = useState<PreviewState>('idle');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bring the preview into view when generation starts (it lives at the end
  // of the page, below the pickers).
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (state === 'loading') {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [state]);

  // Tracks the brief we last kicked off a generation for (manual or auto),
  // so a repeat auto-trigger for the same unchanged brief is a no-op.
  const lastHandledHashRef = useRef<string | null>(null);
  const lastAutoSignalRef = useRef(autoTriggerSignal);

  const generate = useCallback(async () => {
    setState('loading');
    setError(null);
    lastHandledHashRef.current = hashBrief(brief);
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brief,
          transcript: transcript.map((t) => ({ speaker: t.speaker, text: t.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? 'Something went wrong generating the preview.');
        setState('error');
        return;
      }
      setImageBase64(data.imageBase64);
      setState('success');
    } catch {
      setError('Could not reach the preview service. Check your connection and try again.');
      setState('error');
    }
  }, [brief, transcript]);

  useEffect(() => {
    if (autoTriggerSignal === lastAutoSignalRef.current) return;
    lastAutoSignalRef.current = autoTriggerSignal;
    if (status !== 'complete') return;
    if (hashBrief(brief) === lastHandledHashRef.current) return; // never auto-trigger twice for the same brief
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generate/brief intentionally re-read fresh on each signal bump, not on every brief change
  }, [autoTriggerSignal]);

  if (status !== 'complete') return null;

  const outfitLabel = brief.outfitType ? OUTFIT_CATEGORY_LABELS[brief.outfitType] : 'outfit';
  const fabricLabel = brief.fabricFolder ? (getFabricFolder(brief.fabricFolder)?.label ?? brief.fabricFolder) : 'fabric';

  return (
    <section
      ref={sectionRef}
      aria-label="Design preview"
      className="w-full rounded-xl border border-gold-500/40 bg-cream-50 p-4 shadow-md flex flex-col items-center gap-4 scroll-mt-4"
    >
      <h2 className="font-display text-sm uppercase tracking-[0.18em] text-maroon-700/70">Your Design Preview</h2>

      {state === 'idle' && (
        <button
          type="button"
          onClick={generate}
          className="rounded-full bg-gradient-to-br from-maroon-600 to-gold-500 px-6 py-3 text-sm font-semibold text-cream-50 shadow-lg active:scale-95 transition-transform"
        >
          Create my preview
        </button>
      )}

      {state === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <span className="h-8 w-8 rounded-full border-2 border-maroon-700 border-t-transparent animate-spin" />
          <p className="text-sm font-medium text-maroon-800/80 text-center">
            Diya&apos;s team is bringing your design to life…
          </p>
        </div>
      )}

      {state === 'error' && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-maroon-600 text-center max-w-xs">{error}</p>
          <button
            type="button"
            onClick={generate}
            className="rounded-full border border-maroon-700 px-5 py-2 text-sm font-medium text-maroon-800 hover:bg-maroon-50"
          >
            Retry
          </button>
        </div>
      )}

      {state === 'success' && imageBase64 && (
        <div className="w-full flex flex-col items-center gap-4">
          <div className="relative w-full max-w-md overflow-hidden rounded-lg shadow-lg">
            {/* Runtime-generated base64 image, not a static/remote asset — a plain img avoids next/image's optimizer entirely. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${imageBase64}`}
              alt={`Preview of a ${brief.color ?? ''} ${fabricLabel} ${outfitLabel}`.trim()}
              className="w-full h-auto"
            />
          </div>
          <SummaryCard />
          <button
            type="button"
            onClick={generate}
            className="text-xs uppercase tracking-wide text-maroon-700/70 underline underline-offset-2"
          >
            Regenerate
          </button>
        </div>
      )}
    </section>
  );
}
