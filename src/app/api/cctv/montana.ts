import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Montana CCTV Cameras (MDT / 511mt.net)
 * Source: https://mt.cdn.iteris-atis.com — the Iteris ClearRoute CDN that
 * MDT's own 511 map loads its camera layers from
 * ~135 camera sites statewide — NO API KEY NEEDED.
 *
 * Montana does not run the IBI 511 stack (its /List/GetData/Cameras is a
 * 404). The 511MT site is Iteris SafeTravel, and its map reads two static
 * GeoJSON indexes off the MDT CDN: `icons.cameras.geojson` (traffic and
 * neighbouring-state cameras MDT republishes) and `icons.rwis.geojson`
 * (the 100+ Road Weather Information System sites, each with up to four
 * directional views). Both are merged here the way the site's own
 * getCamerasAndRwis merges them. One camera is emitted per *site*, using
 * its first view's frame.
 *
 * The cameras file deliberately includes border crossings — Wyoming,
 * Idaho and Canadian passes — so the state bounding box does real work:
 * only 17 of its 38 sites fall inside it. Every RWIS site does.
 */

const CAMERAS_GEOJSON = 'https://mt.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson';
const RWIS_GEOJSON = 'https://mt.cdn.iteris-atis.com/geojson/icons/metadata/icons.rwis.geojson';

/** Montana bounding box — drops the neighbouring-state cameras MDT republishes. */
const MT_BOUNDS = { minLat: 44.3, maxLat: 49.0, minLng: -116.1, maxLng: -104.0 };

/** One view of a camera site. */
export interface MdtCameraView {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  image?: string | null;
}

/** One site from either Iteris GeoJSON index (only the fields we consume). */
export interface MdtFeature {
  id?: string | null;
  geometry?: { coordinates?: [number, number] | null } | null;
  properties?: {
    id?: string | null;
    name?: string | null;
    description?: string | null;
    route?: string | null;
    cameras?: MdtCameraView[] | null;
  } | null;
}

/** Map one Iteris feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(feature: MdtFeature): CctvCamera | null {
  const props = feature?.properties;
  const siteId = feature?.id ?? props?.id;
  if (siteId == null || String(siteId).trim() === '') return null;

  const view = props?.cameras?.find(v => v?.image?.trim());
  if (!view?.image) return null;

  const coords = feature.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < MT_BOUNDS.minLat || lat > MT_BOUNDS.maxLat) return null;
  if (lng < MT_BOUNDS.minLng || lng > MT_BOUNDS.maxLng) return null;

  /* The two files label a site differently. The cameras file leaves `name`
     empty and puts the whole label in `description` ("Glacier National Park
     West Entrance"); an RWIS site splits it — `name` is the place ("Savage")
     and `description` the road position ("MT-16 MP 29.5") — so the label is
     whichever parts exist, joined once. */
  const parts = [props?.name, props?.description]
    .map(v => v?.trim())
    .filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
  const name = parts.join(' — ') || view.name?.trim() || view.description?.trim() || `MDT Camera ${siteId}`;

  return {
    id: `mdt-${siteId}`,
    lat,
    lng,
    name,
    city: 'Montana',
    country: 'US',
    feed_url: view.image,
    source: 'MDT',
  };
}

async function fetchGeoJson(url: string): Promise<MdtFeature[]> {
  const res = await stealthFetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`MDT HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.features)) throw new Error('MDT returned no features');
  return data.features;
}

async function loadMontanaCameras(): Promise<CctvCamera[]> {
  const [cameraSites, rwisSites] = await Promise.all([
    fetchGeoJson(CAMERAS_GEOJSON),
    fetchGeoJson(RWIS_GEOJSON),
  ]);

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const feature of [...cameraSites, ...rwisSites]) {
    const cam = mapFeature(feature);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Montana cameras — MDT: ${cams.length}`);
  return cams;
}

export const fetchMontanaCameras = cachedSource('montana', loadMontanaCameras);
