import { NextResponse } from 'next/server';

/**
 * OSIRIS — Air Quality Monitoring API
 *
 * PM2.5 for a worldwide panel of cities, from the Copernicus Atmosphere
 * Monitoring Service (CAMS) via the Open-Meteo air-quality API — free, no
 * key. Values are *modelled* (CAMS blends satellite + ground observations
 * into a grid), not raw readings from a named ground station; the payload
 * says so (`source` / `modeled: true`) rather than dressing model output up
 * as station data.
 *
 * This route used to read OpenAQ v2's /latest endpoint. OpenAQ retired v2
 * (it answers 200 with no results), which left this endpoint permanently,
 * silently empty. OpenAQ v3 is the station-grade source but requires a
 * personal API key, so it is a configuration upgrade, not the default:
 * set OPENAQ_API_KEY and this route prefers real station data again.
 */

export const dynamic = 'force-dynamic';

interface City { name: string; country: string; lat: number; lng: number }

/** Population-weighted panel: every continent, every major metro. */
const CITIES: City[] = [
  // North America
  { name: 'El Paso', country: 'US', lat: 31.76, lng: -106.49 },
  { name: 'New York', country: 'US', lat: 40.71, lng: -74.01 },
  { name: 'Los Angeles', country: 'US', lat: 34.05, lng: -118.24 },
  { name: 'Chicago', country: 'US', lat: 41.88, lng: -87.63 },
  { name: 'Houston', country: 'US', lat: 29.76, lng: -95.37 },
  { name: 'Phoenix', country: 'US', lat: 33.45, lng: -112.07 },
  { name: 'Denver', country: 'US', lat: 39.74, lng: -104.99 },
  { name: 'San Francisco', country: 'US', lat: 37.77, lng: -122.42 },
  { name: 'Seattle', country: 'US', lat: 47.61, lng: -122.33 },
  { name: 'Atlanta', country: 'US', lat: 33.75, lng: -84.39 },
  { name: 'Miami', country: 'US', lat: 25.76, lng: -80.19 },
  { name: 'Toronto', country: 'CA', lat: 43.65, lng: -79.38 },
  { name: 'Vancouver', country: 'CA', lat: 49.28, lng: -123.12 },
  { name: 'Mexico City', country: 'MX', lat: 19.43, lng: -99.13 },
  { name: 'Guadalajara', country: 'MX', lat: 20.67, lng: -103.35 },
  { name: 'Monterrey', country: 'MX', lat: 25.69, lng: -100.32 },
  // South America
  { name: 'São Paulo', country: 'BR', lat: -23.55, lng: -46.63 },
  { name: 'Rio de Janeiro', country: 'BR', lat: -22.91, lng: -43.17 },
  { name: 'Buenos Aires', country: 'AR', lat: -34.60, lng: -58.38 },
  { name: 'Santiago', country: 'CL', lat: -33.45, lng: -70.67 },
  { name: 'Lima', country: 'PE', lat: -12.05, lng: -77.04 },
  { name: 'Bogotá', country: 'CO', lat: 4.71, lng: -74.07 },
  // Europe
  { name: 'London', country: 'GB', lat: 51.51, lng: -0.13 },
  { name: 'Paris', country: 'FR', lat: 48.86, lng: 2.35 },
  { name: 'Berlin', country: 'DE', lat: 52.52, lng: 13.40 },
  { name: 'Madrid', country: 'ES', lat: 40.42, lng: -3.70 },
  { name: 'Rome', country: 'IT', lat: 41.90, lng: 12.50 },
  { name: 'Warsaw', country: 'PL', lat: 52.23, lng: 21.01 },
  { name: 'Kraków', country: 'PL', lat: 50.06, lng: 19.94 },
  { name: 'Amsterdam', country: 'NL', lat: 52.37, lng: 4.90 },
  { name: 'Stockholm', country: 'SE', lat: 59.33, lng: 18.07 },
  { name: 'Athens', country: 'GR', lat: 37.98, lng: 23.73 },
  { name: 'Istanbul', country: 'TR', lat: 41.01, lng: 28.98 },
  { name: 'Moscow', country: 'RU', lat: 55.76, lng: 37.62 },
  { name: 'Kyiv', country: 'UA', lat: 50.45, lng: 30.52 },
  // Middle East & Africa
  { name: 'Cairo', country: 'EG', lat: 30.04, lng: 31.24 },
  { name: 'Lagos', country: 'NG', lat: 6.52, lng: 3.37 },
  { name: 'Johannesburg', country: 'ZA', lat: -26.20, lng: 28.05 },
  { name: 'Nairobi', country: 'KE', lat: -1.29, lng: 36.82 },
  { name: 'Riyadh', country: 'SA', lat: 24.71, lng: 46.68 },
  { name: 'Dubai', country: 'AE', lat: 25.20, lng: 55.27 },
  { name: 'Tehran', country: 'IR', lat: 35.69, lng: 51.39 },
  { name: 'Baghdad', country: 'IQ', lat: 33.31, lng: 44.36 },
  // South & Central Asia
  { name: 'Delhi', country: 'IN', lat: 28.61, lng: 77.21 },
  { name: 'Mumbai', country: 'IN', lat: 19.08, lng: 72.88 },
  { name: 'Kolkata', country: 'IN', lat: 22.57, lng: 88.36 },
  { name: 'Bengaluru', country: 'IN', lat: 12.97, lng: 77.59 },
  { name: 'Chennai', country: 'IN', lat: 13.08, lng: 80.27 },
  { name: 'Hyderabad', country: 'IN', lat: 17.39, lng: 78.49 },
  { name: 'Lahore', country: 'PK', lat: 31.55, lng: 74.34 },
  { name: 'Karachi', country: 'PK', lat: 24.86, lng: 67.00 },
  { name: 'Dhaka', country: 'BD', lat: 23.81, lng: 90.41 },
  { name: 'Kathmandu', country: 'NP', lat: 27.71, lng: 85.32 },
  { name: 'Almaty', country: 'KZ', lat: 43.24, lng: 76.89 },
  { name: 'Tashkent', country: 'UZ', lat: 41.31, lng: 69.24 },
  // East & Southeast Asia
  { name: 'Beijing', country: 'CN', lat: 39.90, lng: 116.40 },
  { name: 'Shanghai', country: 'CN', lat: 31.23, lng: 121.47 },
  { name: 'Guangzhou', country: 'CN', lat: 23.13, lng: 113.26 },
  { name: 'Shenzhen', country: 'CN', lat: 22.54, lng: 114.06 },
  { name: 'Chengdu', country: 'CN', lat: 30.67, lng: 104.06 },
  { name: 'Wuhan', country: 'CN', lat: 30.59, lng: 114.31 },
  { name: "Xi'an", country: 'CN', lat: 34.34, lng: 108.94 },
  { name: 'Hong Kong', country: 'HK', lat: 22.32, lng: 114.17 },
  { name: 'Taipei', country: 'TW', lat: 25.03, lng: 121.57 },
  { name: 'Seoul', country: 'KR', lat: 37.57, lng: 126.98 },
  { name: 'Tokyo', country: 'JP', lat: 35.68, lng: 139.69 },
  { name: 'Osaka', country: 'JP', lat: 34.69, lng: 135.50 },
  { name: 'Bangkok', country: 'TH', lat: 13.76, lng: 100.50 },
  { name: 'Chiang Mai', country: 'TH', lat: 18.79, lng: 98.98 },
  { name: 'Hanoi', country: 'VN', lat: 21.03, lng: 105.85 },
  { name: 'Ho Chi Minh City', country: 'VN', lat: 10.82, lng: 106.63 },
  { name: 'Jakarta', country: 'ID', lat: -6.21, lng: 106.85 },
  { name: 'Kuala Lumpur', country: 'MY', lat: 3.14, lng: 101.69 },
  { name: 'Singapore', country: 'SG', lat: 1.35, lng: 103.82 },
  { name: 'Manila', country: 'PH', lat: 14.60, lng: 120.98 },
  { name: 'Ulaanbaatar', country: 'MN', lat: 47.92, lng: 106.92 },
  // Oceania
  { name: 'Sydney', country: 'AU', lat: -33.87, lng: 151.21 },
  { name: 'Melbourne', country: 'AU', lat: -37.81, lng: 144.96 },
  { name: 'Brisbane', country: 'AU', lat: -27.47, lng: 153.03 },
  { name: 'Perth', country: 'AU', lat: -31.95, lng: 115.86 },
  { name: 'Auckland', country: 'NZ', lat: -36.85, lng: 174.76 },
];

function levelFor(val: number): { level: string; color: string } {
  // AQI color coding based on PM2.5 (WHO/EPA scale) — unchanged thresholds.
  if (val > 150) return { level: 'Hazardous', color: '#8B0000' };
  if (val > 100) return { level: 'Unhealthy', color: '#FF1744' };
  if (val > 55) return { level: 'Unhealthy (Sensitive)', color: '#FF9500' };
  if (val > 35) return { level: 'Moderate', color: '#FFD700' };
  return { level: 'Good', color: '#00E676' };
}

interface AqPayload {
  stations: any[];
  total: number;
  source: string;
  modeled: boolean;
  timestamp: string;
}

let cached: AqPayload | null = null;
let cacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // CAMS updates hourly; 15 min is well inside it

async function fetchCams(): Promise<AqPayload> {
  const lats = CITIES.map(c => c.lat).join(',');
  const lngs = CITIES.map(c => c.lng).join(',');
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lngs}&current=pm2_5`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Open-Meteo AQ HTTP ${res.status}`);
  const data = await res.json();
  const rows: any[] = Array.isArray(data) ? data : [data];

  const stations: any[] = [];
  rows.forEach((row, i) => {
    const city = CITIES[i];
    const val = row?.current?.pm2_5;
    if (!city || typeof val !== 'number') return;
    const { level, color } = levelFor(val);
    stations.push({
      id: `aq-${city.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: city.name,
      city: city.name,
      country: city.country,
      // The model's grid cell, not the exact pin — same as the old route's
      // station coordinates, these are the coordinates the value is *for*.
      lat: row.latitude ?? city.lat,
      lng: row.longitude ?? city.lng,
      pm25: val,
      unit: 'µg/m³',
      level,
      color,
      lastUpdated: row.current?.time ?? new Date().toISOString(),
    });
  });

  if (!stations.length) throw new Error('Open-Meteo AQ returned no values');
  return {
    stations,
    total: stations.length,
    source: 'Copernicus CAMS via Open-Meteo (modelled PM2.5)',
    modeled: true,
    timestamp: new Date().toISOString(),
  };
}

/** OpenAQ v3 — real ground stations, when a key is configured. */
async function fetchOpenAq(key: string): Promise<AqPayload> {
  const res = await fetch(
    'https://api.openaq.org/v3/parameters/2/latest?limit=500',
    {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', 'X-API-Key': key },
    },
  );
  if (!res.ok) throw new Error(`OpenAQ v3 HTTP ${res.status}`);
  const data = await res.json();
  const stations: any[] = [];
  for (const r of data.results || []) {
    const coords = r.coordinates;
    if (typeof r.value !== 'number' || !coords) continue;
    const { level, color } = levelFor(r.value);
    stations.push({
      id: `aq-${r.locationsId ?? r.sensorsId ?? stations.length}`,
      name: r.name ?? 'OpenAQ station',
      city: 'Unknown',
      country: '',
      lat: coords.latitude,
      lng: coords.longitude,
      pm25: r.value,
      unit: 'µg/m³',
      level,
      color,
      lastUpdated: r.datetimeLast?.utc ?? new Date().toISOString(),
    });
  }
  if (!stations.length) throw new Error('OpenAQ v3 returned no stations');
  return {
    stations,
    total: stations.length,
    source: 'OpenAQ v3 (ground stations)',
    modeled: false,
    timestamp: new Date().toISOString(),
  };
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cacheTime < CACHE_TTL) {
    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' },
    });
  }

  try {
    const key = process.env.OPENAQ_API_KEY;
    const payload = key ? await fetchOpenAq(key).catch(() => fetchCams()) : await fetchCams();
    cached = payload;
    cacheTime = now;
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' },
    });
  } catch (error) {
    console.error('Air Quality API error:', error);
    // Stale beats empty: CAMS data an hour old is still a picture of the air.
    if (cached) {
      return NextResponse.json(
        { ...cached, stale: true },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json({ stations: [], total: 0, error: 'Failed to fetch air quality data' }, { status: 500 });
  }
}
