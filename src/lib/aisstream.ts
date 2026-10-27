/**
 * AISStream (aisstream.io) — global terrestrial AIS over a WebSocket feed.
 *
 * The feed is a stream, but the app serves snapshots: the maritime route
 * opens the socket server-side for one viewport, collects whatever that
 * area reports during a short window, and closes. This module is the pure
 * half of that design — message transforms, the static-data join, report
 * ageing, bbox handling — plus the bounded collector itself, with the
 * socket factory injectable so the transforms are testable offline.
 *
 * Coverage reality: AISStream's free tier rebroadcasts terrestrial AIS —
 * dense along coasts and shipping lanes, sparse to absent mid-ocean. It is
 * NOT satellite AIS and nothing here should be read as global coverage.
 */

export interface AisBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A vessel record in the exact shape the maritime route serves. */
export interface AisVessel {
  id: number;
  mmsi: number;
  name?: string;
  destination?: string;
  type: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  navStatus?: number;
  /** When the vessel itself reported this position (ms epoch), not when we heard it. */
  timestamp: number;
  source: 'aisstream';
}

/* Partial record accumulated across message types: a ShipStaticData frame
   can arrive before the first PositionReport for the same MMSI (and vice
   versa), so the join keeps one record per MMSI and only positions count
   as publishable. */
export interface AisState {
  vessels: Map<number, AisVessel>;
}

export function createAisState(): AisState {
  return { vessels: new Map() };
}

/** Map an AIS ship-type code to the app's vessel categories — identical to
    the Digitraffic mapping so a ship reads the same from either source. */
export function aisShipType(typeCode: number | undefined): string {
  if (!typeCode) return 'cargo';
  if (typeCode >= 80 && typeCode <= 89) return 'tanker';
  if (typeCode >= 70 && typeCode <= 79) return 'cargo';
  if (typeCode === 35) return 'military';
  if (typeCode >= 60 && typeCode <= 69) return 'passenger';
  if (typeCode >= 30 && typeCode <= 39) return 'fishing';
  return 'cargo';
}

/** AISStream stamps MetaData.time_utc like "2026-10-27 07:12:34.123456 +0000 UTC".
    Parse the fields directly — Date.parse is not reliable on that shape. */
export function parseAisUtc(value: unknown, fallbackMs: number): number {
  if (typeof value === 'string') {
    const m = value.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      if (Number.isFinite(ms)) return ms;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallbackMs;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function recordFor(state: AisState, mmsi: number, receivedAtMs: number): AisVessel {
  let v = state.vessels.get(mmsi);
  if (!v) {
    v = {
      id: mmsi, mmsi, type: 'cargo',
      lat: NaN, lng: NaN, speed: 0, heading: 0,
      timestamp: receivedAtMs, source: 'aisstream',
    };
    state.vessels.set(mmsi, v);
  }
  return v;
}

/**
 * Fold one raw AISStream message into the state. Returns true when the
 * message carried usable data. Throws nothing — malformed frames are
 * ignored, because the feed is not ours to trust.
 */
export function applyAisMessage(state: AisState, raw: unknown, receivedAtMs: number): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const msg = raw as Record<string, any>;
  const mmsi = Number(msg.MetaData?.MMSI);
  if (!Number.isFinite(mmsi) || mmsi <= 0) return false;

  const v = recordFor(state, mmsi, receivedAtMs);
  const metaName = cleanText(msg.MetaData?.ShipName);
  if (metaName) v.name = metaName;

  if (msg.MessageType === 'PositionReport') {
    const r = msg.Message?.PositionReport;
    if (!r) return false;
    const lat = Number(r.Latitude);
    const lng = Number(r.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
    v.lat = lat;
    v.lng = lng;
    const sog = Number(r.Sog);
    v.speed = Number.isFinite(sog) && sog < 102.3 ? sog : 0; // 102.3 kn is the AIS "not available" sentinel
    const cog = Number(r.Cog);
    const cogValid = Number.isFinite(cog) && cog >= 0 && cog < 360; // 360 is the AIS "not available" sentinel
    const th = Number(r.TrueHeading);
    v.heading = Number.isFinite(th) && th >= 0 && th <= 359 ? th : cogValid ? cog : 0; // 511 heading = not available
    const nav = Number(r.NavigationalStatus);
    if (Number.isFinite(nav) && nav >= 0 && nav <= 15) v.navStatus = nav;
    v.timestamp = parseAisUtc(msg.MetaData?.time_utc, receivedAtMs);
    return true;
  }

  if (msg.MessageType === 'ShipStaticData') {
    const sd = msg.Message?.ShipStaticData;
    if (!sd) return false;
    const name = cleanText(sd.Name);
    if (name) v.name = name;
    const dest = cleanText(sd.Destination);
    if (dest) v.destination = dest;
    if (typeof sd.Type === 'number') v.type = aisShipType(sd.Type);
    return true;
  }

  return false;
}

/** Vessels that have reported a position — static-only records are joins in progress, not ships on a map. */
export function vesselsWithPositions(state: AisState): AisVessel[] {
  const out: AisVessel[] = [];
  for (const v of state.vessels.values()) {
    if (Number.isFinite(v.lat) && Number.isFinite(v.lng)) out.push(v);
  }
  return out;
}

export function vesselAgeMs(vessel: Pick<AisVessel, 'timestamp'>, nowMs: number): number {
  return Math.max(0, nowMs - vessel.timestamp);
}

/* ── Bounding boxes ─────────────────────────────────────────────────────── */

/** Parse the route's `?bbox=west,south,east,north` parameter. A west > east
    pair is a legitimate antimeridian-crossing viewport, not an error. */
export function parseBboxParam(raw: string | null | undefined): AisBbox | null {
  if (!raw) return null;
  const parts = raw.split(',').map(s => Number(s.trim()));
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (south < -90 || north > 90 || south >= north) return null;
  if (west < -180 || west > 180 || east < -180 || east > 180) return null;
  return { west, south, east, north };
}

export function bboxLonSpan(bbox: AisBbox): number {
  const span = bbox.east - bbox.west;
  return span >= 0 ? span : span + 360;
}

/** A whole-globe viewport would ask the free feed for more than it can
    usefully give and flood the snapshot, so oversized boxes shrink
    symmetrically around their centre to the collection cap. */
export function clampBboxSpan(bbox: AisBbox, maxLonSpan = 30, maxLatSpan = 30): AisBbox {
  let { west, south, east, north } = bbox;
  if (north - south > maxLatSpan) {
    const c = (north + south) / 2;
    south = Math.max(-90, c - maxLatSpan / 2);
    north = Math.min(90, c + maxLatSpan / 2);
  }
  if (bboxLonSpan(bbox) > maxLonSpan) {
    const centre = west + bboxLonSpan(bbox) / 2;
    west = centre - maxLonSpan / 2;
    east = centre + maxLonSpan / 2;
    // Normalise back into [-180, 180]; east may legitimately end up < west
    // again if the shrunken box still straddles the antimeridian.
    const norm = (x: number) => ((x + 540) % 360) - 180;
    west = norm(west);
    east = norm(east);
  }
  return { west, south, east, north };
}

/** Cache key for a collection cell: edges rounded to whole degrees, so
    small pans reuse the snapshot the last pan gathered. */
export function bboxCellKey(bbox: AisBbox): string {
  return [bbox.west, bbox.south, bbox.east, bbox.north].map(n => Math.round(n)).join(',');
}

/** AISStream subscription boxes: [[latMin, lonMin], [latMax, lonMax]].
    An antimeridian-crossing viewport becomes two boxes. */
export function subscriptionBoxes(bbox: AisBbox): [[number, number], [number, number]][] {
  if (bbox.east >= bbox.west) {
    return [[[bbox.south, bbox.west], [bbox.north, bbox.east]]];
  }
  return [
    [[bbox.south, bbox.west], [bbox.north, 180]],
    [[bbox.south, -180], [bbox.north, bbox.east]],
  ];
}

/** AISStream frames arrive as binary (Buffer from `ws`, Blob/ArrayBuffer
    from a browser-style socket) wrapping JSON text. Normalise them all. */
export async function decodeAisFrame(data: unknown): Promise<string | null> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as ArrayBufferView);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  if (data != null && typeof (data as { toString?: unknown }).toString === 'function') {
    const s = String(data);
    return s.startsWith('{') ? s : null;
  }
  return null;
}

/* ── Snapshot collector ─────────────────────────────────────────────────── */

export interface AisSocketLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  send(data: string): void;
  close(): void;
}

export interface AisCollectResult {
  status: 'ok' | 'empty' | 'error';
  vessels: AisVessel[];
  messages: number;
  error?: string;
}

/**
 * Open the AISStream socket for one bbox, gather for `collectMs`, close.
 * Resolves with whatever arrived — an empty result is a truthful answer
 * about a quiet patch of ocean, not a failure. The API key travels only in
 * the subscription frame, never in any returned value or error string.
 */
export async function collectAisstreamSnapshot(opts: {
  apiKey: string;
  bbox: AisBbox;
  collectMs?: number;
  maxVessels?: number;
  createSocket?: (url: string) => AisSocketLike | Promise<AisSocketLike>;
}): Promise<AisCollectResult> {
  const collectMs = opts.collectMs ?? 4_000;
  const maxVessels = opts.maxVessels ?? 4_000;
  const state = createAisState();
  let messages = 0;

  const createSocket = opts.createSocket ?? (async (url: string) => {
    const { default: WebSocket } = await import('ws');
    return new WebSocket(url) as unknown as AisSocketLike;
  });

  return new Promise<AisCollectResult>((resolve) => {
    let settled = false;
    let opened = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let guard: ReturnType<typeof setTimeout> | undefined;
    let socket: AisSocketLike | undefined;

    const finish = (status: AisCollectResult['status'], error?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (guard) clearTimeout(guard);
      try { socket?.close(); } catch { /* already gone */ }
      const vessels = vesselsWithPositions(state).slice(0, maxVessels);
      resolve({
        status: status === 'ok' && vessels.length === 0 ? 'empty' : status,
        vessels,
        messages,
        ...(error ? { error } : {}),
      });
    };

    Promise.resolve()
      .then(() => createSocket('wss://stream.aisstream.io/v0/stream'))
      .then((s) => {
        socket = s;
        // Hard guard: a socket that never opens must not pin the route.
        guard = setTimeout(() => finish('error', 'AISStream did not open in time'), collectMs + 5_000);

        socket.on('open', () => {
          opened = true;
          socket!.send(JSON.stringify({
            APIKey: opts.apiKey,
            BoundingBoxes: subscriptionBoxes(opts.bbox),
            FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
          }));
          timer = setTimeout(() => finish('ok'), collectMs);
        });

        socket.on('message', (data: unknown) => {
          messages++;
          void decodeAisFrame(data).then((text) => {
            if (!text) return;
            try {
              const parsed = JSON.parse(text);
              // AISStream answers a bad key / bad subscription with an error frame.
              if (typeof parsed?.error === 'string') {
                finish('error', 'AISStream rejected the subscription');
                return;
              }
              applyAisMessage(state, parsed, Date.now());
            } catch { /* malformed frame — the feed is not ours to trust */ }
          }).catch(() => { /* undecodable frame — ignore */ });
        });

        socket.on('error', () => finish('error', 'AISStream socket error'));
        socket.on('close', () => {
          if (!opened) finish('error', 'AISStream closed before opening');
          else finish('ok');
        });
      })
      .catch(() => finish('error', 'AISStream socket could not be created'));
  });
}
