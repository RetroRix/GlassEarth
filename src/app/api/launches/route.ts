import { NextResponse } from 'next/server';
import { groupSites, transformLaunches, type LaunchRecord, type LaunchSite } from '@/lib/launches';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — rocket launches from Launch Library 2 (The Space Devs,
 * ll.thespacedevs.com). The keyless free tier is real but throttled
 * hard (observed 429s at a handful of requests from one IP), so the
 * browser NEVER calls it: this route polls server-side — upcoming
 * (limit 100, soonest first) + previous (limit 25, most recent first) —
 * and caches the merged window (next ~30 days + recent ~7 days) for
 * 45 minutes. On an upstream failure the last good body is served
 * stale rather than nothing; with no cache at all, an honest 502.
 * Launches don't move faster than this cadence; countdowns tick
 * client-side from the NET the feed carries.
 */

const UPCOMING_URL = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=100';
const PREVIOUS_URL = 'https://ll.thespacedevs.com/2.2.0/launch/previous/?limit=25';
const TTL_MS = 45 * 60 * 1000;

interface LaunchesBody {
  launches: LaunchRecord[];
  sites: LaunchSite[];
  counts: { launches: number; sites: number };
  generatedAt: string;
}

let cached: { body: LaunchesBody; expiresAt: number } | null = null;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
    headers: { 'User-Agent': 'GlassEarth/1.0 (glassearthlive.com)' },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export async function GET() {
  if (!cached || Date.now() > cached.expiresAt) {
    try {
      const [upcoming, previous] = await Promise.all([
        getJson(UPCOMING_URL),
        getJson(PREVIOUS_URL).catch(() => null),
      ]);
      const launches = transformLaunches(upcoming, previous, Date.now());
      const sites = groupSites(launches);
      cached = {
        body: {
          launches,
          sites,
          counts: { launches: launches.length, sites: sites.length },
          generatedAt: new Date().toISOString(),
        },
        expiresAt: Date.now() + TTL_MS,
      };
    } catch (e) {
      console.warn('[OSIRIS] launches:', e);
      if (!cached) return NextResponse.json({ error: 'Launch data unavailable' }, { status: 502 });
    }
  }
  return NextResponse.json(cached.body, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
