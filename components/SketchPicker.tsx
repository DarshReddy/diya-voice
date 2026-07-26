'use client';

import Image from 'next/image';
import { useBriefStore } from '@/lib/store/briefStore';
import {
  OUTFIT_CATEGORIES,
  OUTFIT_CATEGORY_LABELS,
  getSketchesByCategory,
  getCoordSetLabels,
  sketchImageUrl,
  coordSetImageUrl,
  sketchDisplayName,
  sanitizeDisplayText,
} from '@/lib/catalog';

export default function SketchPicker() {
  const outfitType = useBriefStore((s) => s.brief.outfitType);
  const sketchId = useBriefStore((s) => s.brief.sketchId);
  const applyPatch = useBriefStore((s) => s.applyPatch);

  return (
    <section aria-label="Outfit style picker" className="w-full">
      <h2 className="font-display text-sm uppercase tracking-[0.18em] text-maroon-700/70 mb-3">
        Outfit Style
      </h2>

      <div className="flex flex-wrap gap-2 mb-3">
        {OUTFIT_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => applyPatch({ outfitType: cat })}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              outfitType === cat
                ? 'bg-maroon-800 border-maroon-800 text-cream-50'
                : 'bg-cream-50 border-maroon-900/15 text-maroon-950/70 hover:border-maroon-700/40'
            }`}
          >
            {OUTFIT_CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {outfitType ? (
        outfitType === 'coord-sets' ? (
          <CoordSetStrip selectedId={sketchId ?? null} onSelect={(id) => applyPatch({ sketchId: String(id) })} />
        ) : (
          <SketchStrip
            category={outfitType}
            selectedId={sketchId ?? null}
            onSelect={(id) => applyPatch({ sketchId: id })}
          />
        )
      ) : (
        <p className="text-sm text-maroon-950/40">Choose an outfit type above to see sketches.</p>
      )}
    </section>
  );
}

function SketchStrip({
  category,
  selectedId,
  onSelect,
}: {
  category: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sketches = getSketchesByCategory(category);

  if (sketches.length === 0) {
    return <p className="text-sm text-maroon-950/40">No sketches catalogued for this category yet.</p>;
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {sketches.map((sketch) => (
        <button
          key={sketch.id}
          type="button"
          onClick={() => onSelect(sketch.id)}
          className={`shrink-0 w-28 rounded-lg overflow-hidden border-2 transition-all ${
            selectedId === sketch.id ? 'border-maroon-700 ring-2 ring-maroon-700/40' : 'border-transparent'
          }`}
        >
          <div className="relative w-28 h-36 bg-cream-200">
            <Image
              src={sketchImageUrl(sketch.category, sketch.id)}
              alt={sketchDisplayName(sketch)}
              fill
              sizes="112px"
              className="object-cover"
              unoptimized
            />
          </div>
          <p className="text-[11px] leading-tight px-1 py-1 text-maroon-950/80 truncate">
            {sketchDisplayName(sketch)}
          </p>
        </button>
      ))}
    </div>
  );
}

function CoordSetStrip({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: number) => void;
}) {
  const coordSets = getCoordSetLabels();

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {coordSets.map((set) => (
        <button
          key={set.id}
          type="button"
          onClick={() => onSelect(set.id)}
          className={`shrink-0 w-28 rounded-lg overflow-hidden border-2 transition-all ${
            selectedId === String(set.id) ? 'border-maroon-700 ring-2 ring-maroon-700/40' : 'border-transparent'
          }`}
        >
          <div className="relative w-28 h-36 bg-cream-200">
            <Image
              src={coordSetImageUrl(set.id)}
              alt={sanitizeDisplayText(`${set.top} with ${set.bottom}`)}
              fill
              sizes="112px"
              className="object-cover"
              unoptimized
            />
          </div>
          <p className="text-[11px] leading-tight px-1 py-1 text-maroon-950/80 truncate">
            {sanitizeDisplayText(`${set.top} + ${set.bottom}`)}
          </p>
        </button>
      ))}
    </div>
  );
}
