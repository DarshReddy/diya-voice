'use client';

import Image from 'next/image';
import { useBriefStore } from '@/lib/store/briefStore';
import { FABRIC_FOLDERS, getSwatchesByFolder, fabricSwatchUrl } from '@/lib/catalog';

export default function FabricPicker() {
  const fabricFolder = useBriefStore((s) => s.brief.fabricFolder);
  const fabricFile = useBriefStore((s) => s.brief.fabricFile);
  const applyPatch = useBriefStore((s) => s.applyPatch);

  return (
    <section aria-label="Fabric picker" className="w-full">
      <h2 className="font-display text-sm uppercase tracking-[0.18em] text-maroon-700/70 mb-3">
        Fabric
      </h2>

      <div className="flex flex-wrap gap-2 mb-3">
        {FABRIC_FOLDERS.map((folder) => (
          <button
            key={folder.slug}
            type="button"
            onClick={() => applyPatch({ fabricFolder: folder.slug })}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              fabricFolder === folder.slug
                ? 'bg-maroon-800 border-maroon-800 text-cream-50'
                : 'bg-cream-50 border-maroon-900/15 text-maroon-950/70 hover:border-maroon-700/40'
            }`}
          >
            {folder.label}
          </button>
        ))}
      </div>

      {fabricFolder ? (
        <SwatchGrid
          folder={fabricFolder}
          selectedFile={fabricFile ?? null}
          onSelect={(file, color) => applyPatch({ fabricFolder, fabricFile: file, color })}
        />
      ) : (
        <p className="text-sm text-maroon-950/40">Choose a fabric folder above to see swatches.</p>
      )}
    </section>
  );
}

function SwatchGrid({
  folder,
  selectedFile,
  onSelect,
}: {
  folder: string;
  selectedFile: string | null;
  onSelect: (file: string, color: string) => void;
}) {
  const swatches = getSwatchesByFolder(folder);

  if (swatches.length === 0) {
    return <p className="text-sm text-maroon-950/40">No swatches catalogued for this folder yet.</p>;
  }

  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-64 overflow-y-auto">
      {swatches.map((s) => (
        <button
          key={`${s.folder}/${s.file}`}
          type="button"
          onClick={() => onSelect(s.file, s.color)}
          title={`${s.color} — ${s.pattern}`}
          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
            selectedFile === s.file ? 'border-maroon-700 ring-2 ring-maroon-700/40' : 'border-transparent'
          }`}
        >
          <Image
            src={fabricSwatchUrl(s.folder, s.file)}
            alt={`${s.color} ${s.pattern} swatch`}
            fill
            sizes="80px"
            className="object-cover"
            unoptimized
          />
        </button>
      ))}
    </div>
  );
}
