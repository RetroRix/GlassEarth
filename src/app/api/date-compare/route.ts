import { NextResponse } from 'next/server';
import { isoDay, parseGibsLatest } from '@/lib/date-compare';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — the newest date each NASA HLS layer publishes, read from the
 * GIBS WMTS capabilities' Time dimensions. The browser pulls the tiles
 * (and their availability headers) straight from GIBS; this only carries
 * the calendar, so the date-compare window ends at a date that exists.
 *
 * Source: NASA GIBS (Earthdata) — public domain, no key. The document
 * is ~6 MB, so it is fetched rarely and only the two dates leave here.
 */

const CAPS_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities';
const TTL_MS = 6 * 60 * 60 * 1000;

let cached: { body: { latest: { s30: string; l30: string } }; expiresAt: number } | null = null;

async function latestDates(): Promise<{ s30: string; l30: string }> {
  const res = await fetch(CAPS_URL, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`GIBS capabilities ${res.status}`);
  const xml = await res.text();
  const s30 = parseGibsLatest(xml, 's30');
  const l30 = parseGibsLatest(xml, 'l30');
  if (!s30 || !l30) throw new Error('GIBS capabilities: HLS layers missing');
  return { s30, l30 };
}

export async function GET() {
  if (!cached || Date.now() > cached.expiresAt) {
    try {
      cached = { body: { latest: await latestDates() }, expiresAt: Date.now() + TTL_MS };
    } catch (e) {
      console.warn('[OSIRIS] date-compare:', e);
      if (!cached) {
        // HLS trails today by ~2 days; if GIBS cannot be read at all,
        // offer that estimate — the client's per-tile probes still
        // decide what is actually shown, and label it truthfully.
        const estimate = isoDay(Date.now() - 2 * 86_400_000);
        return NextResponse.json({ latest: { s30: estimate, l30: estimate }, estimated: true });
      }
    }
  }
  return NextResponse.json(cached.body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
