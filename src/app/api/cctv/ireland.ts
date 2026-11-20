import type { CctvCamera } from './types';

/**
 * OSIRIS — Ireland's road cameras (Transport Infrastructure Ireland)
 *
 * TII's traffic map reads its cameras from one keyless GraphQL query
 * (operation MapFeatures, layer "normalCameras") over the whole island at
 * once: about 245 cameras on the motorway and national-road network, each
 * with a point, a place name and a snapshot picture on
 * irecam.carsprogram.org:
 *
 *   POST https://traffic.tii.ie/api/graphql
 *
 * A camera the feed marks inactive is left out. The pictures load straight
 * from irecam, which serves them to any page.
 *
 * Data: Transport Infrastructure Ireland, CC BY 4.0. Ported from the OSIRIS
 * upstream ireland.ts (MIT), restyled to this repo's source conventions.
 */

const UA = 'OSIRIS/5.0 (+https://osirisai.live)';
const ENDPOINT = 'https://traffic.tii.ie/api/graphql';
/** The island of Ireland; a row outside it is mis-geocoded. */
const BOUNDS = { minLat: 51.2, maxLat: 55.5, minLng: -10.8, maxLng: -5.8 };
const IMAGE_ORIGIN = 'https://irecam.carsprogram.org';

/* National bbox + high zoom so the server returns individual cameras, not clusters. */
const QUERY = {
  query:
    'query MapFeatures($input: MapFeaturesArgs!) { mapFeaturesQuery(input: $input) ' +
    '{ mapFeatures { uri title __typename features { geometry } ' +
    '... on Camera { active views(limit: 5) { category ... on CameraView { url } } } } }',
  variables: {
    input: { north: 55.5, south: 51.3, east: -5.9, west: -10.7, zoom: 18, layerSlugs: ['normalCameras'] },
  },
};

/** One feature from TII's MapFeatures answer (only the fields we read). */
export interface TiiFeature {
  __typename?: string | null;
  active?: boolean | null;
  uri?: string | null;
  title?: string | null;
  features?: { geometry?: { coordinates?: unknown } | null }[] | null;
  views?: { category?: string | null; url?: string | null }[] | null;
}

/** A snapshot link, only when it is a JPEG on TII's camera host. */
function pictureLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== IMAGE_ORIGIN || url.username || url.password) return null;
  return /\.jpe?g$/i.test(url.pathname) ? url.href : null;
}

/** Map one TII feature to a camera, or null when it is not an active camera with a place and a picture. */
export function mapTiiCamera(f: TiiFeature): CctvCamera | null {
  if (!f || f.__typename !== 'Camera' || f.active === false) return null;
  const coords = f.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return null;

  const image = (f.views ?? []).map(v => (v?.category === 'IMAGE' ? pictureLink(v.url) : null)).find(Boolean);
  if (!image) return null;

  const id = String(f.uri || `${lat},${lng}`);
  return {
    id: `ie-${id.replace(/\//g, '-')}`,
    lat,
    lng,
    name: f.title?.trim() || 'TII camera',
    city: 'Ireland',
    country: 'Ireland',
    feed_url: image,
    source: 'TII Ireland',
  };
}

export async function fetchIrelandCameras(): Promise<CctvCamera[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(QUERY),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`TII GraphQL HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { mapFeaturesQuery?: { mapFeatures?: TiiFeature[] } } } | null;
  const list = data?.data?.mapFeaturesQuery?.mapFeatures;
  if (!Array.isArray(list)) throw new Error('TII GraphQL returned no map features');

  const byId = new Map<string, CctvCamera>();
  for (const f of list) {
    const cam = mapTiiCamera(f);
    if (cam) byId.set(cam.id, cam);
  }
  if (!byId.size) throw new Error('TII GraphQL returned no usable cameras');
  console.log(`[OSIRIS] Ireland cameras — TII: ${byId.size} of ${list.length} features`);
  return [...byId.values()];
}
