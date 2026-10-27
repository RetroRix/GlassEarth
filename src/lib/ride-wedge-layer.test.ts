import { describe, it, expect } from 'vitest';
import {
  RIDE_WEDGE_LAYER_ID,
  WEDGE_OVERLAP_PX,
  createRideWedgeLayer,
  hexToRgba01,
  mercatorHorizonPx,
  rideWedgeHorizonUniforms,
  wedgeCovers,
} from './ride-wedge-layer';

describe('mercatorHorizonPx — the renderer horizon port', () => {
  it('at the ride pitch the horizon sits ~286px above centre for a 1350px camera', () => {
    // tan(14°)·0.85 = 0.21193 governs (below tan(89.25° − 76°)).
    expect(mercatorHorizonPx(1350, 76)).toBeCloseTo(286.1, 0);
  });

  it('looking straight down there is effectively no sky line in frame', () => {
    // pitch 0: tan(90°) is huge; the cap tan(89.25°) ≈ 76.4 governs.
    expect(mercatorHorizonPx(1000, 0)).toBeGreaterThan(70_000);
  });

  it('a steeper pitch pulls the horizon toward the centre', () => {
    expect(mercatorHorizonPx(1350, 85)).toBeLessThan(mercatorHorizonPx(1350, 76));
    expect(mercatorHorizonPx(1350, 60)).toBeGreaterThan(mercatorHorizonPx(1350, 76));
  });
});

describe('rideWedgeHorizonUniforms — the sky program line, verbatim form', () => {
  it('unrolled: the line sits horizon-px above centre, normal pointing up', () => {
    const u = rideWedgeHorizonUniforms({
      width: 1440, height: 900, pixelRatio: 1, rollRadians: 0,
      cameraToCenterDistance: 1350, pitchDegrees: 76,
    });
    expect(u.horizon[0]).toBeCloseTo(720, 6);
    expect(u.horizon[1]).toBeCloseTo(450 + 286.1, 0);
    expect(u.normal[0]).toBeCloseTo(0, 6);
    expect(u.normal[1]).toBeCloseTo(1, 6);
  });

  it('the pixel ratio scales the line into device pixels', () => {
    const u = rideWedgeHorizonUniforms({
      width: 1440, height: 900, pixelRatio: 2, rollRadians: 0,
      cameraToCenterDistance: 1350, pitchDegrees: 76,
    });
    expect(u.horizon[0]).toBeCloseTo(1440, 6);
    expect(u.horizon[1]).toBeCloseTo((450 + 286.1) * 2, 0);
  });

  it('roll rotates the point and the normal together', () => {
    const u = rideWedgeHorizonUniforms({
      width: 1440, height: 900, pixelRatio: 1, rollRadians: Math.PI / 2,
      cameraToCenterDistance: 1350, pitchDegrees: 76,
    });
    expect(u.normal[0]).toBeCloseTo(-1, 6);
    expect(u.normal[1]).toBeCloseTo(0, 6);
    expect(u.horizon[0]).toBeCloseTo(720 - 286.1, 0);
    expect(u.horizon[1]).toBeCloseTo(450, 1);
  });
});

describe('wedgeCovers — the shader test, mirrored', () => {
  const u = rideWedgeHorizonUniforms({
    width: 1440, height: 900, pixelRatio: 1, rollRadians: 0,
    cameraToCenterDistance: 1350, pitchDegrees: 76,
  });
  it('paints below the line (the wedge side) and at the line', () => {
    expect(wedgeCovers(720, 100, u)).toBe(true); // far below, GL y-up
    expect(wedgeCovers(720, u.horizon[1], u)).toBe(true);
  });
  it('leaves the sky side to the gradient, past the small overlap', () => {
    expect(wedgeCovers(720, u.horizon[1] + WEDGE_OVERLAP_PX + 1, u)).toBe(false);
    expect(wedgeCovers(720, 899, u)).toBe(false); // top of screen
  });
  it('the overlap reaches just past the line into the gradient', () => {
    expect(wedgeCovers(720, u.horizon[1] + WEDGE_OVERLAP_PX - 0.5, u)).toBe(true);
  });
});

describe('hexToRgba01', () => {
  it('parses the ride skies', () => {
    expect(hexToRgba01('#cfe2f2')).toEqual([207 / 255, 226 / 255, 242 / 255, 1]);
    expect(hexToRgba01('#46587a')).toEqual([70 / 255, 88 / 255, 122 / 255, 1]);
  });
  it('rejects anything that is not a 6-digit hex', () => {
    expect(hexToRgba01('red')).toBeNull();
    expect(hexToRgba01('#fff')).toBeNull();
    expect(hexToRgba01('')).toBeNull();
  });
});

describe('createRideWedgeLayer', () => {
  it('is a bottom-of-stack 2d custom layer with the stable id', () => {
    const layer = createRideWedgeLayer({ current: '#cfe2f2' });
    expect(layer.id).toBe(RIDE_WEDGE_LAYER_ID);
    expect(layer.type).toBe('custom');
    expect(layer.renderingMode).toBe('2d');
  });
  it('render before onAdd is a no-op, never a throw', () => {
    const layer = createRideWedgeLayer({ current: '#cfe2f2' });
    const gl = {} as WebGL2RenderingContext;
    expect(() => layer.render(gl, {} as never)).not.toThrow();
  });
});
