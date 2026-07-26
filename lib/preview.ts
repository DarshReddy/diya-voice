import { composeImagePrompt, TranscriptLine, PromptFields } from './composePrompt';
import { fetchAssetBase64 } from './assetFetch';
import { generateGarmentImage, ImageInput } from './vertexImage';
import { Brief } from './brief';

export interface PreviewResult {
  imageBase64: string;
  prompt: string;
  promptFields: PromptFields;
}

/**
 * Full preview pipeline for /api/preview: compose the image-generation
 * prompt (same logic /api/compose-prompt uses, called directly rather than
 * over HTTP — no reason to make the client do two round trips), fetch the
 * chosen sketch + swatch images from GCS server-side, and hand both to
 * Vertex AI's Gemini image model in one call.
 *
 * A user's manual sketchId always wins over the deterministic
 * suggestedSketchId (same rule as everywhere else in this app); if neither
 * is set, or the image fetch fails, generation proceeds without a sketch —
 * same for the swatch. Only a hard failure of the actual Vertex call itself
 * propagates as an error.
 */
export async function generatePreview(brief: Partial<Brief>, transcript: TranscriptLine[]): Promise<PreviewResult> {
  const { prompt, promptFields } = await composeImagePrompt(brief, transcript);

  const images: ImageInput[] = [];
  const chosenSketchId = brief.sketchId ?? brief.suggestedSketchId;

  if (chosenSketchId && brief.outfitType) {
    try {
      const path =
        brief.outfitType === 'coord-sets'
          ? `outfits/coord-sets/${chosenSketchId}.webp`
          : `outfits/${brief.outfitType}/${chosenSketchId}/sketch.webp`;
      const sketch = await fetchAssetBase64(path);
      images.push({
        label:
          "This is the garment's sketch/reference image — use it for the garment's structure, silhouette, neckline, sleeves, and construction details (not for color).",
        ...sketch,
      });
    } catch (err) {
      console.warn('[preview] failed to fetch sketch/reference image, continuing without it:', err);
    }
  }

  if (brief.fabricFolder && brief.fabricFile) {
    try {
      const swatch = await fetchAssetBase64(`fabrics/${brief.fabricFolder}/${brief.fabricFile}`);
      images.push({
        label:
          'This is the fabric swatch — use it for the exact fabric color, sheen, and texture (not for the shape of the garment).',
        ...swatch,
      });
    } catch (err) {
      console.warn('[preview] failed to fetch swatch image, continuing without it:', err);
    }
  }

  const imageBase64 = await generateGarmentImage(images, prompt);
  return { imageBase64, prompt, promptFields };
}
