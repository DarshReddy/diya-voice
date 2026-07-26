'use client';

import { useBriefStore } from '@/lib/store/briefStore';
import { OUTFIT_CATEGORY_LABELS, getFabricFolder } from '@/lib/catalog';

export default function SummaryCard() {
  const brief = useBriefStore((s) => s.brief);
  const status = useBriefStore((s) => s.status);

  if (status !== 'complete') return null;

  const outfitLabel = brief.outfitType ? OUTFIT_CATEGORY_LABELS[brief.outfitType] : 'outfit';
  const fabricLabel = brief.fabricFolder ? getFabricFolder(brief.fabricFolder)?.label ?? brief.fabricFolder : 'fabric';

  const sentence = `A ${brief.color ?? ''} ${fabricLabel} ${outfitLabel.toLowerCase()} for ${brief.occasion ?? 'your occasion'}${
    brief.size ? `, size ${brief.size}` : ''
  }${brief.neededBy ? `, needed by ${brief.neededBy}` : ''}${
    brief.styleDetails ? ` — ${brief.styleDetails}` : ''
  }.`;

  return (
    <section
      aria-label="Design summary"
      className="w-full rounded-xl border border-gold-500/40 bg-gradient-to-br from-maroon-900 to-maroon-800 text-cream-50 p-4 shadow-md"
    >
      <h2 className="font-display text-sm uppercase tracking-[0.18em] text-gold-500 mb-2">
        Design Summary
      </h2>
      <p className="font-display text-lg leading-snug">{sentence}</p>
    </section>
  );
}
