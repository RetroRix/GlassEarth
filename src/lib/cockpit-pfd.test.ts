import { describe, it, expect } from 'vitest';
import {
  ALT_TAPE_PX_PER_FT,
  BAND_DIM_AFTER_MS,
  EMPTY_PFD_SAMPLE,
  SPEED_TAPE_PX_PER_KT,
  bandDimmed,
  bankEstimateAvailable,
  cockpitRidePadding,
  deriveVerticalSpeedFpm,
  effectiveRideStyle,
  estimateBankDeg,
  formatAltBox,
  formatSpeedBox,
  formatVerticalSpeed,
  formatVsReadout,
  fullscreenTransition,
  mergePfdSample,
  RIDE_SKY_DAY,
  RIDE_SKY_NIGHT,
  rideSkySpec,
  satelliteTileUrl,
  tapeAnchorFor,
  tapeStripOffsetPx,
  tapeTicks,
  turnRateDegPerSec,
  type BandDimInputs,
  type PfdSample,
} from './cockpit-pfd';
import { COCKPIT_TOP_PADDING_FRACTION } from './cockpit';

describe('tape geometry', () => {
  it('builds ticks around the anchor, labelled on the label step', () => {
    const ticks = tapeTicks(400, 10, 20, SPEED_TAPE_PX_PER_KT, 30);
    expect(ticks).toHaveLength(61);
    const centre = ticks.find((t) => t.value === 400)!;
    expect(centre.yPx).toBe(0);
    expect(centre.label).toBe(true);
    const above = ticks.find((t) => t.value === 410)!;
    expect(above.yPx).toBe(-10); // higher values sit higher on the strip
    expect(above.label).toBe(false);
    const below = ticks.find((t) => t.value === 380)!;
    expect(below.yPx).toBe(20);
    expect(below.label).toBe(true);
  });

  it('altitude ticks scale by the tape scale', () => {
    const ticks = tapeTicks(32_800, 100, 500, ALT_TAPE_PX_PER_FT, 30);
    const plus500 = ticks.find((t) => t.value === 33_300)!;
    expect(plus500.yPx).toBeCloseTo(-45, 6);
    expect(plus500.label).toBe(false); // labels land on absolute 500 ft boundaries
    const labelled = ticks.find((t) => t.value === 33_500)!;
    expect(labelled.label).toBe(true);
  });

  it('the strip offset follows the live value off the anchor', () => {
    expect(tapeStripOffsetPx(445, 440, SPEED_TAPE_PX_PER_KT)).toBe(5);
    expect(tapeStripOffsetPx(435, 440, SPEED_TAPE_PX_PER_KT)).toBe(-5);
    expect(tapeStripOffsetPx(32_850, 32_800, ALT_TAPE_PX_PER_FT)).toBeCloseTo(4.5, 6);
  });

  it('anchors step on tick boundaries, including across zero', () => {
    expect(tapeAnchorFor(447, 10)).toBe(440);
    expect(tapeAnchorFor(440, 10)).toBe(440);
    expect(tapeAnchorFor(-5, 10)).toBe(-10);
  });
});

describe('derived instruments', () => {
  it('bank estimate: straight flight is level at any speed', () => {
    expect(estimateBankDeg(0, 450)).toBe(0);
    expect(estimateBankDeg(0, 0)).toBe(0);
    expect(estimateBankDeg(3, 0)).toBe(0); // no speed, no turn physics
  });

  it('bank estimate: a standard-rate turn reads like the real panel', () => {
    // 3°/s at 250 kt — the textbook coordinated turn.
    expect(estimateBankDeg(3, 250)).toBeCloseTo(34.5, 0);
    // Slower aircraft, same rate: a shallower bank.
    expect(estimateBankDeg(3, 120)).toBeCloseTo(18.2, 0);
    // Sign follows the turn.
    expect(estimateBankDeg(-3, 250)).toBeCloseTo(-34.5, 0);
  });

  it('bank estimate clamps to transport limits and survives junk', () => {
    expect(estimateBankDeg(30, 500)).toBe(35);
    expect(estimateBankDeg(-30, 500)).toBe(-35);
    expect(estimateBankDeg(Number.NaN, 250)).toBe(0);
    expect(estimateBankDeg(3, Number.NaN)).toBe(0);
  });

  it('turn rate takes the short way around the compass', () => {
    expect(turnRateDegPerSec(359, 1, 2000)).toBeCloseTo(1, 6);
    expect(turnRateDegPerSec(10, 350, 1000)).toBeCloseTo(-20, 6);
    expect(turnRateDegPerSec(90, 90, 1000)).toBe(0);
    expect(turnRateDegPerSec(90, 100, 0)).toBe(0); // no elapsed time, no rate
  });

  it('vertical speed is the altitude slope, in feet per minute', () => {
    expect(deriveVerticalSpeedFpm(10_000, 11_000, 30_000)).toBe(2000);
    expect(deriveVerticalSpeedFpm(11_000, 10_000, 30_000)).toBe(-2000);
    expect(deriveVerticalSpeedFpm(10_000, 10_000, 30_000)).toBe(0);
    expect(deriveVerticalSpeedFpm(10_000, 11_000, 0)).toBe(0);
  });

  it('formats the VS readout the way the glass shows it', () => {
    expect(formatVerticalSpeed(2004)).toBe('VS +2,000');
    expect(formatVerticalSpeed(-1234)).toBe('VS −1,230');
    expect(formatVerticalSpeed(30)).toBe('VS 0');
    expect(formatVerticalSpeed(Number.NaN)).toBe('VS —');
  });
});

describe('ride framing', () => {
  it('pads the map so the nose sits low in the clear area above the band', () => {
    const { top, bottom } = cockpitRidePadding(800, 130);
    expect(bottom).toBe(130);
    // The target projects to the centre of the padded viewport.
    const targetY = (top + (800 - bottom)) / 2;
    const clear = 800 - bottom;
    expect(targetY / clear).toBeCloseTo((1 + COCKPIT_TOP_PADDING_FRACTION) / 2, 2);
    expect(targetY / clear).toBeGreaterThan(0.75); // bottom quarter of the stage
    expect(top).toBe(Math.round(COCKPIT_TOP_PADDING_FRACTION * clear));
  });

  it('a taller band lifts the framing with it', () => {
    const short = cockpitRidePadding(800, 110);
    const tall = cockpitRidePadding(800, 160);
    expect(tall.bottom).toBeGreaterThan(short.bottom);
    expect(tall.top).toBeLessThan(short.top); // clear area shrinks from the bottom
  });

  it('degenerate heights stay safe', () => {
    expect(cockpitRidePadding(0, 0)).toEqual({ top: 0, bottom: 0 });
    expect(cockpitRidePadding(100, 400).top).toBe(0);
  });
});

describe('ride basemap', () => {
  it('satellite while riding, the visitor\u2019s own style otherwise', () => {
    expect(effectiveRideStyle(true, false, 'dark')).toBe('satellite');
    expect(effectiveRideStyle(true, false, 'satellite')).toBe('satellite');
    expect(effectiveRideStyle(false, false, 'dark')).toBe('dark');
    expect(effectiveRideStyle(false, false, 'satellite')).toBe('satellite');
  });

  it('failed satellite tiles fall back to the previous style, never blank', () => {
    expect(effectiveRideStyle(true, true, 'dark')).toBe('dark');
    expect(effectiveRideStyle(true, true, 'satellite')).toBe('satellite');
  });

  it('builds World_Imagery tile URLs in z/y/x order', () => {
    expect(satelliteTileUrl(0, 0, 1)).toBe(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/1/1',
    );
    // El Paso at the ride's zoom.
    expect(satelliteTileUrl(31.75, -106.49, 10)).toBe(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/416/209',
    );
  });
});

describe('fullscreen transitions', () => {
  it('requests on ride entry, exits on ride end', () => {
    expect(fullscreenTransition(false, true, false)).toBe('request');
    expect(fullscreenTransition(true, false, true)).toBe('exit');
  });

  it('never fights the visitor or double-asks', () => {
    expect(fullscreenTransition(false, true, true)).toBe('none'); // already there
    expect(fullscreenTransition(true, false, false)).toBe('none'); // already left (Esc)
    expect(fullscreenTransition(true, true, false)).toBe('none'); // mid-ride Esc: no re-ask
    expect(fullscreenTransition(true, true, true)).toBe('none');
    expect(fullscreenTransition(false, false, false)).toBe('none');
    expect(fullscreenTransition(false, false, true)).toBe('none');
  });
});

describe('cruise dim', () => {
  const base: BandDimInputs = {
    lock: 'follow', flightHeld: false, hasFlight: true,
    nowMs: 60_000, cruiseStartMs: 0, lastInteractMs: null,
  };

  it('dims only after a quiet cruise', () => {
    expect(bandDimmed({ ...base, nowMs: BAND_DIM_AFTER_MS - 1 })).toBe(false);
    expect(bandDimmed({ ...base, nowMs: BAND_DIM_AFTER_MS + 1 })).toBe(true);
  });

  it('any interaction restarts the quiet clock', () => {
    expect(bandDimmed({ ...base, lastInteractMs: 55_000 })).toBe(false);
    expect(bandDimmed({ ...base, nowMs: 55_000 + BAND_DIM_AFTER_MS + 1, lastInteractMs: 55_000 })).toBe(true);
  });

  it('never dims through a gap, a grabbed map, or before the first report', () => {
    expect(bandDimmed({ ...base, flightHeld: true })).toBe(false);
    expect(bandDimmed({ ...base, lock: 'free' })).toBe(false);
    expect(bandDimmed({ ...base, hasFlight: false })).toBe(false);
  });
});

describe('no-data semantics — null is not zero', () => {
  // The measured defect (2026-10-26 browser check): SKW5901 ORD→FAR's
  // feed record carried a position and NO telemetry — its own popup
  // showed ALT —, SPEED —kt — yet the PFD band read 0 / 0 / 0. Zero is
  // a real reading on every instrument, so "never reported" (null)
  // must survive to the glass as null and draw dashes.
  const silent: PfdSample = { speed: null, altFt: null, heading: null };
  const cruise: PfdSample = { speed: 444, altFt: 40_000, heading: 211 };

  it('a silent record folded into an empty sample stays all-null', () => {
    expect(mergePfdSample(EMPTY_PFD_SAMPLE, silent)).toEqual(silent);
    expect(mergePfdSample(EMPTY_PFD_SAMPLE, EMPTY_PFD_SAMPLE)).toEqual(silent);
  });

  it('reported values land field by field — partial telemetry included', () => {
    // A sweep that reports altitude only: speed and heading stay unseen.
    const altOnly = mergePfdSample(EMPTY_PFD_SAMPLE, { speed: null, altFt: 12_500, heading: null });
    expect(altOnly).toEqual({ speed: null, altFt: 12_500, heading: null });
    // A later sweep reporting the rest fills them in without losing alt.
    const full = mergePfdSample(altOnly, { speed: 210, altFt: null, heading: 95 });
    expect(full).toEqual({ speed: 210, altFt: 12_500, heading: 95 });
  });

  it('a reported 0 is data: it lands, and it counts as seen', () => {
    // Parked on a sea-level field, pointing north: 0 kt / 0 ft / 000°.
    const zeros: PfdSample = { speed: 0, altFt: 0, heading: 0 };
    expect(mergePfdSample(EMPTY_PFD_SAMPLE, zeros)).toEqual(zeros);
    // And a genuine 0 replaces an earlier cruise value — it is a
    // report, not an absence.
    expect(mergePfdSample(cruise, zeros)).toEqual(zeros);
  });

  it('hold-after-seen: a later silent record never drops a seen value', () => {
    // The feed-gap contract at sample level: once reported, a gap
    // holds the last value — it does not fall back to null (dashes)
    // and never to a fabricated 0.
    expect(mergePfdSample(cruise, silent)).toEqual(cruise);
    const partial: PfdSample = { speed: null, altFt: 39_500, heading: null };
    expect(mergePfdSample(cruise, partial)).toEqual({ speed: 444, altFt: 39_500, heading: 211 });
  });

  it('the value boxes draw dashes only for never-reported fields', () => {
    expect(formatSpeedBox(null)).toBe('—');
    expect(formatSpeedBox(0)).toBe('0'); // 0 kt is a reading
    expect(formatSpeedBox(444.6)).toBe('445');
    expect(formatAltBox(null)).toBe('—');
    expect(formatAltBox(0)).toBe('0'); // 0 ft at a sea-level field is a reading
    expect(formatAltBox(32_800)).toBe('32,800');
  });

  it('VS is a slope of altitude reports: no altitude ever, no VS', () => {
    expect(formatVsReadout(0, false)).toBe('VS —');
    expect(formatVsReadout(1800, false)).toBe('VS —'); // a slope with no reports is fiction
    expect(formatVsReadout(0, true)).toBe('VS 0');
    expect(formatVsReadout(2004, true)).toBe('VS +2,000');
    expect(formatVsReadout(-1234, true)).toBe('VS −1,230');
  });

  it('a bank estimate needs BOTH speed and heading reported', () => {
    expect(bankEstimateAvailable(silent)).toBe(false);
    expect(bankEstimateAvailable({ speed: 250, altFt: null, heading: null })).toBe(false);
    expect(bankEstimateAvailable({ speed: null, altFt: null, heading: 90 })).toBe(false);
    expect(bankEstimateAvailable({ speed: 250, altFt: null, heading: 90 })).toBe(true);
    // Reported zeros are reports: 0 kt pointing north still has an estimate.
    expect(bankEstimateAvailable({ speed: 0, altFt: 0, heading: 0 })).toBe(true);
  });
});

describe('ride sky', () => {
  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
  ];
  const luminance = (hex: string): number => {
    const [r, g, b] = rgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  it('no ride, no sky — the map keeps whatever sky it already had', () => {
    expect(rideSkySpec(false, 'day')).toBeNull();
    expect(rideSkySpec(false, 'core')).toBeNull();
    expect(rideSkySpec(false, 'ghost')).toBeNull();
  });

  it('the DAY theme flies under the day sky, dark themes under the dusk one', () => {
    expect(rideSkySpec(true, 'day')).toBe(RIDE_SKY_DAY);
    expect(rideSkySpec(true, 'core')).toBe(RIDE_SKY_NIGHT);
    expect(rideSkySpec(true, 'ghost')).toBe(RIDE_SKY_NIGHT);
  });

  it('day sky: a blue zenith melting to a pale haze at the horizon', () => {
    const [r, g, b] = rgb(RIDE_SKY_DAY['sky-color']);
    expect(b).toBeGreaterThan(r); // blue-dominant overhead
    expect(b).toBeGreaterThan(g);
    // The gradient runs dark-to-light downward: the horizon haze is
    // far lighter than the zenith.
    expect(luminance(RIDE_SKY_DAY['horizon-color'])).toBeGreaterThan(luminance(RIDE_SKY_DAY['sky-color']) + 0.3);
  });

  it('the ground melts into the exact colour the sky starts from', () => {
    // fog == horizon is the seam trick: at the horizon line the
    // fogged far ground and the sky's first colour are one colour.
    expect(RIDE_SKY_DAY['fog-color']).toBe(RIDE_SKY_DAY['horizon-color']);
    expect(RIDE_SKY_NIGHT['fog-color']).toBe(RIDE_SKY_NIGHT['horizon-color']);
  });

  it('the physical atmosphere pass stays off — it ignores the palette', () => {
    // At its 0.8 default the renderer's Rayleigh/Mie pass washed the
    // horizon band to near-white regardless of these colours
    // (measured in the first live ride). Rides use the plain gradient.
    expect(RIDE_SKY_DAY['atmosphere-blend']).toBe(0);
    expect(RIDE_SKY_NIGHT['atmosphere-blend']).toBe(0);
  });

  it('night sky: deep indigo overhead, a dimmer dusk glow at the horizon', () => {
    expect(luminance(RIDE_SKY_NIGHT['sky-color'])).toBeLessThan(0.1);
    expect(luminance(RIDE_SKY_NIGHT['horizon-color'])).toBeGreaterThan(luminance(RIDE_SKY_NIGHT['sky-color']));
    expect(luminance(RIDE_SKY_NIGHT['horizon-color'])).toBeLessThan(luminance(RIDE_SKY_DAY['sky-color']));
    const [r, , b] = rgb(RIDE_SKY_NIGHT['sky-color']);
    expect(b).toBeGreaterThan(r); // indigo, not black-neutral
  });

  it('every blend stays inside 0..1 and the horizon actually blends', () => {
    for (const spec of [RIDE_SKY_DAY, RIDE_SKY_NIGHT]) {
      for (const key of ['sky-horizon-blend', 'horizon-fog-blend', 'fog-ground-blend'] as const) {
        expect(spec[key]).toBeGreaterThan(0);
        expect(spec[key]).toBeLessThanOrEqual(1);
      }
    }
  });
});

