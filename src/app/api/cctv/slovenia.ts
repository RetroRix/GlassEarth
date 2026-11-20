import { proxiedImageUrl, type CctvCamera } from './types';

/**
 * OSIRIS — Slovenia's road cameras (DARS / DRSI, via the NAP catalogue)
 *
 * Slovenia's National Access Point publishes the national road-camera
 * catalogue — the DARS motorway cameras and the DRSI state-road cameras,
 * about 425 of them — as a free dataset under CC BY-SA 4.0. The NAP's own
 * B2B GeoRSS endpoint is credential-gated and promet.si drops datacenter
 * connections outright, so the catalogue is read here through the public
 * API of livetrafik.com, a directory that republishes the NAP catalogue
 * unchanged:
 *
 *   https://api.livetrafik.com/api/v1/cameras?country=si&per_page=100&page=N
 *
 * The pictures themselves are DARS's own, served from kamere.dars.si.
 * That host closes the connection on non-browser TLS fingerprints before
 * any HTTP is exchanged (measured 2026-11-20: curl and Node fetch both get
 * an empty reply), so the pictures are loaded through the app's image
 * proxy, which is also how this app serves every host that will not talk
 * to a browser page directly.
 *
 * Data: DARS / DRSI via the Slovenian National Access Point, CC BY-SA 4.0.
 */

const API = 'https://api.livetrafik.com/api/v1/cameras';
const PER_PAGE = 100;
/** Slovenia; a row outside it is mis-geocoded. */
const BOUNDS = { minLat: 45.4, maxLat: 47.0, minLng: 13.3, maxLng: 16.7 };
const IMAGE_ORIGIN = 'https://kamere.dars.si';

/** One camera as the NAP-catalogue API lists it (only the fields we read). */
export interface SloveniaCameraRow {
  id?: number;
  name?: string | null;
  latitude?: number;
  longitude?: number;
  image_url?: string | null;
  region_name?: string | null;
}

interface CameraPage {
  cameras?: SloveniaCameraRow[];
  meta?: { total_pages?: number };
}

/** A snapshot link, only when it is a JPEG under kamere.dars.si/kamere. */
function pictureLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== IMAGE_ORIGIN || url.username || url.password) return null;
  return url.pathname.startsWith('/kamere/') && /\.jpe?g$/i.test(url.pathname) ? url.href : null;
}

/** Map one catalogue row to a camera, or null when it has no place in Slovenia or no DARS picture. */
export function mapSloveniaCamera(row: SloveniaCameraRow): CctvCamera | null {
  const id = row?.id;
  const { latitude: lat, longitude: lng } = row ?? {};
  if (!Number.isInteger(id) || typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return null;
  const image = pictureLink(row.image_url);
  if (!image) return null;
  return {
    id: `si-${id}`,
    lat,
    lng,
    name: row.name?.trim() || 'DARS camera',
    city: row.region_name?.trim() || 'Slovenia',
    country: 'Slovenia',
    feed_url: proxiedImageUrl(image),
    source: 'DARS Slovenia',
  };
}

async function fetchPage(page: number): Promise<CameraPage> {
  const res = await fetch(`${API}?country=si&per_page=${PER_PAGE}&page=${page}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Slovenia camera catalogue HTTP ${res.status}`);
  return (await res.json()) as CameraPage;
}

export async function fetchSloveniaCameras(): Promise<CctvCamera[]> {
  const first = await fetchPage(1);
  const pages = Math.max(1, Math.min(first.meta?.total_pages ?? 1, 12));
  const rows: SloveniaCameraRow[] = [...(first.cameras ?? [])];
  for (let page = 2; page <= pages; page++) {
    const next = await fetchPage(page);
    rows.push(...(next.cameras ?? []));
  }

  const byId = new Map<string, CctvCamera>();
  for (const row of rows) {
    const cam = mapSloveniaCamera(row);
    if (cam) byId.set(cam.id, cam);
  }
  if (!byId.size) throw new Error('Slovenia camera catalogue returned no usable cameras');
  console.log(`[OSIRIS] Slovenia cameras — NAP catalogue via livetrafik: ${byId.size} of ${rows.length} listed`);
  return [...byId.values()];
}
