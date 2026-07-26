'use client';

import { useEffect, useRef } from 'react';
import { useBriefStore } from '@/lib/store/briefStore';

export default function TranscriptPane() {
  const transcript = useBriefStore((s) => s.transcript);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript.length]);

  return (
    <section aria-label="Conversation transcript" className="w-full">
      <h2 className="font-display text-sm uppercase tracking-[0.18em] text-maroon-700/70 mb-3">
        Conversation
      </h2>
      <div className="rounded-xl border border-maroon-900/10 bg-cream-50 p-3 h-56 overflow-y-auto flex flex-col gap-2">
        {transcript.length === 0 && (
          <p className="text-sm text-maroon-950/40 m-auto text-center px-4">
            Hold the mic button and describe the outfit you have in mind — or type it below.
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
        <div ref={endRef} />
      </div>
    </section>
  );
}
