import { NextResponse } from 'next/server';
import { isRateLimited, getClientIp } from '@/lib/ssrf-guard';
import { ALLOWED_TYPES, cleanText, normalizeId, resolveEntity, wdCache } from '@/lib/intel';

export const dynamic = 'force-dynamic';
// A cold resolve fans out to Wikidata/RIPEstat; the IP path's four lookups
// now run in parallel, but a slow SPARQL still needs the headroom.
export const maxDuration = 60;

/**
 * Entity graph expansion — resolved in-process by `@/lib/intel`.
 *
 * This route used to proxy to a separate Express service (osiris-intel,
 * `intel/` in the repo) at INTEL_URL. That service was never deployed
 * alongside the Vercel app, so every call 502'd. The resolvers are
 * framework-free and keyless, so they were ported into the app itself;
 * the response shape and cache semantics are the sidecar's, unchanged.
 */

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get('type') || '').toLowerCase().trim();
  const rawId = (searchParams.get('id') || '').trim();

  if (!type || !ALLOWED_TYPES.has(type)) {
    return NextResponse.json(
      { error: `Invalid type. Allowed: ${[...ALLOWED_TYPES].join(', ')}` },
      { status: 400 },
    );
  }
  if (!rawId || rawId.length < 2 || rawId.length > 200) {
    return NextResponse.json({ error: 'Invalid id (2-200 chars)' }, { status: 400 });
  }

  const id = normalizeId(type, rawId);
  if (!id || id.length < 2) {
    return NextResponse.json(
      { error: type === 'ip' ? 'Not an IPv4 or IPv6 address' : 'ID contains too many invalid characters' },
      { status: 400 },
    );
  }

  try {
    // Extra aircraft properties, as the map's entity clicks supply them.
    const props: { registration?: string; model?: string; icao24?: string } = {};
    const registration = searchParams.get('registration');
    const model = searchParams.get('model');
    const icao24 = searchParams.get('icao24');
    if (registration) props.registration = normalizeId('aircraft', registration) || '';
    if (model) props.model = cleanText(model).slice(0, 100);
    if (icao24) props.icao24 = normalizeId('aircraft', icao24) || '';

    const result = await resolveEntity(type, id, props);
    return NextResponse.json(
      {
        nodes: result.nodes,
        links: result.links,
        degraded: result.degraded,
        entity: { type, id },
        source: 'OSIRIS Intelligence Layer',
        wikidata_cache_hits: wdCache.size,
        timestamp: new Date().toISOString(),
      },
      {
        // A partial graph (a provider did not answer) must not sit in a shared cache for an hour.
        headers: { 'Cache-Control': result.degraded ? 'no-store' : 'public, s-maxage=3600, stale-while-revalidate=7200' },
      },
    );
  } catch (e) {
    console.error('[OSIRIS] Intel resolve error:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'Resolution failed', nodes: [], links: [] },
      { status: 500 },
    );
  }
}
