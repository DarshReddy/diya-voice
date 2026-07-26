/**
 * Catalog data plumbing for Diya Voice.
 *
 * All three JSON files under lib/data/ are copied verbatim from diyo-app
 * (lib/data/*.json) — they are NOT imported across repos, just duplicated,
 * since this is a standalone hackathon app.
 *
 * CONFIRMED GCS ASSET PATHS (verified by curling storage.googleapis.com/diyo-assets/...
 * directly while building this app — see app/api/assets/[...path]/route.ts for the
 * server-side proxy that makes these fetchable from localhost, since the bucket's
 * CORS policy only allows the diyo.in origin):
 *
 *   - Fabric manifest:   fabrics/manifest.json
 *       -> flat Record<folderSlug, string[]> of swatch filenames (plus two
 *          reserved non-folder keys, __trending and __section_order, which this
 *          app ignores). folderSlug here is the FABRIC_FOLDERS `value`, e.g. "satin".
 *   - Fabric swatch:     fabrics/<folderSlug>/<file>
 *       -> matches the `folder`/`file` fields in swatch-labels.json exactly.
 *   - Add-on swatches:   fabrics/add-ons/<file>
 *       -> swatch-labels.json entries with folder === "add-ons".
 *   - Sketch image:      outfits/<category>/<id>/sketch.webp
 *       -> category is one of the 7 sketch-labels.json categories (all outfit
 *          categories except coord-sets, which has no per-item sketch), id is
 *          lowercase e.g. "d-1", "j-1", "sd-1", "s-1", "sh-1", "t-1", "p-1".
 *          NOTE: this is NOT under an "assets/" prefix — the spec's suggested
 *          "assets/sketches/<category>/<id>.webp" 404s; the real prefix is
 *          "outfits/<category>/<id>/sketch.webp".
 *   - Sketch reference:  outfits/<category>/<id>/reference-1.webp
 *       -> a photographed reference image for the same sketch id.
 *   - Coord-set manifest: outfits/coord-sets/manifest.json
 *       -> { count: number, images: string[] } where images are filenames like
 *          "1.webp".."177.webp" whose numeric stem matches coord-set-labels.json
 *          `id` directly (id 1 -> "1.webp").
 *   - Coord-set photo:   outfits/coord-sets/<id>.webp
 *       -> e.g. outfits/coord-sets/1.webp for coord-set id 1. There is no
 *          per-coord-set sketch; the same photo doubles as sketch + reference.
 *
 * All of the above are fetched server-side through /api/assets/[...path], which
 * proxies ASSETS_BASE_URL + "/" + path — so UI code should build paths like
 * `/api/assets/fabrics/satin/foo.jpg` rather than hitting GCS directly.
 */

import swatchLabelsData from './data/swatch-labels.json';
import coordSetLabelsData from './data/coord-set-labels.json';
import sketchLabelsData from './data/sketch-labels.json';

// ---------------------------------------------------------------------------
// Outfit categories (8 slugs) — recreated from diyo-app's OutfitCategory type
// and the sketch-labels/coord-set-labels category coverage.
// ---------------------------------------------------------------------------

export const OUTFIT_CATEGORIES = [
  'maxi-dresses',
  'short-dresses',
  'jumpsuits',
  'skirts',
  'tops',
  'pants',
  'shorts',
  'coord-sets',
] as const;

export type OutfitCategory = (typeof OUTFIT_CATEGORIES)[number];

export const OUTFIT_CATEGORY_LABELS: Record<OutfitCategory, string> = {
  'maxi-dresses': 'Maxi Dresses',
  'short-dresses': 'Short Dresses',
  jumpsuits: 'Jumpsuits',
  skirts: 'Skirts',
  tops: 'Tops',
  pants: 'Pants',
  shorts: 'Shorts',
  'coord-sets': 'Co-ord Sets',
};

export function isOutfitCategory(value: string): value is OutfitCategory {
  return (OUTFIT_CATEGORIES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Fabric folders (9 slugs) — recreated from diyo-app's lib/constants/fabrics.ts
// FABRIC_FOLDERS, dropping the fields (visualGradient) this app doesn't need.
// ---------------------------------------------------------------------------

export interface FabricFolder {
  slug: string;
  label: string;
  promptDescriptor: string;
}

export const FABRIC_FOLDERS: FabricFolder[] = [
  {
    slug: 'instantly-available',
    label: 'Instantly Available',
    promptDescriptor: 'fabric from the instantly available stock collection',
  },
  {
    slug: 'plain',
    label: 'Plain',
    promptDescriptor: 'solid plain fabric with a clean matte finish',
  },
  {
    slug: 'checks',
    label: 'Checks',
    promptDescriptor: 'fabric with a classic checked geometric pattern',
  },
  {
    slug: 'stripes',
    label: 'Stripes',
    promptDescriptor: 'fabric with clean parallel stripe pattern',
  },
  {
    slug: 'small-prints',
    label: 'Small Prints',
    promptDescriptor: 'fabric with fine small-scale printed pattern motifs',
  },
  {
    slug: 'floral-cotton',
    label: 'Floral Cotton',
    promptDescriptor: 'floral printed cotton with botanical motifs and natural texture',
  },
  {
    slug: 'georgette-floral',
    label: 'Georgette Floral',
    promptDescriptor: 'fluid georgette with elegant floral print pattern',
  },
  {
    slug: 'organza',
    label: 'Organza',
    promptDescriptor: 'crisp organza with structured volume and subtle sheen',
  },
  {
    slug: 'satin',
    label: 'Satin',
    promptDescriptor: 'lustrous satin with glossy reflective highlights',
  },
];

export const FABRIC_FOLDER_SLUGS = FABRIC_FOLDERS.map((f) => f.slug);

export function getFabricFolder(slug: string): FabricFolder | undefined {
  return FABRIC_FOLDERS.find((f) => f.slug === slug);
}

// ---------------------------------------------------------------------------
// Typed loaders for the three copied JSON files.
// ---------------------------------------------------------------------------

export interface SwatchLabel {
  folder: string;
  file: string;
  color: string;
  family: string;
  tone: string;
  pattern: string;
}

export function getSwatchLabels(): SwatchLabel[] {
  return (swatchLabelsData as { swatches: SwatchLabel[] }).swatches;
}

export function getSwatchesByFolder(folder: string): SwatchLabel[] {
  return getSwatchLabels().filter((s) => s.folder === folder);
}

/** Validate a folder/file pair is a real swatch; returns the label or null. */
export function findSwatch(folder: string, file: string): SwatchLabel | null {
  return getSwatchLabels().find((s) => s.folder === folder && s.file === file) ?? null;
}

export interface CoordSetLabel {
  id: number;
  top: string;
  bottom: string;
  colors: string[];
  print: string;
  vibe: string;
  occasions: string[];
}

export function getCoordSetLabels(): CoordSetLabel[] {
  return (coordSetLabelsData as { coordSets: CoordSetLabel[] }).coordSets;
}

export function findCoordSet(id: number): CoordSetLabel | null {
  return getCoordSetLabels().find((c) => c.id === id) ?? null;
}

/**
 * The copied coord-set-labels.json data (garment descriptions like "bottom")
 * occasionally uses the word "tailored" as a plain fashion adjective (e.g.
 * "tailored shorts"). Diya Voice's branding must never surface the
 * word "tailor" anywhere, including in copied-data display text, so this
 * swaps it for a neutral synonym before anything reaches the UI.
 */
export function sanitizeDisplayText(text: string): string {
  return text.replace(/\btailored\b/gi, 'structured').replace(/\btailor\b/gi, 'designer');
}

export interface SketchLabel {
  id: string;
  category: string;
  garment: string;
  neckline: string;
  sleeves: string;
  length: string;
  silhouette: string;
  waist: string;
  details: string[];
  back: string;
  styleTags: string[];
  occasions: string[];
  suggestedName: string;
  existingName: string;
  nameMismatch: boolean;
}

export function getSketchLabels(): SketchLabel[] {
  return (sketchLabelsData as { sketches: SketchLabel[] }).sketches;
}

export function getSketchesByCategory(category: string): SketchLabel[] {
  return getSketchLabels().filter((s) => s.category === category);
}

export function findSketch(id: string): SketchLabel | null {
  return getSketchLabels().find((s) => s.id === id) ?? null;
}

/** Display name for a sketch — always suggestedName, per spec (never existingName). */
export function sketchDisplayName(sketch: SketchLabel): string {
  return sketch.suggestedName;
}

// ---------------------------------------------------------------------------
// Asset URL builders — all go through the local /api/assets proxy.
// ---------------------------------------------------------------------------

export function assetProxyUrl(path: string): string {
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  return `/api/assets/${normalized}`;
}

export function fabricManifestUrl(): string {
  return assetProxyUrl('fabrics/manifest.json');
}

export function fabricSwatchUrl(folder: string, file: string): string {
  return assetProxyUrl(`fabrics/${folder}/${file}`);
}

export function sketchImageUrl(category: string, id: string): string {
  return assetProxyUrl(`outfits/${category}/${id}/sketch.webp`);
}

export function sketchReferenceUrl(category: string, id: string): string {
  return assetProxyUrl(`outfits/${category}/${id}/reference-1.webp`);
}

export function coordSetManifestUrl(): string {
  return assetProxyUrl('outfits/coord-sets/manifest.json');
}

export function coordSetImageUrl(id: number): string {
  return assetProxyUrl(`outfits/coord-sets/${id}.webp`);
}

// ---------------------------------------------------------------------------
// Compact catalog card for the LLM system prompt (extract route).
// ---------------------------------------------------------------------------

/** Distinct color names per fabric folder, derived from swatch-labels.json. */
export function colorsByFolder(): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const s of getSwatchLabels()) {
    if (!out[s.folder]) out[s.folder] = new Set();
    out[s.folder].add(s.color);
  }
  const result: Record<string, string[]> = {};
  for (const [folder, colors] of Object.entries(out)) {
    result[folder] = Array.from(colors).sort();
  }
  return result;
}

/** Builds a compact plain-text catalog description for use in an LLM system prompt. */
export function buildCatalogCard(): string {
  const colors = colorsByFolder();
  const lines: string[] = [];

  lines.push('Outfit categories (western wear only):');
  for (const cat of OUTFIT_CATEGORIES) {
    lines.push(`  - ${cat}: ${OUTFIT_CATEGORY_LABELS[cat]}`);
  }

  lines.push('');
  lines.push('Fabric folders:');
  for (const folder of FABRIC_FOLDERS) {
    const folderColors = colors[folder.slug];
    const colorList = folderColors && folderColors.length ? ` (colors available: ${folderColors.join(', ')})` : '';
    lines.push(`  - ${folder.slug}: ${folder.promptDescriptor}${colorList}`);
  }

  return lines.join('\n');
}

/**
 * Deterministically finds the swatch in `folder` whose color name best matches
 * free-text `colorText` (word-overlap scoring). Used instead of asking the LLM
 * to guess an exact swatch filename — the reasoning overhead of listing all 71
 * filenames in the prompt was blowing past the account's 4096 max_tokens
 * ceiling for sarvam-30b. Returns null if no word overlap is found at all.
 */
export function findBestSwatchMatch(folder: string, colorText: string): SwatchLabel | null {
  const swatches = getSwatchesByFolder(folder);
  if (swatches.length === 0) return null;

  const needleWords = colorText
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (needleWords.length === 0) return null;

  let best: SwatchLabel | null = null;
  let bestScore = 0;

  for (const s of swatches) {
    const hayWords = new Set(s.color.toLowerCase().split(/[^a-z]+/).filter(Boolean));
    let score = 0;
    for (const w of needleWords) {
      if (hayWords.has(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  return bestScore > 0 ? best : null;
}
