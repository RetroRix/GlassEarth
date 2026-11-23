import { describe, it, expect } from 'vitest';
import {
  cameraProximity, nearbyQuakes, nearbyWeatherEvents,
  nextSunEvents, solarSummary, dossierTitle, formatCoords, formatKm,
  type DossierCameraLike, type WeatherEventLike,
} from './place-dossier';
import type { QuakeLike } from './smart-alerts';

/* El Paso — the app's home base, and a camera-dense point to measure from. */
const EL_PASO = { lat: 31.7619, lng: -106.485 };

const cam = (id: string, lat: unknown, lng: unknown, extra: Record<string, unknown> = {}): DossierCameraLike =>
  ({ id, name: `Cam ${id}`, lat, lng, ...extra });

describe('cameraProximity', () => {
  const cameras = [
    cam('far', 40.0, -100.0),          // ~970 km away
    cam('near', 31.80, -106.45),       // ~5 km away
    cam('mid', '32.50', '-105.50'),    // ~120 km away, string coords as the catalogue sometimes carries
    cam('broken', 'north', null),      // unusable coordinates — skipped, never placed
    cam('alsobroken', 200, 0),         // out of range — skipped
  ];

  it('lists cameras inside the radius nearest first, with true distances', () => {
    const r = cameraProximity(cameras, EL_PASO);
    expect(r.within.map(x => x.cam.id)).toEqual(['near', 'mid']);
    expect(r.totalWithin).toBe(2);
    expect(r.within[0].distanceKm).toBeGreaterThan(3);
    expect(r.within[0].distanceKm).toBeLessThan(8);
    expect(r.within[1].distanceKm).toBeGreaterThan(100);
    expect(r.within[1].distanceKm).toBeLessThan(150);
  });

  it('names the nearest camera anywhere when nothing is inside the radius', () => {
    const r = cameraProximity([cam('far', 40.0, -100.0)], EL_PASO, 250);
    expect(r.within).toEqual([]);
    expect(r.totalWithin).toBe(0);
    expect(r.nearest?.cam.id).toBe('far');
    expect(r.nearest!.distanceKm).toBeGreaterThan(900);
  });

  it('answers nearest null for an empty or positionless catalogue', () => {
    expect(cameraProximity([], EL_PASO).nearest).toBeNull();
    expect(cameraProximity([cam('broken', 'x', undefined)], EL_PASO).nearest).toBeNull();
  });

  it('respects the limit while still counting everything inside', () => {
    const many = Array.from({ length: 10 }, (_, i) => cam(`c${i}`, 31.76 + i * 0.01, -106.48));
    const r = cameraProximity(many, EL_PASO, 250, 3);
    expect(r.within).toHaveLength(3);
    expect(r.totalWithin).toBe(10);
  });
});

const quake = (id: string, lat: number, lng: number, magnitude: number | null, time: number): QuakeLike =>
  ({ id, lat, lng, magnitude, place: `Place ${id}`, time });

describe('nearbyQuakes', () => {
  const now = Date.parse('2026-11-23T18:00:00Z');
  const quakes = [
    quake('recent-near', 31.9, -106.3, 4.2, now - 60 * 60_000),          // 1 h ago, ~25 km
    quake('older-near', 32.2, -106.0, 5.1, now - 5 * 60 * 60_000),       // 5 h ago, ~65 km
    quake('too-old', 31.8, -106.4, 6.0, now - 25 * 60 * 60_000),         // outside the feed's 24 h window
    quake('future', 31.8, -106.4, 6.0, now + 60_000),                    // a feed artefact, not an event
    quake('no-mag', 31.8, -106.4, null, now - 60_000),                   // no magnitude — not scored
    quake('far', 0, 0, 7.0, now - 60_000),                               // real, but thousands of km away
  ];

  it('keeps only in-radius quakes inside the 24 h window, newest first', () => {
    const r = nearbyQuakes(quakes, EL_PASO, now);
    expect(r.list.map(x => x.quake.id)).toEqual(['recent-near', 'older-near']);
    expect(r.total).toBe(2);
    expect(r.list[0].distanceKm).toBeLessThan(40);
  });

  it('finds nothing at an ocean point rather than reaching further', () => {
    const r = nearbyQuakes(quakes, { lat: 0, lng: -30 }, now);
    expect(r.total).toBe(0);
    expect(r.list).toEqual([]);
  });
});

describe('nearbyWeatherEvents', () => {
  const events: WeatherEventLike[] = [
    { id: 'low-near', title: 'Flood watch', severity: 'low', lat: 31.85, lng: -106.40 },
    { id: 'high-mid', title: 'Severe storm', severity: 'high', lat: 33.0, lng: -105.5 },
    { id: 'far', title: 'Cyclone', severity: 'high', lat: 0, lng: 0 },
    { id: 'broken', title: 'Nowhere', severity: 'high', lat: 'x', lng: null },
  ];

  it('orders by severity, then distance, and skips unplaceable rows', () => {
    const r = nearbyWeatherEvents(events, EL_PASO);
    expect(r.list.map(x => x.event.id)).toEqual(['high-mid', 'low-near']);
    expect(r.total).toBe(2);
  });
});

describe('nextSunEvents + solarSummary', () => {
  it('finds the next sunrise and sunset for El Paso, sunset first in the morning', () => {
    const now = Date.parse('2026-11-23T18:00:00Z'); // 11:00 MST — mid-morning
    const r = nextSunEvents(EL_PASO.lat, EL_PASO.lng, now);
    expect(r.nextSunsetMs).not.toBeNull();
    expect(r.nextSunriseMs).not.toBeNull();
    expect(r.nextSunsetMs!).toBeGreaterThan(now);
    expect(r.nextSunriseMs!).toBeGreaterThan(r.nextSunsetMs!);
    /* Sunset that evening (~00:1x UTC) and sunrise next morning (~14:0x UTC). */
    expect(r.nextSunsetMs! - now).toBeLessThan(12 * 60 * 60_000);
    expect(r.nextSunriseMs! - now).toBeLessThan(24 * 60 * 60_000);
  });

  it('calls mid-morning day and the small hours night, from the model itself', () => {
    const day = solarSummary(EL_PASO.lat, EL_PASO.lng, Date.parse('2026-11-23T18:00:00Z'));
    expect(day.phase).toBe('day');
    expect(day.elevationDeg).toBeGreaterThan(0);
    const night = solarSummary(EL_PASO.lat, EL_PASO.lng, Date.parse('2026-11-23T08:00:00Z')); // 01:00 MST
    expect(night.phase).toBe('night');
    expect(night.elevationDeg).toBeLessThan(0);
  });

  it('answers nulls at the pole in summer — the sun never crosses', () => {
    const r = nextSunEvents(80, 0, Date.parse('2026-06-21T12:00:00Z'));
    expect(r.nextSunriseMs).toBeNull();
    expect(r.nextSunsetMs).toBeNull();
    const s = solarSummary(80, 0, Date.parse('2026-06-21T12:00:00Z'));
    expect(s.phase).toBe('day');
  });

  it('answers nulls at the pole in winter, and calls it night', () => {
    const r = nextSunEvents(80, 0, Date.parse('2026-12-21T12:00:00Z'));
    expect(r.nextSunriseMs).toBeNull();
    expect(r.nextSunsetMs).toBeNull();
    expect(solarSummary(80, 0, Date.parse('2026-12-21T12:00:00Z')).phase).toBe('night');
  });
});

describe('dossierTitle', () => {
  it('prefers the name the visitor actually picked', () => {
    expect(dossierTitle('Eiffel Tower', 'Paris, France', 48.8584, 2.2945)).toBe('Eiffel Tower');
  });

  it('falls back to the app’s reverse-geocode label', () => {
    expect(dossierTitle(null, 'El Paso, Texas, United States', EL_PASO.lat, EL_PASO.lng))
      .toBe('El Paso, Texas, United States');
    expect(dossierTitle('  ', '  ', EL_PASO.lat, EL_PASO.lng)).toBe(formatCoords(EL_PASO.lat, EL_PASO.lng));
  });

  it('uses the coordinates themselves when no real name exists — never an invented one', () => {
    expect(dossierTitle(null, null, 0, -30)).toBe('0.0000° N, 30.0000° W');
    expect(formatCoords(-33.8688, 151.2093)).toBe('33.8688° S, 151.2093° E');
  });
});

describe('formatKm', () => {
  it('speaks distances the way the panels do', () => {
    expect(formatKm(4.24)).toBe('4.2 km');
    expect(formatKm(37.4)).toBe('37 km');
    expect(formatKm(1240)).toBe('1,240 km');
    expect(formatKm(Number.NaN)).toBe('—');
  });
});
