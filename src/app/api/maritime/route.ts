import { NextResponse, type NextRequest } from 'next/server';
import {
  bboxCellKey,
  clampBboxSpan,
  collectAisstreamSnapshot,
  parseBboxParam,
} from '@/lib/aisstream';

/**
 * OSIRIS — Maritime Intelligence
 * Real-time AIS vessel tracking via Digitraffic (keyless, Baltic) and
 * aisstream.io (viewport-scoped snapshot collection when
 * AISSTREAM_API_KEY is configured) + static global ports.
 */

const PORTS = [
  // ── Top Container Ports ──
  { name: 'Shanghai', country: 'CN', lat: 31.23, lng: 121.47, type: 'container', volume: '47.3M TEU', rank: 1 },
  { name: 'Singapore', country: 'SG', lat: 1.26, lng: 103.84, type: 'container', volume: '37.2M TEU', rank: 2 },
  { name: 'Ningbo-Zhoushan', country: 'CN', lat: 29.87, lng: 121.55, type: 'container', volume: '33.3M TEU', rank: 3 },
  { name: 'Shenzhen', country: 'CN', lat: 22.54, lng: 114.05, type: 'container', volume: '30.0M TEU', rank: 4 },
  { name: 'Guangzhou', country: 'CN', lat: 23.08, lng: 113.32, type: 'container', volume: '24.2M TEU', rank: 5 },
  { name: 'Busan', country: 'KR', lat: 35.10, lng: 129.04, type: 'container', volume: '22.7M TEU', rank: 6 },
  { name: 'Qingdao', country: 'CN', lat: 36.07, lng: 120.38, type: 'container', volume: '22.0M TEU', rank: 7 },
  { name: 'Rotterdam', country: 'NL', lat: 51.90, lng: 4.50, type: 'container', volume: '14.5M TEU', rank: 8 },
  { name: 'Tokyo', country: 'JP', lat: 35.61, lng: 139.79, type: 'container', volume: '4.5M TEU' },
  { name: 'Yokohama', country: 'JP', lat: 35.45, lng: 139.66, type: 'container', volume: '2.9M TEU' },
  { name: 'Kobe', country: 'JP', lat: 34.67, lng: 135.21, type: 'container', volume: '2.8M TEU' },
  { name: 'Nagoya', country: 'JP', lat: 35.08, lng: 136.87, type: 'container', volume: '2.6M TEU' },
  { name: 'Osaka', country: 'JP', lat: 34.63, lng: 135.41, type: 'container', volume: '2.1M TEU' },
  { name: 'Hakata (Fukuoka)', country: 'JP', lat: 33.60, lng: 130.40, type: 'container', volume: '0.9M TEU' },
  { name: 'Kitakyushu', country: 'JP', lat: 33.91, lng: 130.93, type: 'container', volume: '0.5M TEU' },
  { name: 'Shimizu', country: 'JP', lat: 35.00, lng: 138.50, type: 'container', volume: '0.5M TEU' },
  { name: 'Tomakomai', country: 'JP', lat: 42.63, lng: 141.63, type: 'container', volume: '0.4M TEU' },
  { name: 'Niigata', country: 'JP', lat: 37.95, lng: 139.06, type: 'container', volume: '0.2M TEU' },
  { name: 'Sendai', country: 'JP', lat: 38.27, lng: 141.02, type: 'container', volume: '0.2M TEU' },
  { name: 'Mizushima', country: 'JP', lat: 34.50, lng: 133.72, type: 'energy', volume: 'Industrial' },
  { name: 'Yokkaichi', country: 'JP', lat: 34.95, lng: 136.65, type: 'energy', volume: 'Industrial' },
  { name: 'Dubai (Jebel Ali)', country: 'AE', lat: 25.01, lng: 55.06, type: 'container', volume: '14.0M TEU', rank: 9 },
  { name: 'Port Klang', country: 'MY', lat: 2.99, lng: 101.39, type: 'container', volume: '13.2M TEU', rank: 10 },
  { name: 'Antwerp', country: 'BE', lat: 51.30, lng: 4.40, type: 'container', volume: '12.0M TEU', rank: 11 },
  { name: 'Xiamen', country: 'CN', lat: 24.48, lng: 118.09, type: 'container', volume: '11.4M TEU', rank: 12 },
  { name: 'Hamburg', country: 'DE', lat: 53.55, lng: 9.97, type: 'container', volume: '8.7M TEU', rank: 14 },
  { name: 'Los Angeles', country: 'US', lat: 33.74, lng: -118.27, type: 'container', volume: '9.9M TEU', rank: 13 },
  { name: 'Long Beach', country: 'US', lat: 33.75, lng: -118.19, type: 'container', volume: '8.0M TEU', rank: 15 },
  { name: 'Tanjung Pelepas', country: 'MY', lat: 1.36, lng: 103.55, type: 'container', volume: '9.8M TEU', rank: 16 },
  { name: 'Savannah', country: 'US', lat: 32.08, lng: -81.09, type: 'container', volume: '5.6M TEU', rank: 20 },
  { name: 'Felixstowe', country: 'GB', lat: 51.96, lng: 1.35, type: 'container', volume: '3.8M TEU', rank: 25 },
  { name: 'Santos', country: 'BR', lat: -23.95, lng: -46.31, type: 'container', volume: '4.2M TEU', rank: 22 },
  { name: 'Colombo', country: 'LK', lat: 6.94, lng: 79.84, type: 'container', volume: '7.2M TEU', rank: 17 },

  // ── Energy/Oil Ports ──
  { name: 'Ras Tanura', country: 'SA', lat: 26.64, lng: 50.16, type: 'energy', volume: '6.5M bpd' },
  { name: 'Fujairah', country: 'AE', lat: 25.14, lng: 56.35, type: 'energy', volume: '3.5M bpd' },
  { name: 'Novorossiysk', country: 'RU', lat: 44.72, lng: 37.77, type: 'energy', volume: '2.8M bpd' },
  { name: 'Houston Ship Channel', country: 'US', lat: 29.73, lng: -95.27, type: 'energy', volume: '2.5M bpd' },
  { name: 'Kharg Island', country: 'IR', lat: 29.24, lng: 50.33, type: 'energy', volume: '2.0M bpd' },
  { name: 'Primorsk', country: 'RU', lat: 60.35, lng: 28.70, type: 'energy', volume: '1.6M bpd' },

  // ── Major Naval Bases ──
  { name: 'Norfolk Naval Station', country: 'US', lat: 36.95, lng: -76.33, type: 'naval', fleet: 'US Atlantic Fleet' },
  { name: 'San Diego Naval Base', country: 'US', lat: 32.69, lng: -117.15, type: 'naval', fleet: 'US Pacific Fleet' },
  { name: 'Pearl Harbor', country: 'US', lat: 21.35, lng: -157.97, type: 'naval', fleet: 'US Pacific Fleet' },
  { name: 'Yokosuka', country: 'JP', lat: 35.28, lng: 139.67, type: 'naval', fleet: 'US 7th Fleet' },
  { name: 'Severomorsk', country: 'RU', lat: 69.07, lng: 33.42, type: 'naval', fleet: 'Russian Northern Fleet' },
  { name: 'Tartus', country: 'SY', lat: 34.89, lng: 35.89, type: 'naval', fleet: 'Russian Mediterranean' },
  { name: 'Zhanjiang', country: 'CN', lat: 21.20, lng: 110.39, type: 'naval', fleet: 'PLA Navy South Sea Fleet' },
  { name: 'Qingdao Naval', country: 'CN', lat: 36.09, lng: 120.43, type: 'naval', fleet: 'PLA Navy North Sea Fleet' },
  { name: 'Portsmouth', country: 'GB', lat: 50.80, lng: -1.11, type: 'naval', fleet: 'Royal Navy' },
  { name: 'Toulon', country: 'FR', lat: 43.12, lng: 5.93, type: 'naval', fleet: 'French Navy Mediterranean' },
  { name: 'Changi Naval Base', country: 'SG', lat: 1.33, lng: 104.01, type: 'naval', fleet: 'Republic of Singapore Navy' },
  { name: 'Visakhapatnam', country: 'IN', lat: 17.69, lng: 83.30, type: 'naval', fleet: 'Indian Navy Eastern Command' },
  { name: 'Mumbai Naval', country: 'IN', lat: 18.93, lng: 72.84, type: 'naval', fleet: 'Indian Navy Western Command' },
];

const CHOKEPOINTS = [
  { name: 'Strait of Hormuz', lat: 26.57, lng: 56.25, traffic: '21M bpd oil', risk: 'HIGH' },
  { name: 'Strait of Malacca', lat: 2.50, lng: 101.50, traffic: '16M bpd oil', risk: 'MODERATE' },
  { name: 'Suez Canal', lat: 30.43, lng: 32.34, traffic: '12% world trade', risk: 'ELEVATED' },
  { name: 'Bab el-Mandeb', lat: 12.58, lng: 43.33, traffic: '6.2M bpd oil', risk: 'CRITICAL' },
  { name: 'Panama Canal', lat: 9.08, lng: -79.68, traffic: '5% world trade', risk: 'LOW' },
  { name: 'Turkish Straits', lat: 41.12, lng: 29.07, traffic: '3M bpd oil', risk: 'MODERATE' },
  { name: 'Danish Straits', lat: 55.70, lng: 12.60, traffic: '3.2M bpd oil', risk: 'LOW' },
  { name: 'Cape of Good Hope', lat: -34.36, lng: 18.47, traffic: 'Alt route Suez', risk: 'LOW' },
  { name: 'Taiwan Strait', lat: 24.00, lng: 119.00, traffic: '88% large ships', risk: 'ELEVATED' },
  { name: 'Lombok Strait', lat: -8.47, lng: 115.72, traffic: 'Alt Malacca', risk: 'LOW' },
];

/* ── AISStream (aisstream.io) — global terrestrial AIS ────────────────────
   The free feed is a WebSocket stream, but a Vercel function cannot hold a
   socket open between requests — the previous design (one permanent
   connection feeding an in-memory cache) only ever worked on a long-lived
   dev server, so on serverless the aisstream half of this route was dead
   code and total_ships meant "the Baltic". The honest serverless pattern
   is viewport-scoped snapshot collection: when a request carries the
   client's bbox, the route opens the socket server-side, gathers that
   area's traffic, closes, and merges the snapshot into the same ship
   store Digitraffic feeds. Collection publishes incrementally (each
   vessel lands in the store as it reports), the requesting GET waits
   only a few seconds of it, and the rest of the window completes behind
   the response — flow rates differ by orders of magnitude (Rotterdam
   pours ~10 msgs/s, Los Angeles trickles ~0.6), so a single short window
   would call sparse regions empty while they are merely slow. Per
   rounded-degree cell the result is reused for AISSTREAM_CELL_TTL_MS,
   so panning around one port costs one collection, not one per poll.
   Collected vessels accumulate on the warm instance, which is also how
   the ShipStaticData join (name / type / destination, broadcast minutes
   apart) ever completes.

   The key is read ONLY from AISSTREAM_API_KEY, server-side. Without it the
   layer keeps working from Digitraffic alone and the payload says so.
   Coverage honesty: this is terrestrial AIS — coasts and shipping lanes,
   sparse mid-ocean, and the free tier's flow varies by region (the
   Singapore Strait trickled while Rotterdam poured, 2026-10-27). */

const AISSTREAM_COLLECT_MS = 20_000;
/** How long a GET waits on a fresh collection before answering with
    whatever has merged so far; the collection keeps running behind it. */
const AISSTREAM_RESPONSE_WAIT_MS = 4_500;
const AISSTREAM_CELL_TTL_MS = 90_000;

const globalForAis = globalThis as unknown as {
  shipsCache: Map<number, any>;
};

if (!globalForAis.shipsCache) {
  globalForAis.shipsCache = new Map();
}

const shipsCache = globalForAis.shipsCache;

const globalForAisstream = globalThis as unknown as {
  aisstreamCells?: Map<string, { at: number; status: string; vessels: number }>;
  aisstreamInflight?: Map<string, Promise<void>>;
  aisstreamMeta?: { status: string; at: number; vessels: number };
};

async function ensureAisstream(bboxRaw: string | null): Promise<void> {
  // Tests drive the ship maps directly (see route.test.ts): a real socket
  // here would leak live vessels into hermetic cases.
  if (process.env.NODE_ENV === 'test') return;
  if (!bboxRaw) return;
  const parsed = parseBboxParam(bboxRaw);
  if (!parsed) return;

  if (!globalForAisstream.aisstreamCells) globalForAisstream.aisstreamCells = new Map();
  if (!globalForAisstream.aisstreamInflight) globalForAisstream.aisstreamInflight = new Map();

  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) {
    globalForAisstream.aisstreamMeta = { status: 'not-configured', at: Date.now(), vessels: 0 };
    return;
  }

  const bbox = clampBboxSpan(parsed);
  const cellKey = bboxCellKey(bbox);
  const inflight = globalForAisstream.aisstreamInflight.get(cellKey);
  if (inflight) return inflight;
  const cell = globalForAisstream.aisstreamCells.get(cellKey);
  if (cell && Date.now() - cell.at < AISSTREAM_CELL_TTL_MS) return;

  globalForAisstream.aisstreamCells.set(cellKey, { at: Date.now(), status: 'collecting', vessels: 0 });
  globalForAisstream.aisstreamMeta = { status: 'collecting', at: Date.now(), vessels: 0 };
  const run = (async () => {
    try {
      const result = await collectAisstreamSnapshot({
        apiKey, bbox, collectMs: AISSTREAM_COLLECT_MS,
        onVessel: (v) => {
          const isNew = !shipsCache.has(v.mmsi);
          shipsCache.set(v.mmsi, v);
          if (isNew) clearMaritimeSnapshot();
        },
      });
      for (const v of result.vessels) shipsCache.set(v.mmsi, v);
      globalForAisstream.aisstreamCells!.set(cellKey, { at: Date.now(), status: result.status, vessels: result.vessels.length });
      globalForAisstream.aisstreamMeta = { status: result.status, at: Date.now(), vessels: result.vessels.length };
      if (result.vessels.length) clearMaritimeSnapshot();
    } catch (e) {
      console.warn('[OSIRIS] AISStream collection failed:', e);
      globalForAisstream.aisstreamCells!.set(cellKey, { at: Date.now(), status: 'error', vessels: 0 });
      globalForAisstream.aisstreamMeta = { status: 'error', at: Date.now(), vessels: 0 };
    } finally {
      globalForAisstream.aisstreamInflight!.delete(cellKey);
    }
  })();
  globalForAisstream.aisstreamInflight.set(cellKey, run);
  return run;
}

// --- SCM Integration: VesselAPI Hybrid Fallback (Satellite AIS) ---
let lastVesselApiFetch = 0;
async function fetchVesselApiFallback() {
  // Mock data removed per user request. We only rely on real live stream data.
}

/* ── Digitraffic AIS (Finnish Transport Infrastructure Agency) ────────────
   Keyless open AIS for the Baltic / Northern European waters, published as
   two GeoJSON/JSON documents: vessel positions (~1,000 live ships) and
   vessel metadata (name, destination, ship type). This is the maritime
   layer's always-on live source: the aisstream.io feed above only flows
   when AIS_API_KEY is configured, and a WebSocket cache cannot accumulate
   on serverless anyway, which left total_ships permanently 0. Digitraffic
   coverage is regional — the Gulf of Finland / Baltic approaches — and the
   payload says so via ship_sources; global coverage still wants the
   aisstream key. Fetched at most once a minute, shared between callers. */
const DIGITRAFFIC_TTL_MS = 60_000;

const globalForDigitraffic = globalThis as unknown as {
  digitrafficShips?: Map<number, any>;
  digitrafficAt?: number;
  digitrafficInflight?: Promise<void> | null;
};

function digitrafficShipType(typeCode: number | undefined): string {
  if (!typeCode) return 'cargo';
  if (typeCode >= 80 && typeCode <= 89) return 'tanker';
  if (typeCode >= 70 && typeCode <= 79) return 'cargo';
  if (typeCode === 35) return 'military';
  if (typeCode >= 60 && typeCode <= 69) return 'passenger';
  if (typeCode >= 30 && typeCode <= 39) return 'fishing';
  return 'cargo';
}

async function refreshDigitraffic(): Promise<void> {
  const [locRes, vesRes] = await Promise.allSettled([
    fetch('https://meri.digitraffic.fi/api/ais/v1/locations', {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json' },
    }),
    fetch('https://meri.digitraffic.fi/api/ais/v1/vessels', {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json' },
    }),
  ]);
  if (locRes.status !== 'fulfilled' || !locRes.value.ok) {
    throw new Error(`Digitraffic locations ${locRes.status === 'fulfilled' ? locRes.value.status : 'failed'}`);
  }
  const loc = await locRes.value.json();
  const meta = new Map<number, any>();
  if (vesRes.status === 'fulfilled' && vesRes.value.ok) {
    for (const v of await vesRes.value.json()) {
      if (typeof v?.mmsi === 'number') meta.set(v.mmsi, v);
    }
  }

  const ships = new Map<number, any>();
  for (const f of loc.features ?? []) {
    const mmsi = f?.mmsi ?? f?.properties?.mmsi;
    const coords = f?.geometry?.coordinates;
    if (typeof mmsi !== 'number' || !Array.isArray(coords)) continue;
    const [lng, lat] = coords;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const p = f.properties ?? {};
    const v = meta.get(mmsi);
    ships.set(mmsi, {
      id: mmsi,
      mmsi,
      name: v?.name ? String(v.name).trim() : undefined,
      destination: v?.destination ? String(v.destination).trim() : undefined,
      type: digitrafficShipType(v?.shipType),
      lat,
      lng,
      speed: typeof p.sog === 'number' ? p.sog : 0,
      // AIS heading 511 means "not available" — fall back to course over ground.
      heading: typeof p.heading === 'number' && p.heading !== 511 ? p.heading : (p.cog ?? 0),
      timestamp: typeof p.timestampExternal === 'number' ? p.timestampExternal * 1000 : Date.now(),
      source: 'digitraffic',
    });
  }
  if (ships.size > 0) {
    globalForDigitraffic.digitrafficShips = ships;
    globalForDigitraffic.digitrafficAt = Date.now();
  }
}

async function ensureDigitraffic(): Promise<void> {
  // Tests seed the Digitraffic map directly (see route.test.ts): a live
  // fetch here would hang under their fake timers — AbortSignal.timeout is
  // timer-driven — and would leak real Baltic ships into hermetic cases.
  if (process.env.NODE_ENV === 'test') return;
  const at = globalForDigitraffic.digitrafficAt ?? 0;
  if (globalForDigitraffic.digitrafficShips?.size && Date.now() - at < DIGITRAFFIC_TTL_MS) return;
  if (globalForDigitraffic.digitrafficInflight) return globalForDigitraffic.digitrafficInflight;
  globalForDigitraffic.digitrafficInflight = refreshDigitraffic()
    .catch(e => { console.warn('[OSIRIS] Digitraffic AIS refresh failed:', e); })
    .finally(() => { globalForDigitraffic.digitrafficInflight = null; });
  return globalForDigitraffic.digitrafficInflight;
}

/* ── Response snapshot cache ──────────────────────────────────────────────
   The AIS websocket writes into shipsCache continuously, so a GET is pure
   aggregation over whatever that map happens to hold. Rebuilding it per
   request is what pins the CPU once the maritime layer gets popular: 58 ports
   and 10 chokepoints scanned against up to 20,000 ships is ~1.4M distance
   calculations, and the reply then serialises every one of those ships — a
   multi-megabyte JSON.stringify. At ~30 req/s that whole job runs thirty
   times a second to produce a byte-identical answer.

   Building it once per SNAPSHOT_TTL_MS and handing every caller the same
   pre-serialised string makes the cost independent of how many people are
   watching. The window sits well under the 10s the client polls at, so
   nothing reaches the map staler than it already was. */
const SNAPSHOT_TTL_MS = 5_000;

const globalForSnapshot = globalThis as unknown as {
  maritimeSnapshot?: { body: string; builtAt: number };
};

function buildSnapshot(now: number): string {
  // Clean up stale ships (older than 10 minutes)
  for (const [mmsi, ship] of shipsCache.entries()) {
    if (now - ship.timestamp > 10 * 60 * 1000) {
      shipsCache.delete(mmsi);
    }
  }

  // aisstream ships (only present when AIS_API_KEY is configured) plus the
  // keyless Digitraffic Baltic feed, deduped by MMSI with aisstream winning.
  const byMmsi = new Map<number, any>();
  for (const ship of shipsCache.values()) byMmsi.set(ship.mmsi, ship);
  for (const ship of globalForDigitraffic.digitrafficShips?.values() ?? []) {
    if (now - ship.timestamp > 10 * 60 * 1000) continue;
    if (!byMmsi.has(ship.mmsi)) byMmsi.set(ship.mmsi, ship);
  }
  const ships = Array.from(byMmsi.values());
  const shipSources = {
    aisstream: ships.filter(s => s.source !== 'digitraffic').length,
    digitraffic: ships.filter(s => s.source === 'digitraffic').length,
  };

  // Dynamically calculate live traffic (Fast approximation of Haversine)
  const getDistanceKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const dx = (lng1 - lng2) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    const dy = lat1 - lat2;
    return Math.sqrt(dx * dx + dy * dy) * 111.32;
  };

  const dynamicPorts = PORTS.map(port => {
    let nearbyCount = 0;
    let waitingCount = 0;

    for (let i = 0; i < ships.length; i++) {
      if (getDistanceKm(port.lat, port.lng, ships[i].lat, ships[i].lng) < 50) {
        nearbyCount++;
        // If speed is less than 0.5 knots, consider it anchored/waiting
        if (ships[i].speed < 0.5 && ships[i].type !== 'military') {
          waitingCount++;
        }
      }
    }

    // Heuristic: More than 40% waiting indicates congestion
    const congestionRatio = nearbyCount > 0 ? waitingCount / nearbyCount : 0;
    let congestionStatus = 'NORMAL';
    let estDwellTime = '1-2 Days';
    
    if (congestionRatio > 0.6 || waitingCount > 30) {
      congestionStatus = 'SEVERE';
      estDwellTime = '7+ Days';
    } else if (congestionRatio > 0.4 || waitingCount > 15) {
      congestionStatus = 'CONGESTED';
      estDwellTime = '3-5 Days';
    }

    return {
      ...port,
      volume: `${port.volume} | LIVE: ${nearbyCount} (WAITING: ${waitingCount})`,
      congestion: congestionStatus,
      dwell_time: estDwellTime
    };
  });

  const dynamicChokepoints = CHOKEPOINTS.map(choke => {
    let nearbyCount = 0;
    for (let i = 0; i < ships.length; i++) {
      if (getDistanceKm(choke.lat, choke.lng, ships[i].lat, ships[i].lng) < 100) nearbyCount++;
    }
    
    // Dynamically adjust risk based on live ship concentration
    let dynamicRisk = choke.risk;
    if (nearbyCount > 50) dynamicRisk = 'CRITICAL';
    else if (nearbyCount > 20 && dynamicRisk !== 'CRITICAL') dynamicRisk = 'HIGH';
    else if (nearbyCount > 5 && dynamicRisk === 'LOW') dynamicRisk = 'ELEVATED';

    return {
      ...choke,
      traffic: `${choke.traffic} | LIVE SHIPS: ${nearbyCount}`,
      risk: dynamicRisk
    };
  });

  const aisMeta = globalForAisstream.aisstreamMeta;
  const aisConfigured = !!process.env.AISSTREAM_API_KEY;

  return JSON.stringify({
    ports: dynamicPorts,
    chokepoints: dynamicChokepoints,
    ships: ships,
    ship_sources: shipSources,
    /* AISStream collection state, stated plainly so the client (and anyone
       reading the payload) can tell a working global feed from a Baltic-only
       one: without a key, or when the feed errors, the ships above are
       Digitraffic's and this block says so. */
    aisstream: {
      configured: aisConfigured,
      status: !aisConfigured ? 'not-configured' : (aisMeta?.status ?? 'idle'),
      as_of: aisMeta?.at ? new Date(aisMeta.at).toISOString() : null,
      vessels: shipSources.aisstream,
      collect_window_ms: AISSTREAM_COLLECT_MS,
      response_wait_ms: AISSTREAM_RESPONSE_WAIT_MS,
      cell_ttl_ms: AISSTREAM_CELL_TTL_MS,
      coverage: 'Terrestrial AIS via AISStream — coastal and shipping-lane density; sparse mid-ocean. Not satellite AIS.',
    },
    total_ports: dynamicPorts.length,
    total_chokepoints: dynamicChokepoints.length,
    total_ships: ships.length,
    timestamp: new Date(now).toISOString(),
  });
}

/** Test seam — forces the next GET to rebuild. */
export function clearMaritimeSnapshot(): void {
  delete globalForSnapshot.maritimeSnapshot;
}

export async function GET(request?: NextRequest) {
  // Trigger Hybrid Fallback
  await fetchVesselApiFallback();
  // Keyless live AIS (Baltic) — the layer's baseline live source.
  await ensureDigitraffic();
  // Global terrestrial AIS for the caller's viewport, when a bbox is given
  // and the key is configured. The GET waits only the response window of a
  // fresh collection; the remainder completes behind the response and the
  // next poll (10 s cadence while vessels are on the map) picks it up.
  const bboxRaw = request?.url ? new URL(request.url).searchParams.get('bbox') : null;
  if (bboxRaw) {
    await Promise.race([
      ensureAisstream(bboxRaw),
      new Promise(resolve => setTimeout(resolve, AISSTREAM_RESPONSE_WAIT_MS)),
    ]);
  }

  const now = Date.now();
  const cached = globalForSnapshot.maritimeSnapshot;

  const snapshot = cached && now - cached.builtAt < SNAPSHOT_TTL_MS
    ? cached
    : { body: buildSnapshot(now), builtAt: now };
  globalForSnapshot.maritimeSnapshot = snapshot;

  const maxAgeSeconds = Math.floor(SNAPSHOT_TTL_MS / 1000);

  return new NextResponse(snapshot.body, {
    headers: {
      'Content-Type': 'application/json',
      // The server would not have produced anything newer inside this window
      // either, so let the browser and any CDN in front of it skip the round
      // trip entirely rather than re-asking every 10s per open tab.
      'Cache-Control': `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, stale-while-revalidate=15`,
    },
  });
}
