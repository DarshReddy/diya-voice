/**
 * Thin, server-only wrapper around Vertex AI's Gemini image-generation model
 * via the `@google/genai` SDK. Pattern reimplemented from diyo-app's
 * lib/services/imageGenerationService.ts (read-only reference — not
 * imported, diya-voice is a standalone repo) with the caching/rate-limiting
 * layers stripped out (not needed for a single-demo hackathon app), plus a
 * simple in-flight de-dup at the route level instead (app/api/preview).
 *
 * Auth: the SDK's `googleAuthOptions.credentials` is handed a parsed service
 * account JSON object; it internally mints/refreshes Vertex OAuth2 tokens —
 * no manual token minting needed. GCP_SERVICE_ACCOUNT_KEY_JSON in this repo
 * is base64-encoded (confirmed by trying to JSON.parse it directly and
 * getting invalid-JSON, then base64-decoding first, which parses cleanly) —
 * this tries raw JSON first, then base64, matching diyo-app's own loader.
 *
 * Request shape: images are inline base64 (`inlineData`), each preceded by
 * a short text label so the model resolves "which image is which" via
 * adjacent text→image pairs rather than positional references — this is
 * the one correctness-critical detail from the reference implementation's
 * code comments (multimodal editing models follow this far more reliably).
 * The main instruction text is the LAST part.
 *
 * Response: the generated image is NOT a top-level convenience field — scan
 * `candidates[0].content.parts[]` for the part with `inlineData.data`.
 */
import { GoogleGenAI, Modality } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;

function parseServiceAccountKey(raw: string): Record<string, unknown> {
  for (const candidate of [raw, Buffer.from(raw, 'base64').toString('utf8')]) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (parsed?.client_email && parsed?.private_key) return parsed;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('GCP_SERVICE_ACCOUNT_KEY_JSON could not be parsed as JSON (tried raw and base64-decoded)');
}

function getClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;

  const projectId = process.env.GCP_PROJECT_ID;
  const rawKey = process.env.GCP_SERVICE_ACCOUNT_KEY_JSON;
  if (!projectId) throw new Error('GCP_PROJECT_ID is not configured');
  if (!rawKey) throw new Error('GCP_SERVICE_ACCOUNT_KEY_JSON is not configured');

  const credentials = parseServiceAccountKey(rawKey);
  const location = process.env.VERTEX_AI_LOCATION ?? 'global';

  cachedClient = new GoogleGenAI({
    vertexai: true,
    project: projectId,
    location,
    googleAuthOptions: { credentials },
  });
  return cachedClient;
}

export interface ImageInput {
  /** Short text immediately preceding this image, telling the model what it is / how to use it. */
  label: string;
  mimeType: string;
  base64: string;
}

const RENDERING_INSTRUCTIONS =
  'Render a clean, professional product-style photograph of only this garment — a flat-lay or ghost-mannequin style product shot on a plain neutral background. No real person, no face, no model wearing it.';

/**
 * Generates a garment preview image. `images` may be empty (proceeds from
 * text alone), contain just a fabric swatch, or a sketch + swatch pair.
 * Returns the raw base64 PNG (no data-URI prefix).
 */
export async function generateGarmentImage(images: ImageInput[], promptText: string): Promise<string> {
  const ai = getClient();
  const model = process.env.VERTEX_AI_MODEL ?? 'gemini-3.1-flash-image-preview';

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  for (const img of images) {
    parts.push({ text: img.label });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }
  parts.push({ text: `${promptText}\n\n${RENDERING_INSTRUCTIONS}` });

  const result = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
  });

  const responseParts = result.candidates?.[0]?.content?.parts ?? [];
  const imagePart = responseParts.find((part) => Boolean(part.inlineData?.data));

  if (!imagePart?.inlineData?.data) {
    const finishReason = result.candidates?.[0]?.finishReason;
    const blockReason = result.promptFeedback?.blockReason;
    throw new Error(
      `Vertex AI returned no image data (finishReason=${finishReason ?? 'n/a'}, blockReason=${blockReason ?? 'n/a'})`
    );
  }

  return imagePart.inlineData.data;
}
