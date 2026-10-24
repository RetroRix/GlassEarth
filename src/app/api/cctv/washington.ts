import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import type { CctvCamera } from './types';

/**
 * OSIRIS — Washington State CCTV Cameras (WSDOT)
 * Source: WSDOT ArcGIS FeatureServer (TravelInfoCamerasWeather, layer 0)
 *   https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0/query
 * ~1,706 cameras statewide — NO API KEY NEEDED.
 *
 * The old source — https://data.wsdot.wa.gov/log/public/cameras.json — went
 * away (HTTP 404 since at least 2026-10-24), which silently emptied Washington
 * from the catalog. This is the replacement: the same agency's own
 * FeatureServer, one page (maxRecordCount 2,000 > the ~1,706 rows).
 *
 * Snapshot-only: WSDOT's own Traveler Information API docs say it
 * "currently only supports snap shots (not full video)". The layer does
 * publish geometry in Web Mercator (EPSG:3857), converted here to WGS84.
 * Rows whose image lives on another operator's host (a few Oregon TripCheck
 * stills ride along in this layer) are dropped — Oregon has its own fetcher
 * and the map must not show the same camera twice.
 */

const FEATURE_SERVER =
  'https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0/query';

/** Web Mercator (EPSG:3857) metres → WGS84 degrees. */
export function webMercatorToWgs84(x: number, y: number): { lat: number; lng: number } {
  const R = 20037508.34;
  const lng = (x * 180) / R;
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((y * Math.PI) / R)) - Math.PI / 2);
  return { lat, lng };
}

export interface WsdotFeature {
  attributes?: {
    OBJECTID?: number;
    CameraTitle?: string;
    ImageURL?: string;
    CompassDirection?: string;
  };
  geometry?: { x?: number; y?: number };
}

/** Map one WSDOT feature to a camera, or null if unusable. Exported for tests. */
export function mapWsdotFeature(feature: WsdotFeature): CctvCamera | null {
  const a = feature?.attributes ?? {};
  const g = feature?.geometry ?? {};
  const x = typeof g.x === 'number' ? g.x : NaN;
  const y = typeof g.y === 'number' ? g.y : NaN;
  const feed = typeof a.ImageURL === 'string' ? a.ImageURL.trim() : '';
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // WSDOT's own stills only — a few Oregon TripCheck images ride in this layer.
  if (!/^https?:\/\/images\.wsdot\.wa\.gov\//i.test(feed)) return null;
  const { lat, lng } = webMercatorToWgs84(x, y);
  if (lat < 45.5 || lat > 49.1 || lng < -124.9 || lng > -116.8) return null;
  if (a.OBJECTID == null) return null;
  const name = (a.CameraTitle ?? '').trim() || 'WSDOT Camera';
  return {
    id: `wsdot-${a.OBJECTID}`,
    lat,
    lng,
    name,
    city: 'Washington',
    country: 'US',
    feed_url: feed,
    source: 'WSDOT',
  };
}

async function loadWSDOTCameras(): Promise<CctvCamera[]> {
  const url =
    `${FEATURE_SERVER}?where=1%3D1&outFields=OBJECTID,CameraTitle,ImageURL,CompassDirection` +
    `&returnGeometry=true&outSR=3857&f=json&resultRecordCount=2000`;
  const res = await stealthFetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`WSDOT HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.features)) throw new Error('WSDOT returned no feature array');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const feature of json.features as WsdotFeature[]) {
    const cam = mapWsdotFeature(feature);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }
  return cams;
}

export const fetchWSDOTCameras = cachedSource('wsdot', loadWSDOTCameras);
