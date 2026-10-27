import { NextResponse } from 'next/server';
import { capFrames, parseWmsTimes, WX_SOURCES, type WxFrames } from '@/lib/weather-imagery';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — the frame lists for the NOAA weather-imagery suite: for each
 * nowCOAST WMS layer, the instants it actually publishes, read from its
 * GetCapabilities time dimension. The browser pulls the tiles straight
 * from nowCOAST; this only carries the timestamps, so the timeline can
 * never offer a frame that does not exist.
 *
 * Source: NOAA nowCOAST GeoServer — public, no key.
 */

/** Frame caps: radar publishes ~8 h at ~4 min, GOES ~8 h at 5 min,
 *  lightning ~6 h at 15 min. The caps sit above those counts. */
const CAPS = { radar: 220, satellite: 200, lightning: 60 } as const;
const TTL_MS = 2 * 60 * 1000;

let cached: { body: { frames: WxFrames }; expiresAt: number } | null = null;

async function framesFor(key: keyof typeof CAPS): Promise<number[]> {
  const def = WX_SOURCES[key];
  const res = await fetch(`${def.wms}?service=WMS&request=GetCapabilities&version=1.3.0`, {
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`nowCOAST ${key} ${res.status}`);
  return capFrames(parseWmsTimes(await res.text(), def.layer), CAPS[key]);
}

export async function GET() {
  if (!cached || Date.now() > cached.expiresAt) {
    try {
      const [radar, satellite, lightning] = await Promise.all([
        framesFor('radar'), framesFor('satellite'), framesFor('lightning'),
      ]);
      if (!radar.length && !satellite.length && !lightning.length) throw new Error('nowCOAST: no frames');
      cached = { body: { frames: { radar, satellite, lightning } }, expiresAt: Date.now() + TTL_MS };
    } catch (e) {
      console.warn('[OSIRIS] weather-imagery:', e);
      if (!cached) return NextResponse.json({ error: 'NOAA weather imagery unavailable' }, { status: 502 });
    }
  }
  return NextResponse.json(cached.body, { headers: { 'Cache-Control': 'public, max-age=60' } });
}
