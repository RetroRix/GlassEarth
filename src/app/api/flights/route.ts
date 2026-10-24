
import { NextResponse, after } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';

export const maxDuration = 60;

// 30 regions covering every major aviation corridor at 250 nm radius.
// Focused on high-density airspace: US domestic, North Atlantic, Europe,
// Middle East hub, India, East Asia, SE Asia, Australia, South America.
const REGIONS = [
  // North America
  { lat: 39.8,  lon: -98.5 }, // Central US
  { lat: 41.0,  lon: -74.0 }, // Northeast (NYC/Boston/DC)
  { lat: 33.0,  lon: -84.0 }, // Southeast (Atlanta)
  { lat: 42.0,  lon: -88.0 }, // Midwest (Chicago)
  { lat: 30.0,  lon: -97.0 }, // Texas (Dallas/Houston)
  { lat: 47.0,  lon:-122.0 }, // Pacific Northwest (Seattle)
  { lat: 34.0,  lon:-118.0 }, // SoCal (LA)
  { lat: 45.0,  lon: -73.0 }, // Canada East (Montreal/Toronto)
  { lat: 49.0,  lon: -97.0 }, // Canada Prairies
  // Europe
  { lat: 50.0,  lon:  15.0 }, // Central Europe
  { lat: 51.5,  lon:  -1.0 }, // UK / Ireland
  { lat: 47.0,  lon:   2.0 }, // France / Alps
  { lat: 40.0,  lon:  -4.0 }, // Iberia
  { lat: 42.0,  lon:  13.0 }, // Italy / Adriatic
  { lat: 60.0,  lon:  15.0 }, // Scandinavia
  { lat: 52.0,  lon:  22.0 }, // Eastern Europe / Baltics
  { lat: 39.0,  lon:  35.0 }, // Turkey / Aegean
  // Middle East & South Asia
  { lat: 25.0,  lon:  49.0 }, // Arabian Gulf W (Riyadh/Doha)
  { lat: 25.2,  lon:  55.3 }, // Arabian Gulf E (Dubai/Abu Dhabi)
  { lat: 22.0,  lon:  78.0 }, // India
  // East Asia & Pacific
  { lat: 35.0,  lon: 105.0 }, // China
  { lat: 35.0,  lon: 136.0 }, // Japan
  { lat: 37.0,  lon: 127.0 }, // Korea
  { lat: 13.0,  lon: 100.0 }, // SE Asia (Bangkok)
  { lat:  1.0,  lon: 104.0 }, // Singapore / Malacca Strait
  // Australia
  { lat:-25.0,  lon: 133.0 }, // Central Australia
  { lat:-33.0,  lon: 151.0 }, // Eastern Australia (Sydney)
  // Africa
  { lat:  0.0,  lon:  20.0 }, // Central Africa
  { lat:-26.0,  lon:  28.0 }, // South Africa
  // South America
  { lat:-15.0,  lon: -60.0 }, // Brazil Central
  { lat:-23.0,  lon: -46.0 }, // São Paulo / Rio
];

const HELI_TYPES = new Set([
  'R22','R44','R66','B06','B06T','B204','B205','B206','B212','B222','B230',
  'B407','B412','B427','B429','B430','B505','B525',
  'AS32','AS35','AS50','AS55','AS65',
  'EC20','EC25','EC30','EC35','EC45','EC55','EC75',
  'H125','H130','H135','H145','H155','H160','H175','H215','H225',
  'S55','S58','S61','S64','S70','S76','S92',
  'A109','A119','A139','A169','A189','AW09',
  'MD52','MD60','MDHI','MD90','NOTR',
  'B47G','HUEY','GAMA','CABR','EXE',
]);

const PRIVATE_JET_TYPES = new Set([
  'G150','G200','G280','GLEX','G500','G550','G600','G650','G700',
  'GLF2','GLF3','GLF4','GLF5','GLF6','GL5T','GL7T','GV','GIV',
  'CL30','CL35','CL60','BD70','BD10',
  'C25A','C25B','C25C','C500','C510','C525','C550','C560','C56X','C680','C700','C750',
  'E35L','E50P','E55P','E545','E550',
  'FA50','FA7X','FA8X','F900','F2TH',
  'LJ35','LJ40','LJ45','LJ60','LJ70','LJ75',
  'PC12','PC24','TBM7','TBM8','TBM9',
  'PRM1','SF50','EA50','VLJ',
]);

const MILITARY_INDICATORS = new Set([
  'C17','C5M','C130','C30J','KC10','KC46','KC35','E3CF','E3TF','E8A',
  'B1B','B2','B52','F16','F15','F18','F22','F35','A10','F117',
  'RC135','E6B','P8A','P3','MQ9','RQ4','U2','EP3','RC12',
  'V22','CH47','UH60','AH64','AH1Z','MV22',
  'EUFI','RFAL','TORD','TYP','GR4',
]);

// Airliner and regional types, hoisted out of the classifier condition it used
// to sit inside. A typed airliner stays commercial whatever its callsign says.
const AIRLINER_TYPES = new Set([
  'A319','A320','A321','A332','A333','A339','A343','A359','A388',
  'B737','B738','B739','B38M','B39M','B752','B753','B763','B764',
  'B772','B77L','B77W','B788','B789','B78X',
  'E170','E175','E190','E195','CRJ7','CRJ9','AT43','AT72','DH8D',
]);

// Fractional-ownership and charter operators file under a 3-letter ICAO
// designator exactly like an airline, so AIRLINE_CODE_RE matches them and they
// would otherwise be counted as commercial traffic.
const BIZJET_OPERATORS = new Set([
  'EJA','EJM','NJE','LXJ','FJO','VJT','XOJ','JTL','WUP','GAJ','DPJ','CLY','TWY',
]);

const AIRLINE_CODE_RE = /^([A-Z]{3})\d/;

// A callsign that is not an airline designator + flight number is a
// registration: what general-aviation aircraft broadcast once the hyphen is
// stripped — DMMKG (D-MMKG), HBYKO (HB-YKO), OEDLH (OE-DLH), N425RS, CGABC.
const CALLSIGN_RE = /^[A-Z0-9]{3,8}$/;

// Business jets cruise in the mid-thirties at transonic speed; nothing flying
// under a civil registration reaches FL280 at 300 kt without turbofans. This is
// the only bizjet/piston discriminator available for OpenSky aircraft, which
// carry no aircraft type at all.
const JET_CRUISE_ALT_M = 8500;
const JET_CRUISE_KTS = 300;

// Civil traffic comes from the community tar1090 feeds. Their health has
// flipped more than once, so both working providers are wired and the
// response reports per-feed counts — a provider that starts answering 200
// with no aircraft must be visible in the payload, not silently empty the
// map (which is exactly how this layer lost all civil traffic):
//   api.adsb.lol/v2     → alive again (verified 2026-10-23: real civil
//                         aircraft on every regional endpoint + /mil)
//   opendata.adsb.fi    → alive; note its v2 regional payload keys the
//                         aircraft array `aircraft`, not `ac` — reading
//                         `ac` there returned [] forever (see fetch below)
//   api.airplanes.live  → 403 on every endpoint (key-gated)
//   api.adsb.one/v2     → 403 (checked as a replacement, also unusable)
// OpenSky remains the best source *with* credentials; anonymously its
// 400 credits/day pool cannot sustain a live map and datacenter IPs are
// throttled out of it, so without credentials it is not called at all.
const ADSB_MAX_DIST = 250; // nm — hard cap the providers enforce
const ADSBFI_BASE = 'https://opendata.adsb.fi/api/v2';
const ADSBLOL_BASE = 'https://api.adsb.lol/v2';

// adsb.fi allows roughly one request per second and soft-throttles over
// that by returning 200 with an empty array rather than 429, so it is the
// per-region *fallback*, paced — never the parallel primary.
const ADSBFI_GAP_MS = 1100;

/** tar1090-shaped payloads key the aircraft array `ac` — except adsb.fi's
    v2 regional endpoint, which uses `aircraft`. Accept both, always. */
function acArray(data: any): any[] {
  return data?.ac || data?.aircraft || [];
}

async function fetchAdsbFiRegion(lat: number, lon: number): Promise<any[]> {
  try {
    const res = await stealthFetch(`${ADSBFI_BASE}/lat/${lat}/lon/${lon}/dist/${ADSB_MAX_DIST}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = await res.json();
      return acArray(data);
    }
    await res.body?.cancel();
  } catch {}
  return [];
}

async function fetchAdsbLolRegion(lat: number, lon: number): Promise<any[]> {
  try {
    const res = await stealthFetch(`${ADSBLOL_BASE}/lat/${lat}/lon/${lon}/dist/${ADSB_MAX_DIST}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      return acArray(data);
    }
    await res.body?.cancel();
  } catch {}
  return [];
}

function classifyFlight(f: any) {
  const modelUpper = (f.t || '').toUpperCase();
  const flightStr = (f.flight || '').trim().toUpperCase();
  const dbFlags = (f.dbFlags || 0);

  if (modelUpper === 'TWR') return null;

  const lat = f.lat;
  const lon = f.lon;
  if (lat == null || lon == null) return null;

  const callsign = flightStr || f.hex || 'UNKNOWN';
  const altRaw = f.alt_baro;
  const altMeters = typeof altRaw === 'number' ? altRaw * 0.3048 : 0;
  const speedKnots = typeof f.gs === 'number' ? Math.round(f.gs * 10) / 10 : null;
  const heading = f.track || 0;
  const isHeli = HELI_TYPES.has(modelUpper) || f.category_os === 8;
  const isGrounded = typeof altRaw === 'number' && altRaw < 100;

  const isOsMilitary = f.category_os === 14;
  const isOsHighPerf = f.category_os === 7;
  const isOsLight = f.category_os === 2;
  // Large / high-vortex large / heavy — airline or cargo metal by weight alone.
  const isOsHeavy = f.category_os === 4 || f.category_os === 5 || f.category_os === 6;

  const airlineMatch = AIRLINE_CODE_RE.exec(callsign);
  const airlineCode = airlineMatch ? airlineMatch[1] : '';

  // OpenSky supplies no aircraft type, and its ADS-B emitter category is
  // "no information" for ~96% of aircraft even with extended=1 (measured live:
  // 597 of 620 over central Europe). Every type-based test below therefore only
  // fires on the adsb.fi feeds, which is what left all OpenSky traffic in the
  // commercial bucket. The callsign is the field OpenSky always fills, so the
  // airline-designator test is what carries the split for the bulk of the map.
  const isGaCallsign = !airlineCode && CALLSIGN_RE.test(flightStr);
  const cruisesLikeAJet =
    altMeters > JET_CRUISE_ALT_M && (speedKnots ?? 0) > JET_CRUISE_KTS;

  let category: 'commercial' | 'private' | 'jet' | 'military' = 'commercial';
  if (isOsMilitary || dbFlags & 1 || MILITARY_INDICATORS.has(modelUpper) || (f.flight || '').match(/^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i)) {
    category = 'military';
  } else if (AIRLINER_TYPES.has(modelUpper) || isOsHeavy) {
    category = 'commercial';
  } else if (
    BIZJET_OPERATORS.has(airlineCode) ||
    PRIVATE_JET_TYPES.has(modelUpper) ||
    isOsHighPerf ||
    (isGaCallsign && cruisesLikeAJet)
  ) {
    category = 'jet';
  } else if (isGaCallsign || isOsLight) {
    category = 'private';
  }

  return {
    callsign,
    lat: Math.round(lat * 100000) / 100000,
    lng: Math.round(lon * 100000) / 100000,
    alt: Math.round(altMeters),
    heading: Math.round(heading),
    speed_knots: speedKnots,
    model: f.t || 'Unknown',
    icao24: f.hex || '',
    registration: f.r || 'N/A',
    squawk: f.squawk || '',
    airline_code: airlineCode,
    aircraft_category: isHeli ? 'heli' : 'plane',
    category,
    grounded: isGrounded,
    nac_p: f.nac_p,
    type: 'flight',
  };
}

/** A classified flight row — the return shape of classifyFlight. */
type FlightRow = NonNullable<ReturnType<typeof classifyFlight>>;

/** The /api/flights response payload. */
interface FlightPayload {
  commercial_flights: FlightRow[];
  private_flights: FlightRow[];
  private_jets: FlightRow[];
  military_flights: FlightRow[];
  gps_jamming: { lat: number; lng: number; severity: number; count: number }[];
  total: number;
  source: string;
  partial?: boolean;
  providers: {
    adsbfi_mil: number;
    adsblol: number;
    adsbfi_regional: number;
    opensky: number;
    opensky_auth: boolean;
    opensky_age_s: number | null;
  };
  timestamp: string;
}

let cachedData: FlightPayload | null = null;
let lastFetchTime = 0;
// 90s TTL keeps us well within the authenticated OpenSky budget (4000 credits/day,
// 4 credits/call = 1000 calls/day ≈ one per 86s). The old 45s TTL at ~1920 calls/day
// was what got the VPS IP rate-limited on the anonymous pool.
const CACHE_TTL = 90000;

// OpenSky's budget is per day, not per request, so it needs its own interval
// separate from the response cache above. Authenticated it is 4000 credits/day
// and an unbounded /states/all costs 4, which is the 90s the TTL was built for.
// Anonymous it is only 400 credits/day — 100 calls, one per ~864s — so polling
// it on the same 90s TTL burns the whole day's budget in about half an hour,
// after which every call 429s and the route sits permanently in the cooldown
// branch below. That is what emptied the map: no credentials were configured,
// so the budget was gone and the feeds it fell back to were the dead ones above.
const hasOpenSkyCreds = () =>
  Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET);
const openSkyInterval = () => (hasOpenSkyCreds() ? 90000 : 900000);

// The last good OpenSky snapshot is kept and reused between those calls. On the
// anonymous interval a refetch is only due every 15 minutes, and rebuilding the
// payload from adsb.fi alone in between would swing the map between ~10K
// aircraft and a few hundred every 90s. Reusing the snapshot keeps the aircraft
// on screen stable; only their age varies, which providers.opensky_age_s reports.
let osSnapshot: any[] = [];
let osSnapshotTime = 0;
let fetchPromise: Promise<FlightPayload> | null = null;

// Back off from OpenSky after a 429 so the daily quota can reset.
// Re-poking a limited endpoint on every cache miss keeps the IP throttled.
let openSkyCooldownUntil = 0;
const OPENSKY_COOLDOWN = 15 * 60 * 1000; // 15 min

// OpenSky OAuth2 — optional but recommended for VPS deployments.
// Without keys: anonymous, works fine on residential IPs. VPS IPs can
// be throttled by OpenSky's anonymous per-IP pool. Setting these env
// vars bypasses the per-IP pool (account pool: 4000 credits/day).
let osToken: string | null = null;
let osTokenExpiry = 0;

async function getOpenSkyToken(): Promise<string | null> {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (osToken && Date.now() < osTokenExpiry) return osToken;
  try {
    const res = await fetch(
      'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) { console.warn('[OSIRIS] OpenSky token failed:', res.status); return null; }
    const data = await res.json();
    if (!data.access_token) {
      console.warn('[OSIRIS] OpenSky token response missing access_token');
      return null;
    }
    osToken = data.access_token;
    osTokenExpiry = Date.now() + ((data.expires_in || 1800) - 60) * 1000;
    return osToken;
  } catch (e) {
    console.warn('[OSIRIS] OpenSky token error:', e);
    return null;
  }
}

function ingestAc(raw: any[], into: any[], seen: Set<string>) {
  for (const ac of raw) {
    const hex = (ac.hex || '').toLowerCase().trim();
    if (hex && !seen.has(hex)) { seen.add(hex); into.push(ac); }
  }
}

// ── First wave ──────────────────────────────────────────────────────────────
// The densest corridors. A cold instance answers from these alone (a few
// seconds); the full sweep completes behind the response and lands in the
// cache, so the next request — or the client's 30s refetch — sees the whole
// sky. First-wave payloads carry `partial: true` and are never cached.
const FIRST_WAVE = [
  { lat: 39.8, lon: -98.5 }, // Central US
  { lat: 41.0, lon: -74.0 }, // Northeast (NYC/Boston/DC)
  { lat: 33.0, lon: -84.0 }, // Southeast (Atlanta)
  { lat: 42.0, lon: -88.0 }, // Midwest (Chicago)
  { lat: 30.0, lon: -97.0 }, // Texas (Dallas/Houston)
  { lat: 34.0, lon: -118.0 }, // SoCal (LA)
  { lat: 50.0, lon: 15.0 }, // Central Europe
  { lat: 51.5, lon: -1.0 }, // UK / Ireland
  { lat: 47.0, lon: 2.0 }, // France / Alps
  { lat: 40.0, lon: -4.0 }, // Iberia
  { lat: 42.0, lon: 13.0 }, // Italy / Adriatic
  { lat: 35.0, lon: 136.0 }, // Japan
];

let firstWavePromise: Promise<FlightPayload> | null = null;

/* Fresh full payloads are edge-cacheable for a minute (positions are already
   up to 90 s stale by design, and the client polls every 5 min); the edge
   serves stale for a further two minutes while revalidating. Partial and
   stale payloads are never edge-cached — they are one visitor's interim
   answer, not the fresh truth. */
const freshHeaders = (total: number) => ({
  'Cache-Control': total < 100 ? 'no-store, max-age=0' : 'public, s-maxage=60, stale-while-revalidate=120',
});
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' };

/** Military feeds (both providers), drained into the accumulator. Returns
    how many military aircraft they contributed. */
async function fetchMilInto(allRaw: Array<Record<string, unknown>>, seenHex: Set<string>): Promise<number> {
  const before = allRaw.length;
  const [fiRes, lolRes] = await Promise.allSettled([
    stealthFetch(`${ADSBFI_BASE}/mil`, { signal: AbortSignal.timeout(15000) }),
    stealthFetch(`${ADSBLOL_BASE}/mil`, { signal: AbortSignal.timeout(15000) }),
  ]);
  for (const [label, r] of [['adsb.fi', fiRes], ['adsb.lol', lolRes]] as const) {
    if (r.status === 'fulfilled') {
      if (r.value.ok) {
        try {
          const data = await r.value.json();
          ingestAc(acArray(data), allRaw, seenHex);
        } catch (e) {
          console.warn(`[OSIRIS] ${label} mil parse error:`, e);
        }
      } else {
        console.warn(`[OSIRIS] ${label} mil feed returned`, r.value.status);
        await r.value.body?.cancel();
      }
    }
  }
  return allRaw.length - before;
}

/** OpenSky snapshot refresh. Returns true when a usable snapshot exists
    afterwards (freshly fetched or carried over). Only called with
    credentials: anonymously the pool is throttled out within the first hour,
    so without credentials it is not called at all. */
async function refreshOpenSkySnapshot(): Promise<boolean> {
  const token = await getOpenSkyToken();
  const osInit: RequestInit = token
    ? { signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}` } }
    : { signal: AbortSignal.timeout(30000) };
  let res: Response;
  try {
    res = await stealthFetch('https://opensky-network.org/api/states/all?extended=1', osInit);
  } catch {
    return osSnapshot.length > 0;
  }
  if (res.status === 429) {
    openSkyCooldownUntil = Date.now() + OPENSKY_COOLDOWN;
    console.warn('[OSIRIS] OpenSky 429 — cooling down 15 min');
    await res.body?.cancel();
    return osSnapshot.length > 0;
  }
  if (!res.ok) {
    // A rejected token surfaces here as a 401 — previously discarded silently.
    console.warn('[OSIRIS] OpenSky returned', res.status);
    await res.body?.cancel();
    return osSnapshot.length > 0;
  }
  try {
    const data = await res.json();
    const states = data.states || [];
    if (states.length > 100) {
      osSnapshot = states.map((s: any[]) => ({
        hex: s[0],
        flight: s[1]?.trim(),
        lon: s[5],
        lat: s[6],
        alt_baro: typeof s[7] === 'number' ? s[7] * 3.28084 : null,
        gs: typeof s[9] === 'number' ? s[9] * 1.94384 : null,
        track: s[10],
        squawk: s[14],
        category_os: s[17],
      }));
      osSnapshotTime = Date.now();
    }
  } catch (e) {
    console.warn('[OSIRIS] OpenSky parse error:', e);
  }
  return osSnapshot.length > 0;
}

/** adsb.lol regional sweep over the given regions. The pool stays at 5: a
    wider fan-out measured worse (8-concurrent halved the aircraft returned,
    i.e. the provider throttles). Returns the lol count and the regions that
    answered empty, for the adsb.fi fallback. */
async function sweepLolRegions(
  regions: { lat: number; lon: number }[],
  allRaw: Array<Record<string, unknown>>,
  seenHex: Set<string>,
): Promise<{ count: number; empty: { lat: number; lon: number }[] }> {
  const before = allRaw.length;
  const empty: { lat: number; lon: number }[] = [];
  const POOL = 5;
  for (let i = 0; i < regions.length; i += POOL) {
    const batch = regions.slice(i, i + POOL);
    const results = await Promise.all(batch.map(r => fetchAdsbLolRegion(r.lat, r.lon)));
    results.forEach((ac, j) => {
      if (ac.length) ingestAc(ac, allRaw, seenHex);
      else empty.push(batch[j]);
    });
  }
  return { count: allRaw.length - before, empty };
}

/** adsb.fi fallback for regions adsb.lol answered empty, under a time
    budget. adsb.fi allows roughly one request per second and soft-throttles
    over that by returning 200 with an empty array, so the fallback is paced
    and never the parallel primary. Regions the budget skips are retried on
    the next cache cycle. */
async function sweepFiFallback(
  emptyRegions: { lat: number; lon: number }[],
  allRaw: Array<Record<string, unknown>>,
  seenHex: Set<string>,
): Promise<number> {
  const before = allRaw.length;
  const FALLBACK_BUDGET_MS = 20_000;
  const fallbackStart = Date.now();
  let fiCursor = 0;
  const fiWorker = async () => {
    while (fiCursor < emptyRegions.length) {
      if (Date.now() - fallbackStart > FALLBACK_BUDGET_MS) return;
      const r = emptyRegions[fiCursor++];
      ingestAc(await fetchAdsbFiRegion(r.lat, r.lon), allRaw, seenHex);
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  };
  await Promise.all([fiWorker(), fiWorker(), fiWorker()]);
  return allRaw.length - before;
}

/** Classify the accumulated raw aircraft and build the response payload. */
function buildPayload(
  allRaw: Array<Record<string, unknown>>,
  opts: { source: string; milCount: number; lolCount: number; fiRegionalCount: number; partial?: boolean },
): FlightPayload {
  const JAMMING_NACAP_THRESHOLD = 4;
  const commercial: FlightRow[] = [];
  const privateFl: FlightRow[] = [];
  const jets: FlightRow[] = [];
  const military: FlightRow[] = [];
  const gpsJamming: { lat: number; lng: number; nac_p: number; callsign: string }[] = [];

  for (const raw of allRaw) {
    const flight = classifyFlight(raw);
    if (!flight) continue;

    if (typeof flight.nac_p === 'number' && flight.nac_p <= JAMMING_NACAP_THRESHOLD && !flight.grounded) {
      gpsJamming.push({ lat: flight.lat, lng: flight.lng, nac_p: flight.nac_p, callsign: flight.callsign });
    }

    switch (flight.category) {
      case 'military': military.push(flight); break;
      case 'jet':      jets.push(flight);     break;
      case 'private':  privateFl.push(flight); break;
      default:         commercial.push(flight);
    }
  }

  return {
    commercial_flights: commercial,
    private_flights:    privateFl,
    private_jets:       jets,
    military_flights:   military,
    gps_jamming:        aggregateJamming(gpsJamming, JAMMING_NACAP_THRESHOLD),
    total:              allRaw.length,
    source:             opts.source,
    ...(opts.partial ? { partial: true } : {}),
    // Per-feed counts so a provider that starts answering 200 with no aircraft
    // is visible in the payload rather than silently emptying the map.
    providers: {
      adsbfi_mil:      opts.milCount,
      adsblol:         opts.lolCount,
      adsbfi_regional: opts.fiRegionalCount,
      opensky:         osSnapshot.length,
      opensky_auth:    hasOpenSkyCreds(),
      opensky_age_s:   osSnapshotTime ? Math.round((Date.now() - osSnapshotTime) / 1000) : null,
    },
    timestamp:          new Date().toISOString(),
  };
}

/** The full community sweep: military feeds and the 30-region adsb.lol sweep
    run concurrently (measured 3x faster than the old sequential march: 5.6 s
    vs 18.9 s from the test host), then the adsb.fi fallback for empty
    regions. */
async function runCommunitySweep(): Promise<FlightPayload> {
  const allRaw: Array<Record<string, unknown>> = [];
  const seenHex = new Set<string>();
  const [milCount, lol] = await Promise.all([
    fetchMilInto(allRaw, seenHex),
    sweepLolRegions(REGIONS, allRaw, seenHex),
  ]);
  const fiRegionalCount = await sweepFiFallback(lol.empty, allRaw, seenHex);
  if (allRaw.length === 0) {
    console.error(
      '[OSIRIS] every flight provider returned zero aircraft — ' +
      'set OPENSKY_CLIENT_ID/OPENSKY_CLIENT_SECRET (free at opensky-network.org) ' +
      'for an authenticated primary source'
    );
  }
  return buildPayload(allRaw, { source: 'community', milCount, lolCount: lol.count, fiRegionalCount });
}

/** The authenticated-OpenSky sweep: military + OpenSky first, civil regions
    only when the snapshot is empty. Unchanged from the original flow — the
    creds path was already fast (one /states/all call). */
async function runOpenSkySweep(): Promise<FlightPayload> {
  const allRaw: Array<Record<string, unknown>> = [];
  const seenHex = new Set<string>();
  const [milCount, openSkyWorked] = await Promise.all([
    fetchMilInto(allRaw, seenHex),
    refreshOpenSkySnapshot(),
  ]);
  ingestAc(osSnapshot, allRaw, seenHex);
  let lolCount = 0;
  let fiRegionalCount = 0;
  let source = 'opensky-auth';
  if (!openSkyWorked) {
    source = 'community';
    const lol = await sweepLolRegions(REGIONS, allRaw, seenHex);
    lolCount = lol.count;
    fiRegionalCount = await sweepFiFallback(lol.empty, allRaw, seenHex);
    if (allRaw.length === 0) {
      console.error(
        '[OSIRIS] every flight provider returned zero aircraft — ' +
        'set OPENSKY_CLIENT_ID/OPENSKY_CLIENT_SECRET (free at opensky-network.org) ' +
        'for an authenticated primary source'
      );
    }
  }
  return buildPayload(allRaw, { source, milCount, lolCount, fiRegionalCount });
}

/** Fast first wave for a cold instance: military feeds + the 12 densest
    regions, concurrently. No adsb.fi fallback — speed matters more than the
    last few quiet regions here; the full sweep behind the response covers
    them. The payload is marked partial and never cached. */
async function runFirstWave(): Promise<FlightPayload> {
  const allRaw: Array<Record<string, unknown>> = [];
  const seenHex = new Set<string>();
  const [milCount, lol] = await Promise.all([
    fetchMilInto(allRaw, seenHex),
    sweepLolRegions(FIRST_WAVE, allRaw, seenHex),
  ]);
  return buildPayload(allRaw, { source: 'community', milCount, lolCount: lol.count, fiRegionalCount: 0, partial: true });
}

async function getFirstWave(): Promise<FlightPayload> {
  if (firstWavePromise) return firstWavePromise;
  firstWavePromise = runFirstWave();
  try {
    return await firstWavePromise;
  } finally {
    firstWavePromise = null;
  }
}

/** True when an authenticated OpenSky refresh is due (credentials configured,
    not in 429 cooldown, snapshot older than its interval). */
function openSkyDue(): boolean {
  return hasOpenSkyCreds() && Date.now() >= openSkyCooldownUntil && Date.now() - osSnapshotTime >= openSkyInterval();
}

/** The full sweep, deduplicated across concurrent requests, cached on
    success. With credentials and a carried-over snapshot the civil sweep is
    skipped, exactly as before — the snapshot is the source of record. */
async function getFreshFlights(): Promise<FlightPayload> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    if (openSkyDue()) return runOpenSkySweep();
    if (hasOpenSkyCreds() && osSnapshot.length > 0) {
      const allRaw: Array<Record<string, unknown>> = [];
      const seenHex = new Set<string>();
      const milCount = await fetchMilInto(allRaw, seenHex);
      ingestAc(osSnapshot, allRaw, seenHex);
      return buildPayload(allRaw, { source: 'opensky-auth', milCount, lolCount: 0, fiRegionalCount: 0 });
    }
    return runCommunitySweep();
  })();
  try {
    const data = await fetchPromise;
    cachedData = data;
    lastFetchTime = Date.now();
    return data;
  } finally {
    fetchPromise = null;
  }
}

export async function GET() {
  const now = Date.now();

  // Fresh cache: answer immediately.
  if (cachedData && now - lastFetchTime < CACHE_TTL) {
    return NextResponse.json(cachedData, { headers: freshHeaders(cachedData.total ?? 0) });
  }

  // Stale cache: answer from it now and refresh behind the response — a
  // visitor never waits out a sweep for data that is at most 90 seconds old.
  if (cachedData) {
    after(() => {
      void getFreshFlights().catch(e => console.error('[OSIRIS] Background flight refresh failed:', e));
    });
    return NextResponse.json({ ...cachedData, stale: true }, { headers: NO_STORE_HEADERS });
  }

  // A sweep is already running: join it instead of starting a second one.
  if (fetchPromise) {
    try {
      const data = await fetchPromise;
      return NextResponse.json(data, { headers: freshHeaders(data.total ?? 0) });
    } catch {
      return NextResponse.json({ error: 'Failed to fetch flight data' }, { status: 500 });
    }
  }

  // Cold instance, authenticated OpenSky: the creds path is already fast
  // (one /states/all call + military), so run it synchronously.
  if (openSkyDue()) {
    try {
      const data = await getFreshFlights();
      return NextResponse.json(data, { headers: freshHeaders(data.total ?? 0) });
    } catch (error) {
      console.error('[OSIRIS] Flight fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch flight data' }, { status: 500 });
    }
  }

  // Cold instance, community path: answer from the fast first wave now and
  // run the full sweep behind the response. If the wave itself fails, fall
  // back to the full sweep rather than answering empty.
  try {
    const wave = await getFirstWave();
    after(() => {
      void getFreshFlights().catch(e => console.error('[OSIRIS] Background flight refresh failed:', e));
    });
    return NextResponse.json(wave, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('[OSIRIS] First-wave flight fetch error:', error);
    try {
      const data = await getFreshFlights();
      return NextResponse.json(data, { headers: freshHeaders(data.total ?? 0) });
    } catch (e2) {
      console.error('[OSIRIS] Flight fetch error:', e2);
      return NextResponse.json({ error: 'Failed to fetch flight data' }, { status: 500 });
    }
  }
}

function aggregateJamming(points: any[], threshold: number) {
  if (points.length === 0) return [];
  const grid = new Map<string, { lat: number; lng: number; count: number; total_nac_p: number }>();
  const GRID_SIZE = 2;

  for (const p of points) {
    const gLat = Math.floor(p.lat / GRID_SIZE) * GRID_SIZE;
    const gLng = Math.floor(p.lng / GRID_SIZE) * GRID_SIZE;
    const key = `${gLat},${gLng}`;
    if (!grid.has(key)) grid.set(key, { lat: gLat + GRID_SIZE / 2, lng: gLng + GRID_SIZE / 2, count: 0, total_nac_p: 0 });
    const cell = grid.get(key)!;
    cell.count++;
    cell.total_nac_p += p.nac_p;
  }

  return Array.from(grid.values())
    .filter(z => z.count >= 3)
    .map(z => ({
      lat: z.lat,
      lng: z.lng,
      severity: Math.round((1 - (z.total_nac_p / z.count) / threshold) * 100),
      count: z.count,
    }));
}
