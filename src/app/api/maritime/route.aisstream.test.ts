import { beforeEach, describe, expect, it } from 'vitest';
import { GET, clearMaritimeSnapshot } from './route';

/* The AISStream payload contract. The socket collection itself is gated off
   under NODE_ENV=test (same seam as Digitraffic), so these cases assert what
   a caller can always rely on: the status block is present, it tells the
   truth about configuration, and collected vessels (seeded the way
   ensureAisstream leaves them) surface with their source labelled. */
const g = globalThis as unknown as {
  shipsCache: Map<number, any>;
  aisstreamMeta?: { status: string; at: number; vessels: number };
};

describe('GET /api/maritime — aisstream block', () => {
  beforeEach(() => {
    g.shipsCache.clear();
    delete g.aisstreamMeta;
    clearMaritimeSnapshot();
  });

  it('states plainly that AISStream is not configured when no key is set', async () => {
    const body = await (await GET()).json();
    expect(body.aisstream.configured).toBe(false);
    expect(body.aisstream.status).toBe('not-configured');
    expect(body.aisstream.coverage).toContain('Terrestrial AIS');
    expect(body.aisstream.vessels).toBe(0);
  });

  it('labels collected vessels as aisstream in ship_sources', async () => {
    g.shipsCache.set(244123456, {
      id: 244123456, mmsi: 244123456, lat: 51.95, lng: 3.9, speed: 8,
      heading: 90, type: 'tanker', name: 'STREAMED', destination: 'ROTTERDAM',
      timestamp: Date.now(), source: 'aisstream',
    });
    const body = await (await GET()).json();
    expect(body.total_ships).toBe(1);
    expect(body.ship_sources).toEqual({ aisstream: 1, digitraffic: 0 });
    expect(body.aisstream.vessels).toBe(1);
    expect(body.ships[0].source).toBe('aisstream');
    expect(body.ships[0].destination).toBe('ROTTERDAM');
  });

  it('drops collected vessels whose last report is older than the freshness window', async () => {
    g.shipsCache.set(244123456, {
      id: 244123456, mmsi: 244123456, lat: 51.95, lng: 3.9, speed: 8,
      heading: 90, type: 'cargo', name: 'STALE',
      timestamp: Date.now() - 11 * 60 * 1000, source: 'aisstream',
    });
    const body = await (await GET()).json();
    expect(body.total_ships).toBe(0);
    expect(body.aisstream.vessels).toBe(0);
  });
});
