import { Brief } from './brief';
import { findBestSwatchMatch, findBestSketchMatch } from './catalog';

/**
 * Deterministically fills in `fabricFile` (from folder+color) and
 * `suggestedSketchId` (from outfitType+styleDetails/occasion) on top of a
 * patch about to be merged into `brief`. Pure, no network, no LLM.
 *
 * Shared between:
 *   - lib/extract.ts's sanitizePatch (server-side, Plan B / LLM-extracted
 *     patches from /api/extract and /api/designer/turn)
 *   - components/VoiceSession.tsx (client-side, Plan A's fully deterministic
 *     live-call loop — sarvam-30b is no longer called per utterance there)
 *
 * so both apply identical catalog-matching rules regardless of where the
 * base patch (occasion/outfitType/fabricFolder/color/styleDetails) came from.
 *
 * Never overwrites an existing value in `patch`, and never suggests a sketch
 * once the brief already has a user-set `sketchId` — a manual pick always
 * wins and is never clobbered by a suggestion.
 */
export function enrichPatchWithCatalogMatches(patch: Partial<Brief>, brief: Partial<Brief>): Partial<Brief> {
  const enriched: Partial<Brief> = { ...patch };

  if (!enriched.fabricFile) {
    const effectiveFolder = enriched.fabricFolder ?? brief.fabricFolder;
    const effectiveColor = enriched.color ?? brief.color;
    if (effectiveFolder && effectiveColor) {
      const match = findBestSwatchMatch(effectiveFolder, effectiveColor);
      if (match) {
        enriched.fabricFile = match.file;
        if (!enriched.fabricFolder) enriched.fabricFolder = effectiveFolder;
      }
    }
  }

  if (!brief.sketchId && !enriched.sketchId) {
    const effectiveOutfitType = enriched.outfitType ?? brief.outfitType;
    const effectiveStyleDetails = enriched.styleDetails ?? brief.styleDetails;
    const effectiveOccasion = enriched.occasion ?? brief.occasion;
    if (effectiveOutfitType && (effectiveStyleDetails || effectiveOccasion)) {
      const match = findBestSketchMatch(effectiveOutfitType, effectiveStyleDetails, effectiveOccasion);
      if (match) enriched.suggestedSketchId = match.id;
    }
  }

  return enriched;
}
