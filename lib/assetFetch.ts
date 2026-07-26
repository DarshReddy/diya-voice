/**
 * Server-side-only fetch of a diyo-assets GCS object as base64, for feeding
 * into the Vertex AI image-generation call (lib/vertexImage.ts wants inline
 * base64 image data, not a URL). Distinct from app/api/assets/[...path]'s
 * proxy, which streams bytes back to the browser — this never touches the
 * client, it's an internal server-to-GCS fetch.
 *
 * `redirect: 'error'` is a deliberate SSRF guard (matches diyo-app's
 * reference implementation) — a follow-any-redirect fetch server-side is
 * how one class of image-input bugs happened there.
 */
export interface FetchedAsset {
  mimeType: string;
  base64: string;
}

export async function fetchAssetBase64(path: string): Promise<FetchedAsset> {
  const base = process.env.ASSETS_BASE_URL;
  if (!base) throw new Error('ASSETS_BASE_URL is not configured');

  const url = `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const res = await fetch(url, { redirect: 'error' });

  if (!res.ok) {
    throw new Error(`Failed to fetch asset "${path}" (${res.status})`);
  }

  const mimeType = res.headers.get('content-type') ?? 'image/webp';
  const buffer = Buffer.from(await res.arrayBuffer());

  return { mimeType, base64: buffer.toString('base64') };
}
