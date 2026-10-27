import { NextResponse } from 'next/server';
import { resolveTle } from '@/lib/tle-catalogue';
import { findIssPasses } from '@/lib/look-up-passes';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — the next passes of one satellite over one place.
 *
 * The Look Up panel used to fetch the element set from
 * /api/satellites/tle and propagate it in the browser. It cannot:
 * satellite.js in the client bundle stalls the production build's
 * optimizer indefinitely (see lib/look-up-passes for the evidence).
 * So the panel asks here instead, and this route runs the identical
 * finder over the identical element set (lib/tle-catalogue — the same
 * resolution the orbit route uses) and returns the finished passes:
 * same times, same peak geometry, same honest Visible labelling.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get('id')?.trim();
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (!id || !/^\d{1,6}$/.test(id)) {
    return NextResponse.json({ error: 'numeric NORAD id required' }, { status: 400 });
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'observer lat/lng required' }, { status: 400 });
  }

  const tle = await resolveTle(id);
  if (!tle) {
    return NextResponse.json({ error: 'not in catalogue', noradId: id }, { status: 404 });
  }

  const passes = findIssPasses(tle.line1, tle.line2, { lat, lng }, { count: 3 });
  return NextResponse.json({
    noradId: String(Number(id)),
    name: tle.name,
    passes: passes.map(p => ({
      riseAt: p.riseAt.toISOString(),
      peakAt: p.peakAt.toISOString(),
      setAt: p.setAt.toISOString(),
      peakElevationDeg: p.peakElevationDeg,
      peakAzimuthDeg: p.peakAzimuthDeg,
      visible: p.visible,
    })),
  }, {
    // Pass times are fixed once computed; a minute of shared cache keeps
    // every visitor at the same anchor off the propagator.
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
  });
}
