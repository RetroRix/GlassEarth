import { describe, expect, it } from 'vitest';
import { binForSlot, cycloneLayersFromMetadata, escapeHtml, tagCycloneFeatures } from './cyclones';

const META = {
  layers: [
    { id: 0, name: 'Graphical Tropical Weather Outlook' },
    { id: 8, name: 'AT1 Forecast Cone' },
    { id: 7, name: 'AT1 Forecast Track' },
    { id: 6, name: 'AT1 Forecast Points' },
    { id: 9, name: 'AT1 Watch-Warning' },
    { id: 164, name: 'EP2 Forecast Cone' },
    { id: 318, name: 'CP3 Forecast Track' },
    { id: 395, name: 'Probabilistic Winds 34 kts' },
    { id: 'x', name: 'AT2 Forecast Cone' },
  ],
};

describe('cycloneLayersFromMetadata', () => {
  it('finds exactly the cone/track/points layers, with basin slots', () => {
    expect(cycloneLayersFromMetadata(META)).toEqual([
      { id: 8, slot: 'AT1', kind: 'cone' },
      { id: 7, slot: 'AT1', kind: 'track' },
      { id: 6, slot: 'AT1', kind: 'points' },
      { id: 164, slot: 'EP2', kind: 'cone' },
      { id: 318, slot: 'CP3', kind: 'track' },
    ]);
  });
  it('survives junk metadata', () => {
    expect(cycloneLayersFromMetadata(null)).toEqual([]);
    expect(cycloneLayersFromMetadata({ layers: 'no' })).toEqual([]);
  });
});

describe('binForSlot', () => {
  it('maps MapServer slots to NHC bin numbers (AT is AL at NHC)', () => {
    expect(binForSlot('AT1')).toBe('AL1');
    expect(binForSlot('EP2')).toBe('EP2');
    expect(binForSlot('CP3')).toBe('CP3');
  });
});

describe('tagCycloneFeatures', () => {
  it('tags features with kind + slot and drops geometry-less rows', () => {
    const fc = {
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { stormname: 'Vance' } },
        { type: 'Feature', geometry: null, properties: { stormname: 'Ghost' } },
      ],
    };
    expect(tagCycloneFeatures(fc, { id: 164, slot: 'EP2', kind: 'cone' })).toEqual([
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { stormname: 'Vance', kind: 'cone', slot: 'EP2' } },
    ]);
    expect(tagCycloneFeatures(null, { id: 1, slot: 'AT1', kind: 'track' })).toEqual([]);
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML specials', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    expect(escapeHtml(undefined)).toBe('');
  });
});
