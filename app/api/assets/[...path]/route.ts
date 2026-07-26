import { NextRequest, NextResponse } from 'next/server';

/**
 * Same-origin proxy for the diyo-assets GCS bucket.
 *
 * The bucket's CORS policy only allows the diyo.in origin, so the browser can
 * never fetch storage.googleapis.com directly from localhost. Every image URL
 * in this app's UI must be built with lib/catalog.ts's assetProxyUrl() (or one
 * of its helpers), which routes through here instead.
 */

export async function GET(_request: NextRequest, context: RouteContext<'/api/assets/[...path]'>) {
  const { path } = await context.params;
  const joined = path.join('/');

  const base = process.env.ASSETS_BASE_URL;
  if (!base) {
    return NextResponse.json({ error: 'ASSETS_BASE_URL is not configured' }, { status: 500 });
  }

  const upstreamUrl = `${base.replace(/\/$/, '')}/${joined}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl);
  } catch {
    return NextResponse.json({ error: 'Failed to reach upstream asset host' }, { status: 502 });
  }

  if (upstream.status === 404) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Upstream error (${upstream.status})` }, { status: upstream.status });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
