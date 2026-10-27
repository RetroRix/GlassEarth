import type { TransitFeed } from './transit';

/**
 * OSIRIS — live transit feeds that are not GTFS-Realtime, kept by hand.
 *
 * The generated catalogue (transit-feeds.generated.ts) is GTFS-Realtime
 * only, because that is what its builder can probe. A few worthwhile
 * operators publish in another shape; each gets a small decoder into the
 * GTFS reader's shape (named by the feed's `format`) and a line here, so
 * the reader, the cache and the map treat them exactly like any other
 * feed. Like the keyed list, this file is edited by hand.
 */
export const EXTRA_TRANSIT_FEEDS: TransitFeed[] = [
  // Amtrak runs no GTFS-Realtime vehicle feed. Amtraker republishes the
  // positions from Amtrak's own tracker as keyless JSON, updated as the
  // trains report; verified live 2026-10-27 (48 trains, every position
  // under 15 minutes old). Its answer runs to hundreds of kilobytes (it
  // carries each train's station list, which is not read), so one read is
  // shared for a minute rather than the usual twenty seconds — trains
  // report on that pace themselves.
  {
    id: 'amtrak', provider: 'Amtrak (via Amtraker)', country: 'US', region: 'United States',
    url: 'https://api-v3.amtraker.com/v3/trains', format: 'amtraker',
    bbox: [-125.5, 24.0, -66.0, 50.0], center: [-98.5, 39.5], core: [-112, 33, -84, 44],
    license: 'https://amtraker.com', vehiclesAtProbe: 48, defaultMode: 'rail', ttlMs: 60_000,
  },
];
