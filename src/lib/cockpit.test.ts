import { describe, it, expect } from 'vitest';
import {
  COCKPIT_PITCH,
  COCKPIT_TOP_PADDING_FRACTION,
  COCKPIT_ZOOM,
  CONTACT_RADIUS_KM,
  EXTRAPOLATE_CAP_MS,
  absenceIsLoss,
  angleDeltaDeg,
  cockpitReducer,
  contactsWithin,
  createFollowSmoother,
  deadReckon,
  destinationPoint,
  haversineKm,
  initialBearingDeg,
  mapPopupsAllowed,
  nextAbsenceMs,
  smoothAngleDeg,
  type CockpitFix,
  type CockpitState,
} from './cockpit';

const fix = (over: Partial<CockpitFix> = {}): CockpitFix => ({
  lat: 0,
  lng: 0,
  headingDeg: 90,
  speedKnots: 360,
  atMs: 1_000_000,
  ...over,
});

describe('destinationPoint / haversineKm / initialBearingDeg', () => {
  it('travels one degree east along the equator', () => {
    const p = destinationPoint(0, 0, 90, 111.195);
    expect(p.lat).toBeCloseTo(0, 3);
    expect(p.lng).toBeCloseTo(1, 2);
  });

  it('travels one degree north along a meridian', () => {
    const p = destinationPoint(0, 0, 0, 111.195);
    expect(p.lat).toBeCloseTo(1, 2);
    expect(p.lng).toBeCloseTo(0, 3);
  });

  it('measures and points back consistently', () => {
    const a = { lat: 31.7619, lng: -106.485 }; // El Paso
    const b = { lat: 32.7767, lng: -96.797 }; // Dallas
    const d = haversineKm(a, b);
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(960);
    expect(initialBearingDeg(a, b)).toBeGreaterThan(75);
    expect(initialBearingDeg(a, b)).toBeLessThan(90);
    expect(initialBearingDeg(b, a)).toBeGreaterThan(255);
    expect(initialBearingDeg(b, a)).toBeLessThan(270);
  });
});

describe('deadReckon', () => {
  it('advances along the track at ground speed', () => {
    // 360 kt for 60 s = 11.112 km due east from the origin.
    const p = deadReckon(fix(), 1_060_000);
    expect(haversineKm({ lat: 0, lng: 0 }, p)).toBeCloseTo(11.112, 2);
    expect(p.lat).toBeCloseTo(0, 3);
    expect(p.lng).toBeGreaterThan(0);
  });

  it('stays put when grounded or stationary', () => {
    expect(deadReckon(fix({ grounded: true }), 1_060_000)).toEqual({ lat: 0, lng: 0 });
    expect(deadReckon(fix({ speedKnots: 0 }), 1_060_000)).toEqual({ lat: 0, lng: 0 });
  });

  it('never extrapolates before the fix or past the cap', () => {
    expect(deadReckon(fix(), 999_000)).toEqual({ lat: 0, lng: 0 });
    const atCap = deadReckon(fix(), 1_000_000 + EXTRAPOLATE_CAP_MS);
    const wayPast = deadReckon(fix(), 1_000_000 + EXTRAPOLATE_CAP_MS * 10);
    expect(wayPast).toEqual(atCap);
  });
});

describe('angle smoothing', () => {
  it('takes the shortest arc across north', () => {
    expect(angleDeltaDeg(350, 10)).toBe(20);
    expect(angleDeltaDeg(10, 350)).toBe(-20);
    expect(smoothAngleDeg(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(smoothAngleDeg(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(smoothAngleDeg(90, 90, 0.5)).toBe(90);
  });
});

describe('createFollowSmoother', () => {
  it('returns null until the first fix, then glides from the seed', () => {
    const s = createFollowSmoother({ lat: 10, lng: 10, bearingDeg: 0 });
    expect(s.sample(1_000)).toBeNull();
    s.pushFix(fix({ lat: 0, lng: 0, speedKnots: 0, headingDeg: 0 }));
    const pose = s.sample(1_000);
    expect(pose).not.toBeNull();
    // One frame in, the pose has barely left the seed — a swoop, not a snap.
    expect(pose!.lat).toBeGreaterThan(9.5);
    expect(pose!.lat).toBeLessThan(10);
  });

  it('converges on a stationary target', () => {
    const s = createFollowSmoother({ lat: 10, lng: 10, bearingDeg: 0 });
    s.pushFix(fix({ lat: 0, lng: 0, speedKnots: 0, headingDeg: 0, atMs: 0 }));
    let pose = s.sample(0);
    for (let t = 50; t <= 20_000; t += 50) pose = s.sample(t);
    expect(pose).not.toBeNull();
    expect(Math.abs(pose!.lat)).toBeLessThan(0.01);
    expect(Math.abs(pose!.lng)).toBeLessThan(0.01);
  });

  it('rides the reckoning between fixes instead of sitting on the last point', () => {
    const f = fix({ atMs: 0 }); // 360 kt due east from the origin
    const s = createFollowSmoother({ lat: 0, lng: 0, bearingDeg: 90 });
    s.pushFix(f);
    let pose = s.sample(0);
    for (let t = 50; t <= 60_000; t += 50) pose = s.sample(t);
    const reckoned = deadReckon(f, 60_000);
    // Chasing with a 1.4 s time constant leaves a small lag, never a leap.
    expect(haversineKm(pose!, reckoned)).toBeLessThan(0.6);
    expect(pose!.lng).toBeGreaterThan(0.05); // well east of the raw fix
  });

  it('blends a correcting fix instead of teleporting', () => {
    const s = createFollowSmoother({ lat: 0, lng: 0, bearingDeg: 90 });
    s.pushFix(fix({ atMs: 0, speedKnots: 0, headingDeg: 90 }));
    for (let t = 0; t <= 10_000; t += 50) s.sample(t);
    const before = s.pose();
    // The next sweep places the aircraft 5 km north of where we glide.
    s.pushFix(fix({ lat: 0.045, lng: 0, speedKnots: 0, headingDeg: 90, atMs: 10_000 }));
    const after = s.sample(10_050)!;
    expect(haversineKm(before, after)).toBeLessThan(0.5); // one frame ≠ 5 km
    expect(after.lat).toBeGreaterThan(before.lat); // but it does bend north
  });

  it('follows the track across the 0/360 wrap and holds it when parked', () => {
    const s = createFollowSmoother({ lat: 0, lng: 0, bearingDeg: 350 });
    s.pushFix(fix({ atMs: 0, headingDeg: 10, speedKnots: 100 }));
    let pose = s.sample(0);
    for (let t = 50; t <= 20_000; t += 50) pose = s.sample(t);
    expect(Math.abs(angleDeltaDeg(pose!.bearingDeg, 10))).toBeLessThan(1);

    const parked = createFollowSmoother({ lat: 0, lng: 0, bearingDeg: 123 });
    parked.pushFix(fix({ atMs: 0, headingDeg: 300, speedKnots: 0 }));
    for (let t = 50; t <= 5_000; t += 50) parked.sample(t);
    expect(parked.pose().bearingDeg).toBe(123); // no spinning under a parked plane
  });

  it('reseeds the glide (re-centre swoops back rather than snapping)', () => {
    const s = createFollowSmoother({ lat: 0, lng: 0, bearingDeg: 90 });
    s.pushFix(fix({ atMs: 0, speedKnots: 0 }));
    for (let t = 0; t <= 10_000; t += 50) s.sample(t);
    s.reseed({ lat: 5, lng: 5, bearingDeg: 0 });
    const pose = s.sample(10_050)!;
    expect(pose.lat).toBeGreaterThan(4.5); // starts from the reseeded pose
  });
});

describe('contactsWithin', () => {
  const center = { lat: 0, lng: 0 };
  const flights = [
    { icao24: 'self', callsign: 'SELF', lat: 0, lng: 0 },
    { icao24: 'near-n', callsign: 'NORTH', lat: 0.4, lng: 0 },
    { icao24: 'mid-e', callsign: 'EAST', lat: 0, lng: 0.6 },
    { icao24: 'far', callsign: 'FAR', lat: 3, lng: 0 },
    { icao24: 'lost', callsign: 'LOST', lat: Number.NaN, lng: 0 },
  ];

  it('selects within the radius, nearest first, with bearings', () => {
    const out = contactsWithin(center, flights, CONTACT_RADIUS_KM, 'self');
    expect(out.map((c) => c.flight.icao24)).toEqual(['near-n', 'mid-e']);
    expect(out[0].distanceKm).toBeCloseTo(44.5, 0);
    expect(out[0].bearingDeg).toBeCloseTo(0, 0);
    expect(out[1].bearingDeg).toBeCloseTo(90, 0);
  });

  it('honours a smaller radius and the limit', () => {
    expect(contactsWithin(center, flights, 50, 'self')).toHaveLength(1);
    const crowd = Array.from({ length: 20 }, (_, i) => ({
      icao24: `c${i}`, lat: 0.01 * (i + 1), lng: 0,
    }));
    expect(contactsWithin(center, crowd, CONTACT_RADIUS_KM, 'self', 5)).toHaveLength(5);
  });
});

describe('cockpitReducer', () => {
  const view = { lat: 31.7619, lng: -106.485, zoom: 9, bearing: 0, pitch: 0 };
  const target = { icao24: 'abc123', callsign: 'AAL123' };
  const riding: CockpitState = { status: 'riding', target, lock: 'follow', savedView: view };

  it('enters a ride following, holding the view to restore', () => {
    const s = cockpitReducer({ status: 'idle' }, { type: 'ENTER', target, savedView: view });
    expect(s).toEqual(riding);
  });

  it('grabbing the map pauses the follow without ending the ride', () => {
    const grabbed = cockpitReducer(riding, { type: 'GRAB' });
    expect(grabbed).toEqual({ ...riding, lock: 'free' });
    expect(cockpitReducer(grabbed, { type: 'GRAB' })).toEqual(grabbed); // no-op twice
    expect(cockpitReducer(grabbed, { type: 'RECENTER' })).toEqual(riding);
    expect(cockpitReducer(riding, { type: 'RECENTER' })).toEqual(riding); // no-op while following
  });

  it('hopping keeps the original saved view and re-locks the follow', () => {
    const other = { icao24: 'def456', callsign: 'UAL456' };
    const free = cockpitReducer(riding, { type: 'GRAB' });
    const hopped = cockpitReducer(free, { type: 'HOP', target: other });
    expect(hopped).toEqual({ status: 'riding', target: other, lock: 'follow', savedView: view });
    // ENTER while riding behaves the same way.
    expect(cockpitReducer(riding, { type: 'ENTER', target: other, savedView: { lat: 0, lng: 0, zoom: 5 } }))
      .toEqual({ status: 'riding', target: other, lock: 'follow', savedView: view });
  });

  it('exit returns to idle; ride events in idle are no-ops', () => {
    expect(cockpitReducer(riding, { type: 'EXIT' })).toEqual({ status: 'idle' });
    const idle: CockpitState = { status: 'idle' };
    for (const e of [{ type: 'GRAB' }, { type: 'RECENTER' }, { type: 'EXIT' }, { type: 'ACK' }] as const) {
      expect(cockpitReducer(idle, e)).toEqual(idle);
    }
    expect(cockpitReducer(idle, { type: 'HOP', target })).toEqual(idle);
    expect(cockpitReducer(idle, { type: 'LOST', notice: 'gone' })).toEqual(idle);
  });

  it('losing the target ends with a notice and the saved view; ACK dismisses', () => {
    const ended = cockpitReducer(riding, { type: 'LOST', notice: 'That flight has landed.' });
    expect(ended).toEqual({ status: 'ended', notice: 'That flight has landed.', savedView: view });
    expect(cockpitReducer(ended, { type: 'ACK' })).toEqual({ status: 'idle' });
    // A fresh pick from the notice keeps the original way home.
    const other = { icao24: 'def456', callsign: 'UAL456' };
    expect(cockpitReducer(ended, { type: 'ENTER', target: other, savedView: { lat: 0, lng: 0, zoom: 2 } }))
      .toEqual({ status: 'riding', target: other, lock: 'follow', savedView: view });
  });

  it('keeps the agreed framing constants', () => {
    expect(COCKPIT_ZOOM).toBeGreaterThan(10);
    expect(EXTRAPOLATE_CAP_MS).toBeGreaterThan(0);
  });

  it('FPV framing: pitched to a horizon, the nose sits at the bottom edge', () => {
    expect(COCKPIT_PITCH).toBe(76);
    // MapLibre renders the camera centre at 50% + fraction/2 of the frame
    // height; the FPV fraction must put the aircraft in the bottom quarter.
    expect(COCKPIT_TOP_PADDING_FRACTION).toBeGreaterThan(0.5);
    expect(0.5 + COCKPIT_TOP_PADDING_FRACTION / 2).toBeGreaterThan(0.75);
  });

  it('the popup entry path engages the follow at once', () => {
    // The map popup's RIDE button hands the aircraft to the page, which
    // dispatches ENTER — the state the follow loop keys on. Entering must
    // land in lock 'follow' with the pre-ride view held for the way out.
    const s = cockpitReducer({ status: 'idle' }, { type: 'ENTER', target, savedView: view });
    expect(s.status).toBe('riding');
    expect(s).toMatchObject({ lock: 'follow', savedView: view });
  });

  it('popups stay shut for the whole ride and open again after it', () => {
    const s = cockpitReducer({ status: 'idle' }, { type: 'ENTER', target, savedView: view });
    expect(mapPopupsAllowed(s.status === 'riding')).toBe(false);
    const back = cockpitReducer(s, { type: 'EXIT' });
    expect(mapPopupsAllowed(back.status === 'riding')).toBe(true);
    expect(mapPopupsAllowed(false)).toBe(true);
    expect(mapPopupsAllowed(true)).toBe(false);
  });
});

describe('absence accounting — a partial sweep is not a disappearance', () => {
  it('a sighting resets the clock outright', () => {
    expect(nextAbsenceMs(45_000, true, false, 1000)).toBe(0);
    expect(nextAbsenceMs(45_000, true, true, 1000)).toBe(0);
  });

  it('absence from a partial payload does not age the target at all', () => {
    let a = 0;
    for (let i = 0; i < 300; i++) a = nextAbsenceMs(a, false, true, 1000);
    expect(a).toBe(0);
    expect(absenceIsLoss(a)).toBe(false);
  });

  it('absence from complete payloads accumulates to the loss threshold', () => {
    let a = 0;
    for (let i = 0; i < 90; i++) a = nextAbsenceMs(a, false, false, 1000);
    expect(a).toBe(90_000);
    expect(absenceIsLoss(a)).toBe(false); // strictly past the grace
    a = nextAbsenceMs(a, false, false, 1000);
    expect(absenceIsLoss(a)).toBe(true);
  });

  it('mixed sweeps: partial gaps freeze the clock, complete ones run it', () => {
    let a = 0;
    a = nextAbsenceMs(a, false, false, 1000);
    a = nextAbsenceMs(a, false, true, 1000);
    a = nextAbsenceMs(a, false, true, 1000);
    a = nextAbsenceMs(a, false, false, 1000);
    expect(a).toBe(2_000);
  });

  it('honours a custom grace', () => {
    expect(absenceIsLoss(5_000, 4_000)).toBe(true);
    expect(absenceIsLoss(5_000, 5_000)).toBe(false);
  });
});
