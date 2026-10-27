import type { ShareTarget } from './share-view';

/**
 * Glass Earth — re-finding a shared link's live target.
 *
 * A share link (lib/share-view) can name a moving thing: a flight by ICAO24
 * or a ship by MMSI. The name is all the link carries — positions in the
 * link would be stale before it was even opened — so on arrival the app
 * searches the live feed it already has for that one identity. The search
 * is deliberately plain:
 *
 *   - Identity only. A flight is found by its transponder hex and nothing
 *     else: never by callsign (airlines reuse them daily, and two aircraft
 *     can carry related callsigns), never by "nearest to the link's view".
 *     Centring on a different aircraft that happens to be nearby is the
 *     one failure this module exists to prevent.
 *   - A record with no usable position is not a find. A feed row whose
 *     coordinates never arrived can't be centred on or watched honestly.
 *   - Absence is a normal answer. Targets land, sail out of coverage, or
 *     were never real (a hand-mangled link). The caller says so plainly
 *     and keeps watching later sweeps — a target that appears while the
 *     page is open is still picked up by the same search.
 */

export interface ShareTargetHit {
  lat: number;
  lng: number;
  /** What the feed itself calls it — the freshest honest label there is. */
  label: string;
  /** The layer that renders this bucket, so the recipient can be sure it is switched on. */
  layerKey?: string;
}

/** The flight buckets the page holds, with the layer key that draws each. */
const FLIGHT_BUCKETS: Array<{ bucket: string; layerKey: string }> = [
  { bucket: 'commercial_flights', layerKey: 'flights' },
  { bucket: 'private_flights', layerKey: 'private' },
  { bucket: 'private_jets', layerKey: 'jets' },
  { bucket: 'military_flights', layerKey: 'military' },
];

interface FeedRecord {
  lat?: unknown;
  lng?: unknown;
  icao24?: unknown;
  callsign?: unknown;
  mmsi?: unknown;
  id?: unknown;
  name?: unknown;
}

function usablePosition(rec: FeedRecord): { lat: number; lng: number } | null {
  const lat = rec.lat;
  const lng = rec.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Find the one aircraft with this transponder hex across every flight bucket. */
export function findSharedFlight(
  data: Record<string, unknown> | null | undefined,
  icao24: string,
): ShareTargetHit | null {
  if (!data || !icao24) return null;
  const want = icao24.toLowerCase();
  for (const { bucket, layerKey } of FLIGHT_BUCKETS) {
    const rows = data[bucket];
    if (!Array.isArray(rows)) continue;
    for (const raw of rows as FeedRecord[]) {
      if (String(raw?.icao24 ?? '').toLowerCase() !== want) continue;
      const pos = raw && usablePosition(raw);
      if (!pos) continue;
      const cs = typeof raw.callsign === 'string' ? raw.callsign.trim() : '';
      return { ...pos, label: cs || icao24.toUpperCase(), layerKey };
    }
  }
  return null;
}

/** Find the one vessel with this MMSI in the ships the feed delivered. */
export function findSharedShip(
  ships: readonly unknown[] | null | undefined,
  mmsi: string,
): ShareTargetHit | null {
  if (!ships || !mmsi) return null;
  for (const raw of ships as FeedRecord[]) {
    if (!raw || String(raw.mmsi ?? raw.id ?? '') !== mmsi) continue;
    const pos = usablePosition(raw);
    if (!pos) continue;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    return { ...pos, label: name || `MMSI ${mmsi}`, layerKey: 'maritime' };
  }
  return null;
}

/** Has at least one sweep of the relevant feed reached the page yet?
 *  A bucket that is present at all (even empty) means a sweep landed —
 *  before that, "not found" says nothing and must not be announced. */
export function flightsSweepLanded(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  return FLIGHT_BUCKETS.some(({ bucket }) => Array.isArray(data[bucket]));
}

export function shipsSweepLanded(data: Record<string, unknown> | null | undefined): boolean {
  return !!data && Array.isArray(data.maritime_ships);
}

/** The name the link itself carries — what the app can call the target
 *  before (or unless) the feed confirms it. */
export function shareTargetLabel(target: ShareTarget): string {
  if (target.kind === 'flight') return target.callsign?.trim() || target.icao24.toUpperCase();
  return target.name?.trim() || `MMSI ${target.mmsi}`;
}

/** The plain sentence for a target the feed does not currently hold. */
export function shareTargetMissingMessage(target: ShareTarget): string {
  const label = shareTargetLabel(target);
  return target.kind === 'flight'
    ? `That flight (${label}) isn't being tracked right now — it may have landed or left coverage.`
    : `That ship (${label}) isn't being tracked right now — it may have sailed beyond the covered waters.`;
}
