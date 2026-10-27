import { describe, expect, it } from 'vitest';
import {
  SATELLITE_REFERENCE_ANCHOR,
  SATELLITE_REFERENCE_LAYERS,
  SATELLITE_REFERENCE_MAX_ZOOM,
  SATELLITE_REFERENCE_TILE_SIZE,
} from './satellite-reference';

describe('satellite reference overlay (hybrid satellite)', () => {
  it('carries exactly the two Esri reference services', () => {
    expect(SATELLITE_REFERENCE_LAYERS).toHaveLength(2);
    const urls = SATELLITE_REFERENCE_LAYERS.map(s => s.tiles[0]);
    expect(urls[0]).toContain('/Reference/World_Transportation/');
    expect(urls[1]).toContain('/Reference/World_Boundaries_and_Places/');
  });

  it('uses the imagery host and its {z}/{y}/{x} tile order', () => {
    for (const spec of SATELLITE_REFERENCE_LAYERS) {
      expect(spec.tiles).toHaveLength(1);
      expect(spec.tiles[0]).toMatch(
        /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/Reference\/.+\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/,
      );
    }
  });

  it('inserts transportation first so boundaries & places land on top', () => {
    // Each spec is added below the same anchor, so a later insert sits
    // above an earlier one: names and borders must be the topmost paint.
    expect(SATELLITE_REFERENCE_LAYERS[0].layerId).toBe('satellite-reference-transport');
    expect(SATELLITE_REFERENCE_LAYERS[1].layerId).toBe('satellite-reference-places');
  });

  it('has unique layer and source ids', () => {
    const layerIds = SATELLITE_REFERENCE_LAYERS.map(s => s.layerId);
    const sourceIds = SATELLITE_REFERENCE_LAYERS.map(s => s.sourceId);
    expect(new Set(layerIds).size).toBe(layerIds.length);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });

  it('credits each service on its source', () => {
    for (const spec of SATELLITE_REFERENCE_LAYERS) {
      expect(spec.attribution).toContain('Esri');
      expect(spec.attribution.length).toBeGreaterThan(10);
    }
  });

  it('anchors into the imagery slot, below every app data layer', () => {
    expect(SATELLITE_REFERENCE_ANCHOR).toBe('day-night-fill');
  });

  it('matches the imagery raster geometry (256px tiles to zoom 18)', () => {
    expect(SATELLITE_REFERENCE_TILE_SIZE).toBe(256);
    expect(SATELLITE_REFERENCE_MAX_ZOOM).toBe(18);
  });
});
