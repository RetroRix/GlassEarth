/**
 * Glass Earth — the header counter strip's numbers.
 *
 * Every count here is derived from data the app has already loaded for its
 * own layers — nothing is fetched for the strip's sake, and nothing is
 * invented. A metric whose source data has not arrived (or whose feed is
 * off) comes back null, and the strip hides that metric rather than
 * dressing a guess up as a number.
 */

export interface LiveCountsData {
  commercial_flights?: unknown;
  private_flights?: unknown;
  private_jets?: unknown;
  military_flights?: unknown;
  satellites?: unknown;
  cameras?: unknown;
  earthquakes?: unknown;
}

export interface LiveCounts {
  /** All four flight buckets the app tracks, summed. */
  aircraft: number | null;
  satellites: number | null;
  cameras: number | null;
  /** Quakes in the trailing 24 hours — the USGS day feed's own window. */
  quakes24h: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/* A quake timestamped a few minutes in the future is clock skew at the
   source, not a prediction; tolerate it rather than dropping the event. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function lengthOf(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

export function deriveLiveCounts(data: LiveCountsData | null | undefined, now: number): LiveCounts {
  const source = data ?? {};

  /* Aircraft: the same four buckets the rest of the app sums. If none of
     them has ever arrived there is nothing honest to show; once any bucket
     exists, the buckets that exist are the count. */
  const buckets = [
    lengthOf(source.commercial_flights),
    lengthOf(source.private_flights),
    lengthOf(source.private_jets),
    lengthOf(source.military_flights),
  ];
  const present = buckets.filter((n): n is number => n !== null);
  const aircraft = present.length ? present.reduce((sum, n) => sum + n, 0) : null;

  let quakes24h: number | null = null;
  if (Array.isArray(source.earthquakes)) {
    quakes24h = 0;
    for (const quake of source.earthquakes) {
      const time = (quake as { time?: unknown } | null)?.time;
      if (typeof time === 'number' && Number.isFinite(time)
        && time >= now - DAY_MS && time <= now + FUTURE_TOLERANCE_MS) {
        quakes24h += 1;
      }
    }
  }

  return {
    aircraft,
    satellites: lengthOf(source.satellites),
    cameras: lengthOf(source.cameras),
    quakes24h,
  };
}
