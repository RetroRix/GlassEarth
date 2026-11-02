/**
 * Glass Earth — NEAR ME rating (Globe Command scout, picked by Rick
 * 2026-11-02; the natural evolution of Smart Alerts #5).
 *
 * One plain-English summary of what's happening within 500 km of the
 * visitor's anchor: QUIET / WATCH / ELEVATED. It scores ONLY the feeds
 * Smart Alerts already reads — USGS earthquakes, Look Up! ISS passes,
 * Launch Library 2 launches — plus the NASA FIRMS heat detections the
 * page has already loaded for the Fires layer, when it has.
 *
 * This is a summary, never an official risk level: every threshold that
 * can move the rating is returned in `inputs` and printed on the card,
 * and every reason names the actual feed event behind it. A feed that
 * failed or never loaded contributes nothing and says so — silence from
 * a feed is never scored as calm.
 */

import { distanceKm, type Anchor, type IssPassLike, type LaunchLike, type QuakeLike } from './smart-alerts';

export const NEAR_ME_RADIUS_KM = 500;

/* The thresholds, in one place, all printed on the card. */
export const NEAR_ME_RULES = {
  quakeElevatedMagFar: 6.0, // M6.0+ anywhere within 500 km
  quakeElevatedMagNear: 5.5, // M5.5+ within 250 km
  quakeElevatedNearKm: 250,
  quakeWatchMag: 4.5, // M4.5+ within 500 km
  heatWatchCount: 8, // satellite heat detections within 100 km
  heatWatchKm: 100,
  issWatchHours: 3, // a visible ISS pass rising within 3 h
  launchWatchHours: 24, // a launch NET within 24 h from a site within 500 km
} as const;

/** A NASA FIRMS-style heat detection, as /api/fires rows arrive. */
export interface HeatLike {
  lat: number;
  lng: number;
  title?: string;
  type?: string;
}

export type NearMeLevel = 'QUIET' | 'WATCH' | 'ELEVATED';

export interface NearMeResult {
  level: NearMeLevel;
  /** The feed events behind the rating, strongest first. */
  reasons: string[];
  /** The exact inputs + thresholds, printed on the card verbatim. */
  inputs: string[];
}

const LEVELS: NearMeLevel[] = ['QUIET', 'WATCH', 'ELEVATED'];
const maxLevel = (a: NearMeLevel, b: NearMeLevel): NearMeLevel =>
  LEVELS[Math.max(LEVELS.indexOf(a), LEVELS.indexOf(b))];

const FLOWN_ABBREVS = new Set(['Success', 'Failure', 'Partial Failure']);

function hmUtc(ms: number): string {
  return new Date(ms).toUTCString().slice(17, 22) + ' UTC';
}

export function rateNearMe(args: {
  anchor: Anchor;
  quakes: QuakeLike[] | null;
  passes: IssPassLike[] | null;
  launches: LaunchLike[] | null;
  /** null = the Fires layer data isn't loaded; the card says so. */
  fires: HeatLike[] | null;
  now: number;
}): NearMeResult {
  const { anchor, now } = args;
  let level: NearMeLevel = 'QUIET';
  const reasons: string[] = [];
  const inputs: string[] = [];
  const R = NEAR_ME_RULES;

  /* ── Earthquakes (USGS M2.5+, last 24 h — the feed's own window) ── */
  if (args.quakes === null) {
    inputs.push('Earthquakes: feed unavailable this check — not scored.');
  } else {
    const within = args.quakes
      .filter(q => q.magnitude !== null && Number.isFinite(q.magnitude) && Number.isFinite(q.lat) && Number.isFinite(q.lng))
      .map(q => ({ q, dist: distanceKm(anchor.lat, anchor.lng, q.lat, q.lng) }))
      .filter(x => x.dist <= NEAR_ME_RADIUS_KM)
      .sort((a, b) => (b.q.magnitude ?? 0) - (a.q.magnitude ?? 0));
    const top = within[0];
    inputs.push(
      `Earthquakes: ${within.length} within ${NEAR_ME_RADIUS_KM} km in the last 24 h`
      + (top ? `, largest M${(top.q.magnitude ?? 0).toFixed(1)} at ${Math.round(top.dist)} km` : '')
      + `. ELEVATED at M${R.quakeElevatedMagFar}+ within ${NEAR_ME_RADIUS_KM} km or M${R.quakeElevatedMagNear}+ within ${R.quakeElevatedNearKm} km; WATCH at M${R.quakeWatchMag}+ within ${NEAR_ME_RADIUS_KM} km.`,
    );
    if (top && top.q.magnitude !== null) {
      const mag = top.q.magnitude;
      const dist = top.dist;
      if (mag >= R.quakeElevatedMagFar || (mag >= R.quakeElevatedMagNear && dist <= R.quakeElevatedNearKm)) {
        level = maxLevel(level, 'ELEVATED');
        reasons.push(`M${mag.toFixed(1)} earthquake ${Math.round(dist)} km away — ${top.q.place} (${hmUtc(top.q.time)})`);
      } else if (mag >= R.quakeWatchMag) {
        level = maxLevel(level, 'WATCH');
        reasons.push(`M${mag.toFixed(1)} earthquake ${Math.round(dist)} km away — ${top.q.place} (${hmUtc(top.q.time)})`);
      }
    }
  }

  /* ── Heat detections (NASA FIRMS via the Fires layer, when loaded) ── */
  if (args.fires === null) {
    inputs.push('Heat detections: not loaded — turn on the Fires layer to include satellite hotspots in this rating.');
  } else {
    const near = args.fires.filter(f =>
      Number.isFinite(f.lat) && Number.isFinite(f.lng)
      && distanceKm(anchor.lat, anchor.lng, f.lat, f.lng) <= R.heatWatchKm);
    inputs.push(
      `Heat detections: ${near.length} satellite hotspots within ${R.heatWatchKm} km in the loaded Fires data. `
      + `WATCH at ${R.heatWatchCount}+ — detections are unconfirmed (wildfires, industry and volcanoes all show up), so they never raise ELEVATED alone.`,
    );
    if (near.length >= R.heatWatchCount) {
      level = maxLevel(level, 'WATCH');
      reasons.push(`${near.length} satellite heat detections within ${R.heatWatchKm} km — unconfirmed hotspots, worth a look at the Fires layer`);
    }
  }

  /* ── ISS passes (Look Up! times; the feed's own visible flag) ── */
  if (args.passes === null) {
    inputs.push('ISS passes: feed unavailable this check — not scored.');
  } else {
    const upcoming = args.passes
      .map(p => ({ p, rise: Date.parse(p.riseAt) }))
      .filter(x => Number.isFinite(x.rise) && x.rise >= now - 10 * 60_000 && x.rise - now <= R.issWatchHours * 3_600_000)
      .sort((a, b) => a.rise - b.rise);
    const visible = upcoming.find(x => x.p.visible);
    inputs.push(
      `ISS: ${upcoming.length} pass${upcoming.length === 1 ? '' : 'es'} in the next ${R.issWatchHours} h`
      + (visible ? `, next visible at ${hmUtc(visible.rise)}` : ', none the feed marks visible')
      + `. WATCH when a visible pass rises within ${R.issWatchHours} h — something to see, not a hazard.`,
    );
    if (visible) {
      level = maxLevel(level, 'WATCH');
      reasons.push(`Visible ISS pass at ${hmUtc(visible.rise)}, peaking at ${Math.round(visible.p.peakElevationDeg)}° — step outside and look up`);
    }
  }

  /* ── Launches (Launch Library 2; only sites within the radius) ── */
  if (args.launches === null) {
    inputs.push('Launches: feed unavailable this check — not scored.');
  } else {
    const near = args.launches
      .map(l => ({ l, net: Date.parse(l.net), dist: distanceKm(anchor.lat, anchor.lng, l.lat, l.lng) }))
      .filter(x => Number.isFinite(x.net) && !FLOWN_ABBREVS.has(x.l.statusAbbrev)
        && x.dist <= NEAR_ME_RADIUS_KM && x.net >= now - 5 * 60_000 && x.net - now <= R.launchWatchHours * 3_600_000)
      .sort((a, b) => a.net - b.net);
    const first = near[0];
    inputs.push(
      `Launches: ${near.length} with a NET in the next ${R.launchWatchHours} h from a site within ${NEAR_ME_RADIUS_KM} km`
      + (first ? ` — next ${hmUtc(first.net)} from ${first.l.siteName ?? 'its pad'} (${Math.round(first.dist)} km)` : '')
      + `. WATCH when one is on the clock nearby.`,
    );
    if (first) {
      level = maxLevel(level, 'WATCH');
      reasons.push(`Launch NET ${hmUtc(first.net)} — ${first.l.name} (${first.l.status}, ${Math.round(first.dist)} km away)`);
    }
  }

  return { level, reasons, inputs };
}
