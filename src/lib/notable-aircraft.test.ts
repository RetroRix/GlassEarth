import { describe, expect, it } from 'vitest';
import { evaluateNotableAircraft, matchNotable, type FlightLike } from './notable-aircraft';

const NOW = Date.parse('2026-11-02T18:00:00Z');
const flight = (partial: Partial<FlightLike>): FlightLike => ({
  icao24: 'ae1234', callsign: 'XXXX1', model: 'A320', lat: 35, lng: -100, alt: 10_000, ...partial,
});

describe('matchNotable', () => {
  it('matches the unambiguous types on type alone', () => {
    expect(matchNotable(flight({ model: 'B52' }))?.label).toBe('B-52 Stratofortress');
    expect(matchNotable(flight({ model: 'Q4' }))?.label).toBe('RQ-4 Global Hawk');
    expect(matchNotable(flight({ model: 'K35R' }))?.label).toBe('KC-135 Stratotanker');
    expect(matchNotable(flight({ model: 'B2' }))?.label).toBe('B-2 Spirit');
  });

  it('matches AF1 / AF2 / VENUS / SAM callsigns', () => {
    expect(matchNotable(flight({ callsign: 'AF1' }))?.label).toBe('Air Force One');
    expect(matchNotable(flight({ callsign: 'AF2' }))?.label).toBe('Air Force Two');
    expect(matchNotable(flight({ callsign: 'VENUS02' }))?.label).toContain('VC-25');
    expect(matchNotable(flight({ callsign: 'SAM461' }))?.label).toContain('Special Air Mission');
  });

  it('matches an E-4B by registration', () => {
    expect(matchNotable(flight({ model: 'B742', registration: '73-1676' }))?.label).toBe('E-4B Nightwatch');
  });

  it('qualifies shared airframes: a DC-10 needs a military callsign', () => {
    expect(matchNotable(flight({ model: 'DC10', callsign: 'FDX123' }))).toBeNull();
    expect(matchNotable(flight({ model: 'DC10', callsign: 'TEAM23' }))?.label).toBe('KC-10 Extender');
    expect(matchNotable(flight({ model: 'B762', callsign: 'RCH1812' }))?.label).toBe('KC-46 Pegasus');
  });

  it('matches RC-135 working callsigns', () => {
    expect(matchNotable(flight({ callsign: 'JAKE21', model: 'B703' }))?.label).toContain('RC-135');
  });

  it('leaves ordinary traffic alone', () => {
    expect(matchNotable(flight({}))).toBeNull();
    expect(matchNotable(flight({ model: 'B738', callsign: 'UAL123' }))).toBeNull();
    expect(matchNotable(flight({ model: 'B742', callsign: 'CLX771' }))).toBeNull();
  });
});

describe('evaluateNotableAircraft', () => {
  it('emits sighting-honest alerts, one per aircraft per day', () => {
    const out = evaluateNotableAircraft([flight({ model: 'B52', callsign: 'DOOM51' })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('aircraft');
    expect(out[0].id).toBe('aircraft:ae1234:2026-11-02');
    expect(out[0].title).toContain('B-52 Stratofortress');
    expect(out[0].body).toContain('no sighting never means none are flying');
    expect(out[0].body).toContain('32,808 ft');
  });

  it('skips grounded aircraft and rows without a hex or position', () => {
    const out = evaluateNotableAircraft([
      flight({ model: 'B52', grounded: true }),
      flight({ model: 'B52', icao24: '' }),
      flight({ model: 'B52', lat: Number.NaN }),
    ], NOW);
    expect(out).toEqual([]);
  });
});
