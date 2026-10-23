import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Illinois CCTV Cameras (IDOT / Getting Around Illinois)
 * Source: https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/
 *   TrafficCamerasTM_Public/FeatureServer/0 — the camera layer of IDOT's own
 *   Traveler Info web map on gettingaroundillinois.com
 * ~3,750 camera views statewide — NO API KEY NEEDED.
 *
 * The old source for this state is dead in a quieter way than a 404:
 * travelmidwest.com/lmiga/cameraReport.json now answers 200 with
 * {updatedMessage, noDataMessage} and no cameras unless a `path` is given,
 * and even Travel Midwest's current map API carries only Lake and Kane
 * County cameras — IDOT's own inventory has left the LMIGA feeds. IDOT
 * still publishes the whole gateway inventory itself, as the ArcGIS layer
 * its Getting Around Illinois map draws: one feature per directional view,
 * each with a live snapshot on cctv.travelmidwest.com (the rows' own
 * AgeInMinutes ran 1–25 minutes when this was written).
 *
 * The layer caps a response at 1,000 rows, so the loader pages by OBJECTID
 * until `exceededTransferLimit` clears.
 */

const QUERY_URL =
  'https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0/query';
const PAGE_SIZE = 1000; // the layer's maxRecordCount
const MAX_PAGES = 10; // safety bound (~10,000 views) so a bad flag can't fan out forever

/** Illinois bounding box — every published row already falls inside it. */
const IL_BOUNDS = { minLat: 36.9, maxLat: 42.5, minLng: -91.6, maxLng: -87.5 };

/** One feature from TrafficCamerasTM_Public (only the fields we consume). */
export interface IdotFeature {
  attributes?: {
    OBJECTID?: number | null;
    ImgPath?: string | null;
    CameraLocation?: string | null;
    CameraDirection?: string | null;
    y?: number | null;
    x?: number | null;
    SnapShot?: string | null;
    WarningAge?: string | null;
    TooOld?: string | null;
    AgeInMinutes?: string | null;
  } | null;
  geometry?: { x?: number | null; y?: number | null } | null;
}

/** Map one feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(feature: IdotFeature): CctvCamera | null {
  const a = feature?.attributes;
  if (!a || typeof a.OBJECTID !== 'number') return null;

  const snapshot = a.SnapShot?.trim();
  if (!snapshot) return null;

  const lat = feature.geometry?.y ?? a.y;
  const lng = feature.geometry?.x ?? a.x;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat! < IL_BOUNDS.minLat || lat! > IL_BOUNDS.maxLat) return null;
  if (lng! < IL_BOUNDS.minLng || lng! > IL_BOUNDS.maxLng) return null;

  const viewer = a.ImgPath?.trim();

  return {
    id: `idot-${a.OBJECTID}`,
    lat: lat!,
    lng: lng!,
    name: a.CameraLocation?.trim() || `IDOT Camera ${a.OBJECTID}`,
    city: 'Illinois',
    country: 'US',
    feed_url: snapshot,
    ...(viewer ? { external_url: viewer } : {}),
    source: 'IDOT',
  };
}

async function fetchPage(offset: number): Promise<{ rows: IdotFeature[]; more: boolean }> {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: 'OBJECTID',
  });
  const res = await stealthFetch(`${QUERY_URL}?${params}`, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`IDOT ArcGIS HTTP ${res.status}`);
  const data = await res.json();
  /* ArcGIS reports a bad query as an `error` object on a 200, not a status. */
  if (data?.error) throw new Error(`IDOT ArcGIS error: ${data.error.message ?? 'unknown'}`);
  if (!Array.isArray(data?.features)) throw new Error('IDOT ArcGIS returned no features');
  return { rows: data.features, more: data.exceededTransferLimit === true };
}

async function loadIllinoisCameras(): Promise<CctvCamera[]> {
  const cams: CctvCamera[] = [];
  const seen = new Set<string>();

  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows, more } = await fetchPage(offset);
    for (const feature of rows) {
      const cam = mapFeature(feature);
      if (!cam || seen.has(cam.id)) continue;
      seen.add(cam.id);
      cams.push(cam);
    }
    if (!more || rows.length === 0) break;
    offset += rows.length;
  }

  console.log(`[OSIRIS] Illinois cameras — IDOT: ${cams.length}`);
  return cams;
}

export const fetchIllinoisCameras = cachedSource('illinois', loadIllinoisCameras);
