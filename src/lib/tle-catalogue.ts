import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * OSIRIS — resolving one satellite's TLE by NORAD id.
 *
 * Two consumers need this: the orbit route (a satellite's track) and the
 * Look Up tle route (the ISS element set the panel propagates passes from).
 * Both read the same catalogue the satellites route maintains — the disk
 * cache of CelesTrak TLEs — and both fall back the same way when it misses:
 * CelesTrak's per-satellite GP endpoint, then a public mirror of the same
 * data. Kept in one module so the two routes can never drift into resolving
 * the same satellite from different element sets.
 *
 * On Vercel the disk cache exists only on instances that served the
 * satellites route, so a cold instance resolves remotely — that is the
 * normal path in production, not an error.
 */

export interface Tle {
  name: string;
  line1: string;
  line2: string;
}

const CACHE_FILE = join(process.cwd(), '.next', 'cache', 'satellites-tle-cache.json');

let cache: { at: number; byNorad: Map<string, Tle> } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

/** NORAD id lives in columns 3-7 of line 1. */
function noradOf(line1: string): string {
  return line1.substring(2, 7).trim();
}

function catalogue(): Map<string, Tle> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.byNorad;
  const byNorad = new Map<string, Tle>();
  try {
    if (existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as { sats?: Tle[] };
      for (const sat of parsed.sats ?? []) {
        if (sat?.line1 && sat?.line2) byNorad.set(noradOf(sat.line1), sat);
      }
    }
  } catch {
    // A corrupt cache means no local TLEs, not a broken caller: resolution
    // falls through to the remote sources.
  }
  cache = { at: Date.now(), byNorad };
  return byNorad;
}

/** Per-satellite TLEs resolved remotely, keyed by NORAD id. A null is a
    remembered miss — but only briefly: CelesTrak throttles shared
    datacenter egress IPs intermittently, and a 30-minute negative cache
    froze those transient 403s into permanent misses for exactly the
    satellites someone had asked for during a throttle window. */
const remoteCache = new Map<string, { tle: Tle | null; at: number }>();
const REMOTE_TTL_MS = 30 * 60_000;
const REMOTE_MISS_TTL_MS = 60_000;

export function parseTleText(text: string): Tle | null {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim().length > 0);
  const i1 = lines.findIndex(l => l.startsWith('1 '));
  const i2 = lines.findIndex(l => l.startsWith('2 '));
  if (i1 < 0 || i2 <= i1) return null;
  return { name: (lines[i1 - 1] ?? '').trim(), line1: lines[i1], line2: lines[i2] };
}

async function tleFromCelesTrak(id: string): Promise<Tle | null> {
  try {
    const res = await fetch(
      `https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(id)}&FORMAT=TLE`,
      { signal: AbortSignal.timeout(12000), headers: { Accept: 'text/plain' } },
    );
    if (res.ok) return parseTleText(await res.text());
    await res.body?.cancel();
  } catch {
    // fall through to the retry / mirror
  }
  return null;
}

/** A public TLE mirror (Ivan Stanojevic's API over the same CelesTrak data).
    Its catalogue lags CelesTrak by days to weeks, so it is the last resort:
    a slightly stale TLE still propagates a recognisable orbit, while a
    miss propagates nothing. */
async function tleFromMirror(id: string): Promise<Tle | null> {
  try {
    const res = await fetch(`https://tle.ivanstanojevic.me/api/tle/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const data = await res.json();
    if (typeof data?.line1 === 'string' && typeof data?.line2 === 'string') {
      return { name: String(data.name ?? '').trim(), line1: data.line1, line2: data.line2 };
    }
  } catch {
    // mirror unreachable: the caller gets null, as for an empty catalogue
  }
  return null;
}

async function tleRemote(id: string): Promise<Tle | null> {
  const hit = remoteCache.get(id);
  if (hit && Date.now() - hit.at < (hit.tle ? REMOTE_TTL_MS : REMOTE_MISS_TTL_MS)) return hit.tle;
  let tle = await tleFromCelesTrak(id);
  if (!tle) {
    // One retry after a beat — the common failure is a throttle blip.
    await new Promise(r => setTimeout(r, 1200));
    tle = await tleFromCelesTrak(id);
  }
  if (!tle) tle = await tleFromMirror(id);
  remoteCache.set(id, { tle, at: Date.now() });
  return tle;
}

/**
 * The TLE for one NORAD id: the local catalogue first (free, instant),
 * then the remote resolution the orbit route has always used. `id` is
 * normalised the way the catalogue keys it (leading zeros dropped).
 */
export async function resolveTle(id: string): Promise<Tle | null> {
  const key = String(Number(id));
  if (!/^\d+$/.test(key)) return null;
  return catalogue().get(key) ?? (await tleRemote(key));
}
