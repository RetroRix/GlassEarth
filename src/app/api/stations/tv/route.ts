import { NextRequest, NextResponse } from 'next/server';
import { TV_CATEGORIES, TV_COUNTRIES, parseM3u } from '@/lib/stations';

/**
 * Glass Earth — TV stations directory (IPTV-org).
 *
 * One slice at a time, never the whole index: `?country=US` fetches
 * IPTV-org's published US playlist, `?category=news` its news playlist.
 * The slice is parsed server-side into channels (adult groups are dropped
 * in the parser) and cached at the edge — the directory changes on the
 * order of days, and no client should ever download a raw M3U.
 *
 * Streams themselves are NOT proxied: the browser plays them straight
 * from the broadcaster's CDN, exactly like the source site does. A stream
 * that refuses in-browser playback (CORS, referrer rules, geo) surfaces
 * in the panel as unavailable rather than being routed around.
 */

export const dynamic = 'force-dynamic';

const PLAYLIST_BASE = 'https://iptv-org.github.io/iptv';
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' };

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const country = (params.get('country') ?? '').toUpperCase();
  const category = (params.get('category') ?? '').toLowerCase();

  let url: string;
  let slice: { country?: string; category?: string };
  if (country) {
    if (!/^[A-Z]{2}$/.test(country)) {
      return NextResponse.json({ channels: [], total: 0, error: 'country must be a 2-letter code' }, { status: 400 });
    }
    url = `${PLAYLIST_BASE}/countries/${country.toLowerCase()}.m3u`;
    slice = { country };
  } else {
    const cat = TV_CATEGORIES.includes(category as (typeof TV_CATEGORIES)[number]) ? category : 'news';
    url = `${PLAYLIST_BASE}/categories/${cat}.m3u`;
    slice = { category: cat };
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GlassEarth/1.0 (https://www.glassearthlive.com)' },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { channels: [], total: 0, slice, error: `IPTV-org answered ${res.status} for this slice` },
        { status: 502, headers: CACHE_HEADERS },
      );
    }
    const channels = parseM3u(await res.text(), slice);
    return NextResponse.json(
      {
        channels,
        total: channels.length,
        slice,
        countries: TV_COUNTRIES,
        categories: TV_CATEGORIES,
        source: 'IPTV-org community playlists',
        timestamp: new Date().toISOString(),
      },
      { headers: CACHE_HEADERS },
    );
  } catch (error) {
    console.error('[GlassEarth] TV stations slice failed:', error);
    return NextResponse.json(
      { channels: [], total: 0, slice, error: 'TV directory unavailable' },
      { status: 502, headers: CACHE_HEADERS },
    );
  }
}
