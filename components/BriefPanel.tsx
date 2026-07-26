'use client';

import { useBriefStore } from '@/lib/store/briefStore';
import { OUTFIT_CATEGORY_LABELS, getFabricFolder } from '@/lib/catalog';

interface SlotDef {
  key: 'occasion' | 'outfitType' | 'fabricFolder' | 'color' | 'size' | 'neededBy';
  label: string;
}

const SLOTS: SlotDef[] = [
  { key: 'occasion', label: 'Occasion' },
  { key: 'outfitType', label: 'Outfit' },
  { key: 'fabricFolder', label: 'Fabric' },
  { key: 'color', label: 'Color' },
  { key: 'size', label: 'Size' },
  { key: 'neededBy', label: 'Needed by' },
];

function displayValue(key: SlotDef['key'], value: string | null | undefined): string | null {
  if (!value) return null;
  if (key === 'outfitType') return OUTFIT_CATEGORY_LABELS[value as keyof typeof OUTFIT_CATEGORY_LABELS] ?? value;
  if (key === 'fabricFolder') return getFabricFolder(value)?.label ?? value;
  return value;
}

export default function BriefPanel() {
  const brief = useBriefStore((s) => s.brief);

  return (
    <section aria-label="Design brief" className="w-full">
      <h2 className="font-display text-sm uppercase tracking-[0.18em] text-maroon-700/70 mb-3">
        Design Brief
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {SLOTS.map((slot) => {
          const value = displayValue(slot.key, brief[slot.key] as string | null | undefined);
          const filled = Boolean(value);
          return (
            <div
              key={slot.key}
              className={`rounded-xl border px-3 py-2.5 transition-colors ${
                filled
                  ? 'border-maroon-700/30 bg-maroon-800 text-cream-50 shadow-sm'
                  : 'border-maroon-900/10 bg-cream-50 text-maroon-950/40'
              }`}
            >
              <div
                className={`text-[10px] uppercase tracking-wider mb-0.5 ${
                  filled ? 'text-cream-200/80' : 'text-maroon-900/40'
                }`}
              >
                {slot.label}
              </div>
              <div className="text-sm font-medium truncate">{value ?? '—'}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
