/**
 * OSIRIS — Amtrak train positions from Amtraker, in the GTFS reader's shape.
 *
 * Amtrak publishes no GTFS-Realtime vehicle feed of its own. Amtraker
 * (amtraker.com, a community service run off Amtrak's own train tracker)
 * republishes every running train's position as JSON, keyless, and is the
 * source the hobbyist ecosystem standardised on. Only what it carries is
 * mapped: the train's name and number, its destination, a compass heading
 * (theirs is a point of the compass, not degrees) and a speed in miles per
 * hour, which becomes metres per second like every other feed's.
 */
import type { VehicleFeed, VehiclePosition } from './gtfs-rt';

/** Points of the compass to degrees clockwise from north. */
const COMPASS: Record<string, number> = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};
const MPH_TO_MS = 0.44704;
/** On the road, or at its origin about to leave; a completed run is history. */
const RUNNING = new Set(['Active', 'Predeparture']);

const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim() : undefined);

/**
 * The trains in one Amtraker answer: an object keyed by train number, each
 * value the runs of that number (usually one). Trains without a usable
 * position are left out, as the GTFS reader leaves them out.
 * Throws when the bytes are not the JSON Amtraker answers with.
 */
export function decodeAmtrakerFeed(buf: Uint8Array): VehicleFeed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new Error('Amtraker answer was not JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Amtraker answer held no trains');
  }
  const vehicles: VehiclePosition[] = [];
  for (const group of Object.values(parsed)) {
    if (!Array.isArray(group)) continue;
    for (const raw of group as Record<string, unknown>[]) {
      const state = str(raw.trainState);
      if (state && !RUNNING.has(state)) continue;
      const lat = num(raw.lat), lng = num(raw.lon);
      if (lat === undefined || lng === undefined) continue;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
      const trainNum = raw.trainNum !== undefined && raw.trainNum !== null ? String(raw.trainNum) : undefined;
      const id = str(raw.trainID) ?? trainNum;
      if (!id) continue;
      const mph = num(raw.velocity);
      const ts = str(raw.lastValTS);
      const when = ts ? Date.parse(ts) : NaN;
      vehicles.push({
        id,
        lat, lng,
        bearing: COMPASS[str(raw.heading)?.toUpperCase() ?? ''],
        speed: mph !== undefined && mph >= 0 ? mph * MPH_TO_MS : undefined,
        // Riders know a train by its name; its number rides as the label.
        routeId: str(raw.routeName),
        tripId: str(raw.trainID),
        label: trainNum,
        timestamp: Number.isFinite(when) ? Math.floor(when / 1000) : undefined,
        dest: str(raw.destName),
      });
    }
  }
  return { vehicles };
}
