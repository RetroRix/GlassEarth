import { beforeEach, describe, expect, it } from 'vitest';
import { GET, clearMaritimeSnapshot } from './route';

/* The Digitraffic merge, driven through the same globalThis maps the route
   reads. The live fetch itself is gated off under NODE_ENV=test (it would
   hang under fake timers and leak real ships into hermetic cases), so these
   cases seed the fetched state the way refreshDigitraffic() leaves it. */
const g = globalThis as unknown as {
  shipsCache: Map<number, any>;
  digitrafficShips?: Map<number, any>;
  digitrafficAt?: number;
};

function seedDigitrafficShip(mmsi: number, lat: number, lng: number) {
  g.digitrafficShips?.set(mmsi, {
    id: mmsi, mmsi, lat, lng, speed: 5, heading: 90,
    type: 'cargo', name: `BALTIC-${mmsi}`, timestamp: Date.now(), source: 'digitraffic',
  });
}

describe('GET /api/maritime — Digitraffic merge', () => {
  beforeEach(() => {
    g.shipsCache.clear();
    g.digitrafficShips = new Map();
    g.digitrafficAt = Date.now();
    clearMaritimeSnapshot();
  });

  it('counts keyless Baltic ships in the live total', async () => {
    seedDigitrafficShip(273388930, 59.9, 28.4); // Gulf of Finland
    seedDigitrafficShip(246279000, 60.1, 24.9); // off Helsinki
    const body = await (await GET()).json();

    expect(body.total_ships).toBe(2);
    expect(body.ship_sources).toEqual({ aisstream: 0, digitraffic: 2 });
    expect(body.ships.map((s: any) => s.name).sort()).toEqual(['BALTIC-246279000', 'BALTIC-273388930']);
  });

  it('drops Digitraffic ships older than the AIS freshness window', async () => {
    seedDigitrafficShip(273388930, 59.9, 28.4);
    const stale = g.digitrafficShips!.get(273388930);
    stale.timestamp = Date.now() - 11 * 60 * 1000;
    const body = await (await GET()).json();

    expect(body.total_ships).toBe(0);
  });

  it('keeps an aisstream ship over a Digitraffic duplicate MMSI', async () => {
    g.shipsCache.set(111222333, {
      id: 111222333, mmsi: 111222333, lat: 59.9, lng: 28.4, speed: 3,
      heading: 10, type: 'tanker', name: 'STREAMED', timestamp: Date.now(),
    });
    seedDigitrafficShip(111222333, 59.9, 28.4);
    const body = await (await GET()).json();

    expect(body.total_ships).toBe(1);
    expect(body.ships[0].name).toBe('STREAMED');
    expect(body.ship_sources).toEqual({ aisstream: 1, digitraffic: 0 });
  });
});
