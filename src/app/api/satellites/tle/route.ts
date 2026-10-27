import { NextResponse } from 'next/server';
import { resolveTle } from '@/lib/tle-catalogue';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — one satellite's TLE, for client-side propagation.
 *
 * The Look Up panel predicts ISS passes in the browser, with the same
 * satellite.js propagation (lib/orbit) the server uses for positions and
 * tracks. It needs the element set itself — two lines — resolved exactly
 * the way the orbit route resolves it: lib/tle-catalogue, the same
 * catalogue, the same fallbacks. No new source is introduced; this route
 * only hands over what the catalogue already holds.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get('id')?.trim();
  if (!id || !/^\d{1,6}$/.test(id)) {
    return NextResponse.json({ error: 'numeric NORAD id required' }, { status: 400 });
  }

  const tle = await resolveTle(id);
  if (!tle) {
    return NextResponse.json({ error: 'not in catalogue', noradId: id }, { status: 404 });
  }

  return NextResponse.json({
    noradId: String(Number(id)),
    name: tle.name,
    line1: tle.line1,
    line2: tle.line2,
  }, {
    // An element set changes a few times a day at most; the panel refetches
    // on open if its copy is older than an hour anyway.
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
  });
}
