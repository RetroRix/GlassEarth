import { describe, expect, it } from 'vitest';
import {
  countdownTo, formatCountdown, groupSites, isProvisional, sitesToGeoJson, transformLaunches,
} from './launches';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0); // 2026-10-27T12:00:00Z
const H = 3_600_000;
const D = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString();

function ll2(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'x1',
    name: 'Falcon 9 Block 5 | Starlink Group 15-16',
    status: { id: 1, name: 'Go for Launch', abbrev: 'Go' },
    net: iso(NOW + 2 * H),
    launch_service_provider: { id: 121, name: 'SpaceX' },
    rocket: { configuration: { name: 'Falcon 9', full_name: 'Falcon 9 Block 5' } },
    mission: { name: 'Starlink Group 15-16', description: 'A batch of satellites.' },
    pad: {
      name: 'Space Launch Complex 4E', latitude: '34.632', longitude: '-120.611',
      location: { name: 'Vandenberg SFB, CA, USA' },
    },
    vidURLs: [{ url: 'https://youtube.com/watch?v=abc', title: 'Official Webcast' }],
    holdreason: '',
    ...over,
  };
}

describe('transformLaunches', () => {
  it('maps the feed fields verbatim and extracts the webcast', () => {
    const out = transformLaunches({ results: [ll2({})] }, { results: [] }, NOW);
    expect(out).toHaveLength(1);
    const l = out[0];
    expect(l.status).toBe('Go for Launch');
    expect(l.statusAbbrev).toBe('Go');
    expect(l.provider).toBe('SpaceX');
    expect(l.vehicle).toBe('Falcon 9 Block 5');
    expect(l.padName).toBe('Space Launch Complex 4E');
    expect(l.siteName).toBe('Vandenberg SFB, CA, USA');
    expect(l.lat).toBeCloseTo(34.632);
    expect(l.lng).toBeCloseTo(-120.611);
    expect(l.missionDescription).toBe('A batch of satellites.');
    expect(l.webcastUrl).toBe('https://youtube.com/watch?v=abc');
    expect(l.holdReason).toBeNull();
  });

  it('keeps the window: next 30 days + recent 7 days only', () => {
    const out = transformLaunches({ results: [
      ll2({ id: 'soon', net: iso(NOW + H) }),
      ll2({ id: 'edge-in', net: iso(NOW + 29 * D) }),
      ll2({ id: 'too-far', net: iso(NOW + 31 * D) }),
    ] }, { results: [
      ll2({ id: 'recent', net: iso(NOW - 3 * D), status: { id: 3, name: 'Success', abbrev: 'Success' } }),
      ll2({ id: 'too-old', net: iso(NOW - 8 * D) }),
    ] }, NOW);
    expect(out.map(l => l.id)).toEqual(['recent', 'soon', 'edge-in']);
  });

  it('de-duplicates by id with the upcoming record winning, sorted soonest first', () => {
    const out = transformLaunches({ results: [
      ll2({ id: 'b', net: iso(NOW + 5 * H) }),
      ll2({ id: 'a', net: iso(NOW + H), status: { id: 1, name: 'Go for Launch', abbrev: 'Go' } }),
    ] }, { results: [
      ll2({ id: 'a', net: iso(NOW + H), status: { id: 2, name: 'To Be Confirmed', abbrev: 'TBC' } }),
    ] }, NOW);
    expect(out.map(l => l.id)).toEqual(['a', 'b']);
    expect(out[0].statusAbbrev).toBe('Go');
  });

  it('drops records with no NET, no id, or no pad coordinates', () => {
    const out = transformLaunches({ results: [
      ll2({ id: 'bad-net', net: 'not a date' }),
      ll2({ id: '', net: iso(NOW + H) }),
      ll2({ id: 'no-pad', pad: { name: 'Nowhere', latitude: null, longitude: null } }),
      ll2({ id: 'ok' }),
    ] }, null, NOW);
    expect(out.map(l => l.id)).toEqual(['ok']);
  });

  it('carries a hold reason and no webcast when the feed has none', () => {
    const out = transformLaunches({ results: [
      ll2({ status: { id: 5, name: 'On Hold', abbrev: 'Hold' }, holdreason: 'Range unavailable', vidURLs: undefined }),
    ] }, null, NOW);
    expect(out[0].holdReason).toBe('Range unavailable');
    expect(out[0].webcastUrl).toBeNull();
  });
});

describe('groupSites / sitesToGeoJson', () => {
  it('groups by pad and emits parseable popup payloads', () => {
    const launches = transformLaunches({ results: [
      ll2({ id: 'a' }),
      ll2({ id: 'b', net: iso(NOW + 5 * H) }),
      ll2({ id: 'c', pad: { name: 'LC-39A', latitude: '28.608', longitude: '-80.604', location: { name: 'Kennedy Space Center, FL, USA' } } }),
    ] }, null, NOW);
    const sites = groupSites(launches);
    expect(sites).toHaveLength(2);
    expect(sites[0].launches).toHaveLength(2); // busiest site first
    const fc = sitesToGeoJson(sites);
    expect(fc.features).toHaveLength(2);
    const first = fc.features[0];
    expect(first.geometry).toEqual({ type: 'Point', coordinates: [-120.611, 34.632] });
    const parsed = JSON.parse(String((first.properties as Record<string, unknown>).launchesJson));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].status).toBe('Go for Launch');
  });
});

describe('countdown', () => {
  it('counts down with days and formats T−', () => {
    const c = countdownTo(iso(NOW + 2 * D + 4 * H + 13 * 60_000 + 22_000), NOW);
    expect(c).not.toBeNull();
    expect(c!.past).toBe(false);
    expect(formatCountdown(c!)).toBe('T−2d 04:13:22');
  });

  it('counts up after NET as T+', () => {
    const c = countdownTo(iso(NOW - (12 * 60_000 + 33_000)), NOW);
    expect(c!.past).toBe(true);
    expect(formatCountdown(c!)).toBe('T+00:12:33');
  });

  it('returns null for an unparseable NET', () => {
    expect(countdownTo('whenever', NOW)).toBeNull();
  });
});

describe('isProvisional', () => {
  it('flags only TBC / TBD, case-insensitively', () => {
    expect(isProvisional('TBC')).toBe(true);
    expect(isProvisional('tbd')).toBe(true);
    expect(isProvisional('Go')).toBe(false);
    expect(isProvisional('Hold')).toBe(false);
    expect(isProvisional('Success')).toBe(false);
  });
});
