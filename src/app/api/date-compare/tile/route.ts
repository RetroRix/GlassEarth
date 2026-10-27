import { gibsTileUrl, parseDcTileParams } from '@/lib/date-compare';

/**
 * GET/HEAD /api/date-compare/tile?l=s30|l30&d=YYYY-MM-DD&z=&x=&y=
 *
 * The one hop between the browser and NASA GIBS. The browser asks us;
 * we ask GIBS (fixed host, allowlisted layers — see parseDcTileParams)
 * and pass the answer through untouched, including the
 * `layer-time-actual` header the client probe treats as ground truth
 * for "this date really imaged this tile". A no-pass tile comes back
 * from GIBS as a tiny transparent PNG with NO such header; an
 * out-of-range date as a 404 — both pass through as-is, so the map and
 * the probe see exactly what GIBS said. Dated tiles are immutable, so
 * real imagery caches hard; blanks cache briefly.
 */

export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  const params = parseDcTileParams(new URL(req.url).searchParams);
  if (!params) return new Response('bad tile params', { status: 400 });
  let upstream: Response;
  try {
    upstream = await fetch(gibsTileUrl(params.sensor, params.date, params.z, params.x, params.y), {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'GlassEarth/1.0 (date-compare)' },
    });
  } catch {
    return new Response('gibs unreachable', { status: 502 });
  }
  const headers = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  const actual = upstream.headers.get('layer-time-actual');
  if (actual) headers.set('layer-time-actual', actual);
  headers.set(
    'cache-control',
    upstream.ok && actual ? 'public, max-age=86400, immutable' : 'public, max-age=600',
  );
  return new Response(req.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export const GET = handle;
export const HEAD = handle;
