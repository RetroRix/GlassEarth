import { describe, expect, it } from 'vitest';
import {
  aisShipType,
  applyAisMessage,
  bboxCellKey,
  clampBboxSpan,
  collectAisstreamSnapshot,
  createAisState,
  parseAisUtc,
  parseBboxParam,
  subscriptionBoxes,
  vesselAgeMs,
  vesselsWithPositions,
  type AisSocketLike,
} from './aisstream';

/* Fixtures shaped like the real AISStream frames (Rotterdam roads). */
const RECEIVED = Date.UTC(2026, 9, 27, 7, 15, 0);

function positionReport(mmsi: number, overrides: Record<string, any> = {}) {
  return {
    MessageType: 'PositionReport',
    MetaData: {
      MMSI: mmsi,
      ShipName: 'TEST VESSEL ',
      latitude: 51.95,
      longitude: 3.9,
      time_utc: '2026-10-27 07:12:34.123456 +0000 UTC',
    },
    Message: {
      PositionReport: {
        Latitude: 51.95,
        Longitude: 3.9,
        Sog: 12.4,
        Cog: 87.3,
        TrueHeading: 88,
        NavigationalStatus: 0,
        ...overrides,
      },
    },
  };
}

function staticData(mmsi: number, overrides: Record<string, any> = {}) {
  return {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: mmsi, ShipName: '', latitude: 0, longitude: 0, time_utc: '2026-10-27 07:12:40.000000 +0000 UTC' },
    Message: {
      ShipStaticData: {
        Name: 'TEST VESSEL',
        Type: 82, // tanker range
        Destination: 'ROTTERDAM ',
        ImoNumber: 1234567,
        ...overrides,
      },
    },
  };
}

describe('parseAisUtc', () => {
  it('parses the AISStream timestamp shape field by field', () => {
    expect(parseAisUtc('2026-10-27 07:12:34.123456 +0000 UTC', 0)).toBe(Date.UTC(2026, 9, 27, 7, 12, 34));
  });

  it('falls back for garbage and non-strings', () => {
    expect(parseAisUtc('not a date', 42)).toBe(42);
    expect(parseAisUtc(undefined, 42)).toBe(42);
  });
});

describe('aisShipType', () => {
  it('matches the Digitraffic categories so sources read identically', () => {
    expect(aisShipType(82)).toBe('tanker');
    expect(aisShipType(71)).toBe('cargo');
    expect(aisShipType(65)).toBe('passenger');
    expect(aisShipType(35)).toBe('military');
    expect(aisShipType(33)).toBe('fishing');
    expect(aisShipType(undefined)).toBe('cargo');
    expect(aisShipType(0)).toBe('cargo');
  });
});

describe('applyAisMessage — position reports', () => {
  it('normalises a position report with the vessel report time, not receive time', () => {
    const state = createAisState();
    expect(applyAisMessage(state, positionReport(244123456), RECEIVED)).toBe(true);
    const [v] = vesselsWithPositions(state);
    expect(v.mmsi).toBe(244123456);
    expect(v.lat).toBeCloseTo(51.95);
    expect(v.lng).toBeCloseTo(3.9);
    expect(v.speed).toBeCloseTo(12.4);
    expect(v.heading).toBe(88);
    expect(v.navStatus).toBe(0);
    expect(v.name).toBe('TEST VESSEL'); // MetaData name, trimmed
    expect(v.timestamp).toBe(Date.UTC(2026, 9, 27, 7, 12, 34));
    expect(v.source).toBe('aisstream');
  });

  it('falls back to course over ground when true heading is the 511 sentinel', () => {
    const state = createAisState();
    applyAisMessage(state, positionReport(1, { TrueHeading: 511 }), RECEIVED);
    expect(vesselsWithPositions(state)[0].heading).toBeCloseTo(87.3);
  });

  it('zeroes speed on the 102.3 sentinel and heading when both are unavailable', () => {
    const state = createAisState();
    applyAisMessage(state, positionReport(1, { Sog: 102.3, TrueHeading: 511, Cog: 360 }), RECEIVED);
    const [v] = vesselsWithPositions(state);
    expect(v.speed).toBe(0);
    expect(v.heading).toBe(0);
  });

  it('ignores malformed frames and out-of-range positions', () => {
    const state = createAisState();
    expect(applyAisMessage(state, null, RECEIVED)).toBe(false);
    expect(applyAisMessage(state, { MessageType: 'PositionReport' }, RECEIVED)).toBe(false);
    expect(applyAisMessage(state, positionReport(1, { Latitude: 123 }), RECEIVED)).toBe(false);
    expect(vesselsWithPositions(state)).toEqual([]);
  });
});

describe('applyAisMessage — the static-data join', () => {
  it('joins static data that arrives BEFORE the first position', () => {
    const state = createAisState();
    applyAisMessage(state, staticData(244123456), RECEIVED);
    expect(vesselsWithPositions(state)).toEqual([]); // no position yet — not a ship on the map
    applyAisMessage(state, positionReport(244123456), RECEIVED);
    const [v] = vesselsWithPositions(state);
    expect(v.name).toBe('TEST VESSEL');
    expect(v.type).toBe('tanker');
    expect(v.destination).toBe('ROTTERDAM');
  });

  it('joins static data that arrives AFTER the position', () => {
    const state = createAisState();
    applyAisMessage(state, positionReport(244123456), RECEIVED);
    applyAisMessage(state, staticData(244123456), RECEIVED);
    const [v] = vesselsWithPositions(state);
    expect(v.type).toBe('tanker');
    expect(v.destination).toBe('ROTTERDAM');
  });

  it('keeps later positions fresh while static fields persist', () => {
    const state = createAisState();
    applyAisMessage(state, staticData(244123456), RECEIVED);
    applyAisMessage(state, positionReport(244123456, { Sog: 3 }), RECEIVED);
    const later = positionReport(244123456, { Sog: 9 });
    later.MetaData.time_utc = '2026-10-27 07:14:34.000000 +0000 UTC';
    applyAisMessage(state, later, RECEIVED + 120_000);
    const [v] = vesselsWithPositions(state);
    expect(v.speed).toBe(9);
    expect(v.destination).toBe('ROTTERDAM');
    expect(v.timestamp).toBe(Date.UTC(2026, 9, 27, 7, 14, 34));
  });
});

describe('vessel ageing', () => {
  it('ages from the report timestamp and never goes negative', () => {
    expect(vesselAgeMs({ timestamp: 1_000 }, 61_000)).toBe(60_000);
    expect(vesselAgeMs({ timestamp: 5_000 }, 1_000)).toBe(0);
  });
});

describe('bbox handling', () => {
  it('parses a well-formed bbox and rejects nonsense', () => {
    expect(parseBboxParam('3.0,51.0,5.0,52.5')).toEqual({ west: 3, south: 51, east: 5, north: 52.5 });
    expect(parseBboxParam(null)).toBeNull();
    expect(parseBboxParam('1,2,3')).toBeNull();
    expect(parseBboxParam('a,b,c,d')).toBeNull();
    expect(parseBboxParam('0,60,10,50')).toBeNull(); // south >= north
    expect(parseBboxParam('0,-95,10,50')).toBeNull(); // south out of range
  });

  it('accepts an antimeridian-crossing viewport and splits its subscription', () => {
    const box = parseBboxParam('170,-20,-170,-10');
    expect(box).not.toBeNull();
    expect(subscriptionBoxes(box!)).toEqual([
      [[-20, 170], [-10, 180]],
      [[-20, -180], [-10, -170]],
    ]);
    expect(subscriptionBoxes({ west: 3, south: 51, east: 5, north: 52.5 })).toEqual([[[51, 3], [52.5, 5]]]);
  });

  it('clamps oversized spans symmetrically around the centre', () => {
    const clamped = clampBboxSpan({ west: -100, south: 0, east: 100, north: 80 });
    expect(clamped.north - clamped.south).toBe(30);
    expect(bboxCellKey(clamped)).toBe('-15,25,15,55');
  });

  it('rounds cell keys to whole degrees so small pans share a cell', () => {
    expect(bboxCellKey({ west: 3.2, south: 51.4, east: 5.4, north: 52.6 })).toBe('3,51,5,53');
    expect(bboxCellKey({ west: 3.4, south: 51.2, east: 5.1, north: 52.9 })).toBe('3,51,5,53');
  });
});

/* Minimal in-memory socket: emits 'open' once a listener registers (a real
   socket cannot open before you listen), then the scripted frames on send. */
function fakeSocket(frames: unknown[], opts: { failOpen?: boolean } = {}) {
  const handlers = new Map<string, ((...a: any[]) => void)[]>();
  const socket: AisSocketLike & { sent: string[] } = {
    sent: [],
    on(event, listener) {
      handlers.set(event, [...(handlers.get(event) ?? []), listener]);
      if (event === 'open') {
        queueMicrotask(() => {
          if (opts.failOpen) handlers.get('error')?.forEach(fn => fn(new Error('nope')));
          else handlers.get('open')?.forEach(fn => fn());
        });
      }
      return socket;
    },
    send(data: string) {
      socket.sent.push(data);
      for (const f of frames) {
        handlers.get('message')?.forEach(fn => fn(Buffer.from(JSON.stringify(f))));
      }
    },
    close() { handlers.get('close')?.forEach(fn => fn()); },
  };
  return socket;
}

describe('collectAisstreamSnapshot', () => {
  const bbox = { west: 3, south: 51, east: 5, north: 52.5 };

  it('subscribes with the key and both message types, and gathers joined vessels', async () => {
    const socket = fakeSocket([staticData(244123456), positionReport(244123456), positionReport(211987654)]);
    const result = await collectAisstreamSnapshot({
      apiKey: 'TESTKEY', bbox, collectMs: 20,
      createSocket: () => socket,
    });
    expect(result.status).toBe('ok');
    expect(result.messages).toBe(3);
    expect(result.vessels).toHaveLength(2);
    const joined = result.vessels.find(v => v.mmsi === 244123456)!;
    expect(joined.type).toBe('tanker');
    expect(joined.destination).toBe('ROTTERDAM');
    const sub = JSON.parse(socket.sent[0]);
    expect(sub.APIKey).toBe('TESTKEY');
    expect(sub.FilterMessageTypes).toEqual(['PositionReport', 'ShipStaticData']);
    expect(sub.BoundingBoxes).toEqual([[[51, 3], [52.5, 5]]]);
  });

  it('reports empty, not error, for a quiet patch of ocean', async () => {
    const result = await collectAisstreamSnapshot({
      apiKey: 'TESTKEY', bbox, collectMs: 20,
      createSocket: () => fakeSocket([]),
    });
    expect(result.status).toBe('empty');
    expect(result.vessels).toEqual([]);
  });

  it('reports error when the socket fails, without leaking the key', async () => {
    const result = await collectAisstreamSnapshot({
      apiKey: 'TESTKEY', bbox, collectMs: 20,
      createSocket: () => fakeSocket([], { failOpen: true }),
    });
    expect(result.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain('TESTKEY');
  });

  it('treats an AISStream error frame as a rejection', async () => {
    const result = await collectAisstreamSnapshot({
      apiKey: 'TESTKEY', bbox, collectMs: 20,
      createSocket: () => fakeSocket([{ error: 'API Key Is Not Valid' }]),
    });
    expect(result.status).toBe('error');
  });
});
