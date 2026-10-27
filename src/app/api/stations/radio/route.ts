import { NextRequest, NextResponse } from 'next/server';
import { normalizeRadioStations } from '@/lib/stations';

/**
 * Glass Earth — radio stations directory (Radio Browser).
 *
 * Radio Browser is a free, keyless community database. It asks clients to
 * resolve a real API host instead of hammering one mirror, so this route
 * does the DNS discovery dance (all.api.radio-browser.info/json/servers),
 * caches the host list, and falls back through known mirrors. Requests
 * carry a descriptive User-Agent per their fair-use policy.
 *
 * Playback is direct: the browser streams from the station's own server
 * using `url_resolved`. Nothing is proxied — including plain-http streams,
 * which the browser will refuse on this https app; the panel marks those
 * unavailable instead of hiding the problem.
 *
 * `?click=<uuid>` registers a click with Radio Browser (their popularity
 * signal) and answers { ok }.
 */

export const dynamic = 'force-dynamic';

const UA = 'GlassEarth/1.0 (https://www.glassearthlive.com)';
const FALLBACK_HOSTS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'nl1.api.radio-browser.info'];
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' };

let hostCache: { hosts: string[]; at: number } | null = null;

async function apiHosts(): Promise<string[]> {
  if (hostCache && Date.now() - hostCache.at < 3_600_000) return hostCache.hosts;
  try {
    const res = await fetch('https://all.api.radio-browser.info/json/servers', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const servers = (await res.json()) as { name?: string }[];
      const hosts = servers.map(s => s.name).filter((n): n is string => Boolean(n));
      if (hosts.length) {
        hostCache = { hosts, at: Date.now() };
        return hosts;
      }
    }
  } catch { /* discovery failed — fall through to the mirrors */ }
  return FALLBACK_HOSTS;
}

async function radioFetch(path: string): Promise<unknown> {
  let lastError: unknown = null;
  for (const host of await apiHosts()) {
    try {
      const res = await fetch(`https://${host}/json/${path}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) return await res.json();
      lastError = new Error(`${host} answered ${res.status}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('no Radio Browser host answered');
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  const click = params.get('click');
  if (click) {
    try {
      await radioFetch(`url/${encodeURIComponent(click)}`);
      return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return NextResponse.json({ ok: false }, { headers: { 'Cache-Control': 'no-store' } });
    }
  }

  const mode = params.get('mode') ?? 'top';
  const q = (params.get('q') ?? '').trim();
  const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '60', 10) || 60, 1), 200);
  const common = 'hidebroken=true';

  let path: string;
  switch (mode) {
    case 'country':
      /* A 2-letter code goes to the exact-code endpoint (Radio Browser's
         robust path — the exact-name endpoint returned zero for the
         United States in live testing); anything else is a name search. */
      path = /^[A-Za-z]{2}$/.test(q)
        ? `stations/bycountrycodeexact/${encodeURIComponent(q.toLowerCase())}?${common}&order=votes&reverse=true&limit=${limit}`
        : `stations/bycountry/${encodeURIComponent(q)}?${common}&order=votes&reverse=true&limit=${limit}`;
      break;
    case 'tag':
      path = `stations/bytag/${encodeURIComponent(q.toLowerCase())}?${common}&order=votes&reverse=true&limit=${limit}`;
      break;
    case 'search':
      path = `stations/search?name=${encodeURIComponent(q)}&${common}&order=votes&reverse=true&limit=${limit}`;
      break;
    case 'tuner':
      /* The Radio Tuner dial needs the widest coordinate-bearing pool the
         directory offers: the top-voted 6,000 (the geo filter below cuts
         it to the stations that actually carry coordinates). */
      path = `stations/topvote/6000?${common}`;
      break;
    case 'top':
    default:
      path = `stations/topvote/${limit}?${common}`;
      break;
  }

  try {
    const all = normalizeRadioStations(await radioFetch(path));
    /* The dial is coordinate-bearing stations only; the panel modes keep
       the full slice (coordinate-less stations stay panel-playable). */
    const stations = mode === 'tuner'
      ? all.filter(s => s.lat !== undefined && s.lng !== undefined)
      : all;
    return NextResponse.json(
      { stations, total: stations.length, mode, source: 'Radio Browser', timestamp: new Date().toISOString() },
      { headers: CACHE_HEADERS },
    );
  } catch (error) {
    console.error('[GlassEarth] Radio Browser query failed:', error);
    return NextResponse.json(
      { stations: [], total: 0, mode, error: 'Radio directory unavailable' },
      { status: 502, headers: CACHE_HEADERS },
    );
  }
}
