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
const API_BASE = 'https://iptv-org.github.io/api';
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' };

/**
 * The picker lists are IPTV-org's own, fetched from their JSON API and
 * normalised — hard-coded lists drift as they add countries and
 * categories. Any failure falls back to the snapshot in lib/stations.
 */
async function directoryMeta(): Promise<{ countries: { code: string; name: string }[]; categories: string[] }> {
  let countries = [...TV_COUNTRIES];
  let categories: string[] = [...TV_CATEGORIES];
  try {
    const res = await fetch(`${API_BASE}/countries.json`, {
      headers: { 'User-Agent': 'GlassEarth/1.0 (https://www.glassearthlive.com)' },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const raw = (await res.json()) as { code?: string; name?: string }[];
      const list = raw
        .filter(c => c.code && c.name)
        .map(c => ({ code: c.code!.toUpperCase(), name: c.name! }));
      if (list.length > countries.length) countries = list;
    }
  } catch { /* snapshot fallback stands */ }
  try {
    const res = await fetch(`${API_BASE}/categories.json`, {
      headers: { 'User-Agent': 'GlassEarth/1.0 (https://www.glassearthlive.com)' },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const raw = (await res.json()) as unknown[];
      const list = raw
        .map(c => (typeof c === 'string' ? c : (c as { id?: string; name?: string })?.id ?? (c as { name?: string })?.name ?? ''))
        .map(s => s.toLowerCase().trim())
        .filter(s => /^[a-z][a-z-]*$/.test(s) && s !== 'xxx' && !/adult/.test(s));
      if (list.length) categories = [...new Set([...list, ...categories])];
    }
  } catch { /* snapshot fallback stands */ }
  return { countries, categories };
}

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
    /* IPTV-org files the United Kingdom under its reserved ISO code 'uk',
       not 'gb' — the one exception in their country slices. */
    const fileCode = country === 'GB' ? 'uk' : country.toLowerCase();
    url = `${PLAYLIST_BASE}/countries/${fileCode}.m3u`;
    slice = { country };
  } else {
    /* Any well-formed IPTV-org category slug is a slice; the adult slug
       is the one permanent refusal. Validating against a frozen list
       would silently substitute news whenever IPTV-org adds a category. */
    const cat = /^[a-z][a-z-]*$/.test(category) && category !== 'xxx' && !/adult/.test(category) ? category : 'news';
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
    const meta = await directoryMeta();
    return NextResponse.json(
      {
        channels,
        total: channels.length,
        slice,
        countries: meta.countries,
        categories: meta.categories,
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
