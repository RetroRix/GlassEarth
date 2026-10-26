import { describe, expect, it } from 'vitest';
import {
  CAMERA_FULL_PAINT,
  CAMERA_GHOST_FADE_MS,
  CAMERA_POPULATE_FADE_MS,
  CAMERA_POPULATE_ZOOM,
  CAMERA_SETTLE_MS,
  cameraGhostFadeMs,
  cameraGhostPaint,
  cameraGhostState,
  type CameraGhostTheme,
} from './camera-ghosting';
import { HOME_BASE } from './opening-view';

const THEMES: CameraGhostTheme[] = ['core', 'ghost', 'day'];

describe('cameraGhostState — the rule', () => {
  it('settled and zoomed in is populated', () => {
    expect(cameraGhostState({ zoom: 13, settled: true })).toBe('full');
    expect(cameraGhostState({ zoom: 18, settled: true })).toBe('full');
  });

  it('settled but zoomed out is ghosts — region, continent, globe', () => {
    expect(cameraGhostState({ zoom: 5, settled: true })).toBe('ghost');
    expect(cameraGhostState({ zoom: 2.5, settled: true })).toBe('ghost');
  });

  it('in motion is ghosts at any zoom, even street level', () => {
    expect(cameraGhostState({ zoom: 14, settled: false })).toBe('ghost');
    expect(cameraGhostState({ zoom: 9, settled: false })).toBe('ghost');
  });

  it('the threshold itself populates — it is the home-base zoom', () => {
    expect(CAMERA_POPULATE_ZOOM).toBe(HOME_BASE.zoom);
    expect(cameraGhostState({ zoom: CAMERA_POPULATE_ZOOM, settled: true })).toBe('full');
    expect(cameraGhostState({ zoom: CAMERA_POPULATE_ZOOM - 0.01, settled: true })).toBe('ghost');
  });

  it('a garbage zoom never populates', () => {
    expect(cameraGhostState({ zoom: NaN, settled: true })).toBe('ghost');
    expect(cameraGhostState({ zoom: Infinity, settled: true })).toBe('ghost');
    expect(cameraGhostState({ zoom: -Infinity, settled: true })).toBe('ghost');
  });
});

describe('cameraGhostPaint', () => {
  it('full strength is what the layers have always drawn', () => {
    expect(CAMERA_FULL_PAINT).toEqual({ dots: 0.9, stroke: 0.9, glow: 0.35, label: 0.8 });
    for (const theme of THEMES) {
      const paint = cameraGhostPaint(theme, 'full');
      expect(paint.dots).toBe(0.9);
      expect(paint.stroke).toBe(0.9);
      expect(paint.glow).toBe(0.35);
    }
    expect(cameraGhostPaint('core', 'full').label).toBe(0.8);
    expect(cameraGhostPaint('ghost', 'full').label).toBe(0.8);
    /* Day's label treatment (CCTV_LABEL_DAY) asks for full opacity. */
    expect(cameraGhostPaint('day', 'full').label).toBe(1);
  });

  it('every ghost channel is fainter than full — including the ring', () => {
    for (const theme of THEMES) {
      const ghost = cameraGhostPaint(theme, 'ghost');
      const full = cameraGhostPaint(theme, 'full');
      expect(ghost.dots).toBeLessThan(full.dots);
      expect(ghost.stroke).toBeLessThan(full.stroke);
      expect(ghost.glow).toBeLessThan(full.glow);
      expect(ghost.label).toBeLessThan(full.label);
    }
  });

  it('ghosts stay visible in every theme — faint, never gone', () => {
    for (const theme of THEMES) {
      const ghost = cameraGhostPaint(theme, 'ghost');
      expect(ghost.dots).toBeGreaterThanOrEqual(0.15);
      expect(ghost.label).toBeGreaterThan(0);
    }
  });

  it('day ghosts carry more presence than dark-theme ghosts (pale basemap)', () => {
    expect(cameraGhostPaint('day', 'ghost').dots).toBeGreaterThan(cameraGhostPaint('core', 'ghost').dots);
    expect(cameraGhostPaint('day', 'ghost').label).toBeGreaterThan(cameraGhostPaint('core', 'ghost').label);
  });

  it('the two dark themes ghost identically', () => {
    expect(cameraGhostPaint('ghost', 'ghost')).toEqual(cameraGhostPaint('core', 'ghost'));
  });
});

describe('fade + settle timing', () => {
  it('populating fades slower than ghosting', () => {
    expect(cameraGhostFadeMs('full')).toBe(CAMERA_POPULATE_FADE_MS);
    expect(cameraGhostFadeMs('ghost')).toBe(CAMERA_GHOST_FADE_MS);
    expect(CAMERA_POPULATE_FADE_MS).toBeGreaterThan(CAMERA_GHOST_FADE_MS);
    expect(CAMERA_GHOST_FADE_MS).toBeGreaterThan(0);
  });

  it('the settle window is a beat, not the 1.5 s the view memory waits', () => {
    expect(CAMERA_SETTLE_MS).toBeGreaterThan(0);
    expect(CAMERA_SETTLE_MS).toBeLessThan(1500);
  });
});
