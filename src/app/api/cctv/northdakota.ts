import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — North Dakota CCTV Cameras (NDDOT / NDRoads)
 * Source: https://gis.dot.nd.gov/arcgis/rest/services/external/rcrs_dynamic/MapServer/5
 * — the "Cameras-Still" layer of NDDOT's public ArcGIS service, the same one
 * travel.dot.nd.gov draws — NO API KEY NEEDED.
 * 190 camera sites publishing 814 directional stills.
 *
 * One feature is one physical site with up to six numbered views
 * (`Link`/`Description`, `Link2`/`Description2`, …) — different directions
 * of the same RWIS camera, each with its own JPEG on dot.nd.gov. Every view
 * becomes its own camera; the site id is the ArcGIS OBJECTID and the view
 * number keeps them unique.
 *
 * Geometry comes back in Web Mercator by default, so the query pins
 * `outSR=4326`. The eastern bound sits at −96.7 rather than the nominal
 * −97.0 state line: the border is the Red River, and Fargo's cameras
 * legitimately stand at −96.78.
 */

const QUERY_URL =
  'https://gis.dot.nd.gov/arcgis/rest/services/external/rcrs_dynamic/MapServer/5/query' +
  '?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=json';

/** North Dakota bounding box — drops any stray/placeholder coordinates. */
const ND_BOUNDS = { minLat: 45.9, maxLat: 49.0, minLng: -104.1, maxLng: -96.7 };

/** One feature from the Cameras-Still layer — only the fields we consume. */
export interface NddotFeature {
  attributes?: {
    OBJECTID?: number | null;
    Active?: string | null;
    Description?: string | null;
    Link?: string | null;
    Description2?: string | null;
    Link2?: string | null;
    Description3?: string | null;
    Link3?: string | null;
    Description4?: string | null;
    Link4?: string | null;
    Description5?: string | null;
    Link5?: string | null;
    Description6?: string | null;
    Link6?: string | null;
  } | null;
  geometry?: { x?: number; y?: number } | null;
}

const VIEW_SUFFIXES = ['', '2', '3', '4', '5', '6'] as const;

/** `Ray - West (US 2 MP 51.3) - NDDOT` → `Ray - West (US 2 MP 51.3)`. */
export function cleanDescription(description?: string | null): string {
  return (description || '').replace(/\s+-\s+NDDOT\s*$/i, '').trim();
}

/**
 * Map one site to its cameras — one per published view, possibly none.
 * Exported for tests.
 */
export function mapFeature(f: NddotFeature): CctvCamera[] {
  const a = f?.attributes;
  if (!a || typeof a.OBJECTID !== 'number' || a.Active === 'N') return [];

  const lng = f.geometry?.x;
  const lat = f.geometry?.y;
  if (typeof lat !== 'number' || typeof lng !== 'number') return [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  if (lat < ND_BOUNDS.minLat || lat > ND_BOUNDS.maxLat) return [];
  if (lng < ND_BOUNDS.minLng || lng > ND_BOUNDS.maxLng) return [];

  const cams: CctvCamera[] = [];
  VIEW_SUFFIXES.forEach((suffix, i) => {
    const link = a[`Link${suffix}` as keyof typeof a] as string | null | undefined;
    const url = link?.trim();
    if (!url) return;
    const description = a[`Description${suffix}` as keyof typeof a] as string | null | undefined;
    cams.push({
      id: `nddot-${a.OBJECTID}-${i + 1}`,
      lat,
      lng,
      name: cleanDescription(description) || `NDDOT Camera ${a.OBJECTID}-${i + 1}`,
      city: 'North Dakota',
      country: 'US',
      feed_url: url,
      source: 'NDDOT',
    });
  });
  return cams;
}

async function loadNorthDakotaCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(QUERY_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`NDDOT ArcGIS HTTP ${res.status}`);

  const json = await res.json();
  if (json?.error) throw new Error(`NDDOT ArcGIS error: ${json.error.message || 'unknown'}`);
  const feats = json?.features;
  if (!Array.isArray(feats)) throw new Error('NDDOT ArcGIS returned no features');
  /* A truncated page would read as a smaller state; refuse it so the cache
     keeps the last good index instead. */
  if (json.exceededTransferLimit) throw new Error('NDDOT ArcGIS truncated the result');

  const cams: CctvCamera[] = [];
  for (const f of feats) cams.push(...mapFeature(f));

  console.log(`[OSIRIS] North Dakota cameras — NDDOT: ${cams.length} views from ${feats.length} sites`);
  return cams;
}

export const fetchNorthDakotaCameras = cachedSource('northdakota', loadNorthDakotaCameras);
