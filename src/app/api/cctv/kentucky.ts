import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Kentucky CCTV Cameras (KYTC / goky.ky.gov)
 * Sources: the two ArcGIS FeatureServer layers GoKY's own map reads —
 *   KYTC statewide: services2.arcgis.com …/trafficCamerasCur_Prd (256 rows)
 *   Lexington:      services1.arcgis.com …/Traffic_Camera_Locations_Public_view (108)
 * ~354 cameras after drops — NO API KEY NEEDED. (511.ky.gov refuses
 * connections from here; GoKY is the current official map and its layers
 * are public ArcGIS.)
 *
 * The statewide layer is really TRIMARC's Louisville-metro index. Most rows
 * carry an asset-code `name` (CCTV05161) and a readable `description`, so
 * the description is the label. Nine rows at the top of the layer are
 * Indiana-side I-65/I-64 cameras cross-listed with no name, county or
 * status — and dead snapshots (404s and a redirect into an HTML page,
 * verified) — so they are dropped; Indiana's own feed covers INDOT.
 * The one `Offline` row goes too.
 *
 * Lexington's rows are snapshot-only: a Wowza thumbnail endpoint that
 * serves a real PNG. One of its 108 rows points at a private 172.19.x.x
 * address serving an HTML viewer page instead of an image — not a feed,
 * so the mapping requires an actual thumbnail/image URL.
 */

const KYTC_URL =
  'https://services2.arcgis.com/CcI36Pduqd0OR4W9/ArcGIS/rest/services/trafficCamerasCur_Prd/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID%2Cname%2Cdescription%2Csnapshot%2Cstatus%2Clatitude%2Clongitude%2Ccounty&returnGeometry=false&f=pjson';
const LEXINGTON_URL =
  'https://services1.arcgis.com/Mg7DLdfYcSWIaDnu/ArcGIS/rest/services/Traffic_Camera_Locations_Public_view/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID%2Clocation%2Cstill_url&outSR=4326&f=pjson';

/** Kentucky bounding box — drops any stray/placeholder coordinates. */
const KY_BOUNDS = { minLat: 36.5, maxLat: 39.2, minLng: -89.6, maxLng: -82.0 };

function inBounds(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= KY_BOUNDS.minLat && lat <= KY_BOUNDS.maxLat &&
    lng >= KY_BOUNDS.minLng && lng <= KY_BOUNDS.maxLng
  );
}

/** One feature from trafficCamerasCur_Prd (only the fields we consume). */
export interface KytcFeature {
  attributes?: {
    OBJECTID?: number | null;
    name?: string | null;
    description?: string | null;
    snapshot?: string | null;
    status?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    county?: string | null;
  } | null;
}

/** Map one statewide-layer feature to a camera, or null. Exported for tests. */
export function mapKytcFeature(f: KytcFeature): CctvCamera | null {
  const a = f?.attributes;
  if (!a || typeof a.OBJECTID !== 'number') return null;
  if (a.status === 'Offline') return null;
  /* The cross-listed Indiana rows: no name, no county, no status, and
     snapshots that are dead (verified 404 / redirect-to-HTML). */
  if (!a.name && !a.county && !a.status) return null;

  const lat = a.latitude;
  const lng = a.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !inBounds(lat, lng)) return null;

  const snapshot = a.snapshot?.trim();
  if (!snapshot) return null;

  const county = a.county?.trim();
  return {
    id: `kytc-${a.OBJECTID}`,
    lat,
    lng,
    name: a.description?.trim() || a.name?.trim() || `KYTC Camera ${a.OBJECTID}`,
    city: county ? `${county} County` : 'Kentucky',
    country: 'US',
    feed_url: snapshot,
    source: 'KYTC',
  };
}

/** One feature from the Lexington layer (only the fields we consume). */
export interface LexingtonFeature {
  attributes?: {
    objectid?: number | null;
    location?: string | null;
    still_url?: string | null;
  } | null;
  geometry?: { x?: number | null; y?: number | null } | null;
}

/** Map one Lexington-layer feature to a camera, or null. Exported for tests. */
export function mapLexingtonFeature(f: LexingtonFeature): CctvCamera | null {
  const a = f?.attributes;
  if (!a || typeof a.objectid !== 'number') return null;

  const lat = f.geometry?.y;
  const lng = f.geometry?.x;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !inBounds(lat, lng)) return null;

  /* One row's still_url is a private-IP HTML viewer page, not an image.
     A feed here means a Wowza thumbnail address or a direct image file. */
  const still = a.still_url?.trim();
  if (!still || !(/thumbnail\?/i.test(still) || /\.(?:jpe?g|png)(\?|$)/i.test(still))) return null;

  return {
    id: `kytc-lex-${a.objectid}`,
    lat,
    lng,
    name: a.location?.trim() || `KYTC Camera ${a.objectid}`,
    city: 'Lexington',
    country: 'US',
    feed_url: still,
    source: 'KYTC',
  };
}

async function fetchFeatures<T>(url: string, label: string): Promise<T[]> {
  const res = await stealthFetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(`${label} ArcGIS error: ${data.error.message ?? 'unknown'}`);
  if (!Array.isArray(data?.features)) throw new Error(`${label} returned no features`);
  return data.features as T[];
}

async function loadKentuckyCameras(): Promise<CctvCamera[]> {
  const [kytc, lexington] = await Promise.all([
    fetchFeatures<KytcFeature>(KYTC_URL, 'KYTC'),
    fetchFeatures<LexingtonFeature>(LEXINGTON_URL, 'KYTC Lexington'),
  ]);

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const f of kytc) {
    const cam = mapKytcFeature(f);
    if (cam && !seen.has(cam.id)) { seen.add(cam.id); cams.push(cam); }
  }
  for (const f of lexington) {
    const cam = mapLexingtonFeature(f);
    if (cam && !seen.has(cam.id)) { seen.add(cam.id); cams.push(cam); }
  }

  console.log(`[OSIRIS] Kentucky cameras — KYTC: ${cams.length} of ${kytc.length + lexington.length}`);
  return cams;
}

export const fetchKentuckyCameras = cachedSource('kentucky', loadKentuckyCameras);
