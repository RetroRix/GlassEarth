/**
 * Glass Earth — flight feed loading: retry schedule + payload shape.
 *
 * The /api/flights sweep is slow on a cold serverless instance (a full
 * 30-region sweep measured 11–27 s), and a failed first attempt used to be
 * swallowed silently — the layer was marked "fetched" before the request
 * even finished, so nothing retried until the 5-minute poll. These helpers
 * are the contract between the loader in page.tsx and the route:
 *
 * - a load is "fetched" only when data actually lands;
 * - a failed attempt retries on a short backoff, then leaves it to the poll;
 * - a stale or partial payload (the route says so explicitly) is shown
 *   as-is, and the client comes back once or twice for the full picture.
 */

/** What the Flights layer is doing right now, for the counter strip and the
    Layers panel — never a silent absence. */
export type FlightFeedStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Backoff after a failed /api/flights attempt: 15 s, then 30 s. After the
    second retry the 5-minute poll is the backstop — no infinite loop. */
export const FLIGHT_RETRY_DELAYS_MS = [15_000, 30_000] as const;

/** Delay before retry `attempt` (0-based), or null when the schedule is
    exhausted and the caller should stop scheduling retries. */
export function nextFlightRetryDelay(attempt: number): number | null {
  return attempt >= 0 && attempt < FLIGHT_RETRY_DELAYS_MS.length
    ? FLIGHT_RETRY_DELAYS_MS[attempt]
    : null;
}

/** How soon after a stale/partial payload the client comes back for the full
    picture. */
export const FLIGHT_STALE_REFETCH_MS = 30_000;
/** At most this many scheduled refetches per load — the 5-minute poll is the
    backstop after that. */
export const FLIGHT_STALE_REFETCH_ATTEMPTS = 2;

export interface FlightBuckets {
  commercial_flights?: unknown;
  private_flights?: unknown;
  private_jets?: unknown;
  military_flights?: unknown;
}

/** True once any flight bucket has actually landed (a non-empty array).
    An arrived-but-empty feed is not "data" — it means the sweep found
    nothing, and the loader should keep trying. */
export function hasFlightData(data: FlightBuckets | null | undefined): boolean {
  if (!data) return false;
  return (
    ['commercial_flights', 'private_flights', 'private_jets', 'military_flights'] as const
  ).some(k => Array.isArray(data[k]) && (data[k] as unknown[]).length > 0);
}

/** The route marks payloads served from a stale cache, or from the fast
    first wave, so the client knows the picture is incomplete and can come
    back for the full sweep. */
export function isPartialFlightPayload(data: { partial?: unknown } | null | undefined): boolean {
  return data?.partial === true;
}

export function isStaleFlightPayload(data: { stale?: unknown } | null | undefined): boolean {
  return data?.stale === true;
}

/** The shape flags the /api/flights route stamps on its payloads, plus
    whatever else the payload carries (the flight buckets). */
export interface FlightPayloadFlags {
  stale?: unknown;
  partial?: unknown;
  [key: string]: unknown;
}

/** Normalise the route's shape flags into merged data: a fresh payload
    carries neither flag, so a stale/partial flag from an earlier response
    must not linger after a full one lands. */
export function normalizeFlightPayload(d: FlightPayloadFlags): FlightPayloadFlags {
  return { ...d, stale: d.stale === true, partial: d.partial === true };
}

/** Wall-clock budget for one full flight sweep, comfortably inside the
    route's 60 s maxDuration. On a throttled egress IP the region fetches can
    each burn their whole timeout, and a sweep that outlives its function
    leaves a dangling dedup promise behind (see isStaleSweepPromise) — the
    snapshot then never refreshes. On deadline the sweep returns what it
    accumulated so far, flagged partial; the client refetches in 15 s, so the
    next cycle gets another chance at the full picture. */
export const FLIGHT_SWEEP_DEADLINE_MS = 40_000;

/** A deduped sweep promise older than this cannot still be a live sweep: the
    route's maxDuration is 60 s, so anything older was killed or frozen
    mid-flight and will never settle. Joining it would wedge the instance
    (every refresh awaiting a dead promise while the snapshot goes stale), so
    the caller discards it and starts over. */
export const STALE_SWEEP_PROMISE_MS = 65_000;

/** True when a sweep promise started at `startedAt` is too old to still be
    running (see STALE_SWEEP_PROMISE_MS). */
export function isStaleSweepPromise(startedAt: number, now: number = Date.now()): boolean {
  return now - startedAt > STALE_SWEEP_PROMISE_MS;
}
