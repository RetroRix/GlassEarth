/**
 * Glass Earth — data-age / stale flags (Globe Command scout, picked by
 * Rick 2026-11-02; extends the feed-badge honesty of pipeline #2 from
 * cameras to the data cards).
 *
 * Every card that shows feed data shows how old that data is, and data
 * older than its feed's honest threshold is flagged STALE. The age is
 * always a real timestamp the app actually holds — when the fetch came
 * back, or the newest frame the feed published. A feed with no real
 * timestamp shows "AGE UNKNOWN": an age is never invented.
 *
 * Thresholds are tied to each feed's real cadence (the app's poll
 * interval and the source's own publish rhythm), with margin — a flag
 * should mean "this stopped updating", not "this is mid-cycle".
 */

export const FEED_STALE_AFTER_MS = {
  /** Page polls /api/flights every 30 s. */
  flights: 3 * 60_000,
  /** Page polls the USGS route every 15 min; USGS itself publishes ~5 min. */
  quakes: 35 * 60_000,
  /** The launches route caches Launch Library 2 server-side for ~45 min. */
  launches: 100 * 60_000,
  /** Maritime snapshots are viewport-driven; AIS positions age in minutes. */
  ships: 20 * 60_000,
  /** Page polls /api/weather every 5 min. */
  weather: 15 * 60_000,
  /** Satellites refresh with the overhead feeds. */
  satellites: 10 * 60_000,
  /** nowCOAST frames publish every ~5–10 min; 45 min means it stalled. */
  weatherImagery: 45 * 60_000,
} as const;

export type FeedKey = keyof typeof FEED_STALE_AFTER_MS;

export type DataAgeState = 'fresh' | 'stale' | 'unknown';

export interface DataAgeInfo {
  state: DataAgeState;
  /** Milliseconds since the timestamp, or null when there is no timestamp. */
  ageMs: number | null;
  /** "DATA 4M OLD" / "STALE · DATA 2H OLD" / "AGE UNKNOWN". */
  label: string;
}

export function formatAgeMs(ageMs: number): string {
  if (ageMs < 45_000) return 'JUST NOW';
  const mins = Math.round(ageMs / 60_000);
  if (mins < 60) return `${mins}M OLD`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H ${mins % 60}M OLD`.replace(' 0M OLD', ' OLD');
  return `${Math.floor(hrs / 24)}D OLD`;
}

export function describeDataAge(
  fetchedAt: number | null | undefined,
  now: number,
  staleAfterMs: number,
): DataAgeInfo {
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return { state: 'unknown', ageMs: null, label: 'AGE UNKNOWN' };
  }
  const ageMs = Math.max(0, now - fetchedAt);
  const base = ageMs < 45_000 ? 'DATA JUST NOW' : `DATA ${formatAgeMs(ageMs)}`;
  return ageMs > staleAfterMs
    ? { state: 'stale', ageMs, label: `STALE · ${base}` }
    : { state: 'fresh', ageMs, label: base };
}
