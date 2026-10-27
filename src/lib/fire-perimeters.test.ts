import { describe, expect, it } from 'vitest';
import { categoryLabel, normalizeIrwinId, transformIncidents, transformPerimeters } from './fire-perimeters';

const POLY = { type: 'Polygon', coordinates: [[[-110, 44], [-109, 44], [-109, 45], [-110, 44]]] };
const T1 = Date.UTC(2026, 9, 26, 22, 14, 17); // 2026-10-26T22:14:17Z
const T2 = Date.UTC(2026, 9, 20, 8, 0, 0);

const PERIMETERS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature', geometry: POLY,
      properties: {
        poly_IncidentName: 'Sellers Lake 2', poly_GISAcres: 74.1, poly_DateCurrent: T1,
        attr_IncidentName: 'Sellers Lake 2', attr_PercentContained: null,
        attr_POOProtectingAgency: 'USFS', attr_IncidentTypeCategory: 'WF',
        attr_IrwinID: '{8AD4B895-5E4E-4995-82D0-C0F5078AF365}',
      },
    },
    {
      type: 'Feature', geometry: POLY,
      properties: {
        poly_IncidentName: 'Shell', poly_GISAcres: 2795.06, poly_DateCurrent: T1,
        attr_PercentContained: 100, attr_POOProtectingAgency: 'USFS',
        attr_IncidentTypeCategory: 'WF', attr_IrwinID: 'AAAA1111-2222-3333-4444-555555555555',
      },
    },
    { type: 'Feature', geometry: null, properties: { poly_IncidentName: 'Ghost' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { poly_IncidentName: 'Not a polygon' } },
  ],
};

const INCIDENTS = {
  type: 'FeatureCollection',
  features: [
    { // same fire as perimeter 1 (braced vs unbraced id, different case) → dropped
      type: 'Feature', geometry: { type: 'Point', coordinates: [-110, 44.5] },
      properties: {
        IncidentName: 'Sellers Lake 2', IncidentSize: 74, PercentContained: null,
        POOProtectingAgency: 'USFS', IncidentTypeCategory: 'WF',
        ModifiedOnDateTime_dt: T1, FireDiscoveryDateTime: T2,
        IrwinID: '8ad4b895-5e4e-4995-82d0-c0f5078af365',
      },
    },
    { // no perimeter → kept
      type: 'Feature', geometry: { type: 'Point', coordinates: [-106.3, 31.8] },
      properties: {
        IncidentName: 'VEG/CBT/94A', IncidentSize: 0.01, PercentContained: 0,
        POOProtectingAgency: 'BLM', IncidentTypeCategory: 'WF',
        ModifiedOnDateTime_dt: T1, IrwinID: '{3B981943-EF8C-431B-96C9-33EB7EADD510}',
      },
    },
    { // duplicate report of the same incident → de-duped
      type: 'Feature', geometry: { type: 'Point', coordinates: [-106.3, 31.8] },
      properties: {
        IncidentName: 'VEG/CBT/94A', IncidentSize: 0.01, IncidentTypeCategory: 'WF',
        IrwinID: '{3B981943-EF8C-431B-96C9-33EB7EADD510}',
      },
    },
    { // geometry-less but carries its own initial location → point built from it
      type: 'Feature', geometry: null,
      properties: {
        IncidentName: 'No Geometry RX', IncidentSize: 12, IncidentTypeCategory: 'RX',
        InitialLatitude: 35.2, InitialLongitude: -111.5, IrwinID: '{DEADBEEF-0000-0000-0000-000000000000}',
      },
    },
    { // geometry-less and no initial location → dropped
      type: 'Feature', geometry: null,
      properties: { IncidentName: 'Nowhere', IrwinID: '{FEEDFACE-0000-0000-0000-000000000000}' },
    },
  ],
};

describe('normalizeIrwinId', () => {
  it('strips braces, trims and upper-cases; junk becomes empty', () => {
    expect(normalizeIrwinId('{8ad4b895-x}')).toBe('8AD4B895-X');
    expect(normalizeIrwinId('  abc ')).toBe('ABC');
    expect(normalizeIrwinId(null)).toBe('');
    expect(normalizeIrwinId(42)).toBe('');
  });
});

describe('categoryLabel', () => {
  it('labels the WFIGS category codes honestly', () => {
    expect(categoryLabel('WF')).toBe('Wildfire');
    expect(categoryLabel('rx')).toBe('Prescribed fire');
    expect(categoryLabel('CX')).toBe('Fire complex');
    expect(categoryLabel('??')).toBe('Fire incident');
    expect(categoryLabel(null)).toBe('Fire incident');
  });
});

describe('transformPerimeters', () => {
  it('keeps polygon features with labelled, feed-carried properties only', () => {
    const out = transformPerimeters(PERIMETERS);
    expect(out).toHaveLength(2);
    expect(out[0].properties).toEqual({
      kind: 'perimeter', name: 'Sellers Lake 2', acres: 74.1, containment: null,
      agency: 'USFS', category: 'WF', reportedAt: new Date(T1).toISOString(),
      discoveredAt: null, irwinId: '8AD4B895-5E4E-4995-82D0-C0F5078AF365',
    });
    // A reported 100% containment survives; a reported null stays null (never invented).
    expect(out[1].properties.containment).toBe(100);
  });
  it('survives junk input', () => {
    expect(transformPerimeters(null)).toEqual([]);
    expect(transformPerimeters({ features: 'no' })).toEqual([]);
  });
});

describe('transformIncidents', () => {
  it('drops incidents that have a perimeter, dedupes, and falls back to initial location', () => {
    const perims = transformPerimeters(PERIMETERS);
    const ids = new Set(perims.map(f => f.properties.irwinId).filter(Boolean));
    const out = transformIncidents(INCIDENTS, ids);
    expect(out.map(f => f.properties.name)).toEqual(['VEG/CBT/94A', 'No Geometry RX']);
    // A reported 0% containment is data and stays 0.
    expect(out[0].properties.containment).toBe(0);
    expect(out[0].properties.agency).toBe('BLM');
    expect(out[0].properties.reportedAt).toBe(new Date(T1).toISOString());
    expect(out[1].geometry).toEqual({ type: 'Point', coordinates: [-111.5, 35.2] });
    expect(out[1].properties.category).toBe('RX');
  });
  it('keeps every incident when there are no perimeters', () => {
    const out = transformIncidents(INCIDENTS, new Set());
    expect(out.map(f => f.properties.name)).toEqual(['Sellers Lake 2', 'VEG/CBT/94A', 'No Geometry RX']);
    expect(transformIncidents(null, new Set())).toEqual([]);
  });
});
