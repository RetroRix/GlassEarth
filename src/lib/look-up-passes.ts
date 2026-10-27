/**
 * OSIRIS — ISS pass finding. SERVER-SIDE ONLY: never import this module
 * from client code.
 *
 * This is lib/look-up's pass finder, split into its own module for one
 * hard, measured reason: it is the app's only client-reachable consumer
 * of lib/orbit, and satellite.js in the browser bundle stalls the
 * production build. With the propagator imported by the Look Up panel
 * (wave item 12, as first shipped), Next 16.4.3's Turbopack optimizer
 * never finished "Creating an optimized production build" — reproduced
 * locally at 280 s+ and on Vercel at 45 min+ (2026-10-27), while the
 * server graph, which has used satellite.js all along, builds fine.
 * A lazy dynamic import does not help: the optimizer walks every chunk.
 *
 * So the panel asks the passes route (app/api/satellites/passes), which
 * runs this finder over the catalogue's own TLE (lib/tle-catalogue) and
 * returns finished passes — the same math, the same element set, the
 * same visibility labels the panel used to compute in the browser.
 * Everything else in Look Up stays in lib/look-up, which is client-safe.
 */
import { propagateTLE, type SatPosition } from './orbit';
import {
  isSunlit, lookAngle, sunElevationDeg,
  type IssPass, type Observer,
} from './look-up';

export interface PassSearchOptions {
  from?: Date;
  /** How many passes to return. */
  count?: number;
  /** Search horizon; passes beyond it are not reported as absent, just not found. */
  horizonHours?: number;
  /** A pass must peak at or above this elevation to be listed at all. */
  minPeakElevationDeg?: number;
  /** Coarse scan step. A listed pass spends minutes near its peak, so 30 s
   *  sampling cannot step over one; crossings are then refined exactly. */
  stepSeconds?: number;
}

/**
 * The next ISS passes over an observer, propagated from the TLE with the
 * app's own SGP4 wrapper. Rise/set are the 0°-elevation crossings refined
 * by bisection; the peak is found by golden-section search between them.
 * Deterministic for a fixed TLE and start time.
 */
export function findIssPasses(
  line1: string,
  line2: string,
  observer: Observer,
  opts: PassSearchOptions = {},
): IssPass[] {
  const from = opts.from ?? new Date();
  const count = opts.count ?? 3;
  const horizonMs = (opts.horizonHours ?? 72) * 3600_000;
  const minPeak = opts.minPeakElevationDeg ?? 10;
  const stepMs = (opts.stepSeconds ?? 30) * 1000;

  const elevationAt = (t: number): { el: number; pos: SatPosition | null } => {
    const pos = propagateTLE(line1, line2, new Date(t));
    if (!pos) return { el: -90, pos: null };
    return { el: lookAngle(observer, pos).elevationDeg, pos };
  };

  /** Bisect the elevation sign change in (a, b] down to ~1 s. */
  const refineCrossing = (a: number, b: number): number => {
    let lo = a;
    let hi = b;
    const loSign = elevationAt(lo).el > 0;
    for (let i = 0; i < 40 && hi - lo > 1000; i++) {
      const mid = (lo + hi) / 2;
      if ((elevationAt(mid).el > 0) === loSign) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const passes: IssPass[] = [];
  const end = from.getTime() + horizonMs;
  let prevT = from.getTime();
  let inPass = elevationAt(prevT).el > 0;
  let riseT = inPass ? prevT : 0;

  for (let t = prevT + stepMs; t <= end && passes.length < count; t += stepMs) {
    const { el } = elevationAt(t);
    if (!inPass && el > 0) {
      riseT = refineCrossing(prevT, t);
      inPass = true;
    } else if (inPass && el <= 0) {
      const setT = refineCrossing(prevT, t);
      // Peak: golden-section maximisation of elevation over [rise, set].
      let a = riseT;
      let b = setT;
      const gr = (Math.sqrt(5) - 1) / 2;
      let c = b - gr * (b - a);
      let d2 = a + gr * (b - a);
      for (let i = 0; i < 48; i++) {
        if (elevationAt(c).el < elevationAt(d2).el) a = c;
        else b = d2;
        c = b - gr * (b - a);
        d2 = a + gr * (b - a);
      }
      const peakT = (a + b) / 2;
      const peak = elevationAt(peakT);
      if (peak.pos && peak.el >= minPeak) {
        const peakAngle = lookAngle(observer, peak.pos);
        passes.push({
          riseAt: new Date(riseT),
          peakAt: new Date(peakT),
          setAt: new Date(setT),
          peakElevationDeg: peak.el,
          peakAzimuthDeg: peakAngle.azimuthDeg,
          visible: isSunlit(peak.pos, new Date(peakT)) && sunElevationDeg(observer, new Date(peakT)) <= -6,
        });
      }
      inPass = false;
    }
    prevT = t;
  }
  return passes;
}

