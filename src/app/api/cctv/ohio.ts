import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Ohio CCTV Cameras (ODOT / ohgo.com)
 * Source: https://api.ohgo.com/cameras — the JSON OHGO's own map loads
 * ~1,150 camera sites statewide — NO API KEY NEEDED.
 *
 * Ohio is not on the IBI 511 stack either: ohgo.com's /List/GetData/Cameras
 * redirects to its 404 page. Nor is the documented OHGO *public* API usable
 * here — publicapi.ohgo.com answers 401 without a registered API key. What
 * works keyless is the endpoint the website itself calls: its pin service
 * prefixes relative paths with the MobileApiUrl from the page config
 * (https://api.ohgo.com), so the map's camera layer is a single GET of
 * /cameras returning every site with coordinates and snapshot URLs —
 * ODOT's own on itscameras.dot.state.oh.us, plus the KYTC bridge cameras
 * (the `422_CCTV09002`-style ids) served from Louisville's TRIMARC.
 *
 * A handful of sites sit just over the state line (an Indiana I-275 view
 * among them); the bounding box drops those.
 */

const CAMERAS_URL = 'https://api.ohgo.com/cameras';

/** Ohio bounding box — drops the border sites ODOT republishes. */
const OH_BOUNDS = { minLat: 38.4, maxLat: 41.98, minLng: -84.8, maxLng: -80.5 };

/** One camera site from api.ohgo.com/cameras (only the fields we consume). */
export interface OhgoRecord {
  Id?: string | null;
  Latitude?: number | null;
  Longitude?: number | null;
  Location?: string | null;
  Category?: string | null;
  Description?: string | null;
  Provider?: string | null;
  Cameras?: Array<{
    Direction?: string | null;
    SmallURL?: string | null;
    LargeURL?: string | null;
  }> | null;
}

/** Map one OHGO record to a camera, or null if unusable. Exported for tests. */
export function mapRecord(rec: OhgoRecord): CctvCamera | null {
  const id = rec?.Id?.trim();
  if (!id) return null;

  const lat = rec.Latitude;
  const lng = rec.Longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat! < OH_BOUNDS.minLat || lat! > OH_BOUNDS.maxLat) return null;
  if (lng! < OH_BOUNDS.minLng || lng! > OH_BOUNDS.maxLng) return null;

  /* Nearly every site has one view; the few multi-view sites list their
     views in display order, so the first usable frame is the site's frame. */
  const view = rec.Cameras?.find(v => v?.SmallURL?.trim() || v?.LargeURL?.trim());
  const feed = view?.SmallURL?.trim() || view?.LargeURL?.trim();
  if (!feed) return null;

  const name = rec.Location?.trim() || rec.Description?.trim() || `ODOT Camera ${id}`;

  return {
    id: `ohdot-${id}`,
    lat: lat!,
    lng: lng!,
    name,
    city: 'Ohio',
    country: 'US',
    feed_url: feed,
    source: 'ODOT',
  };
}

async function loadOhioCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(CAMERAS_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`OHGO HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('OHGO returned a non-array payload');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const rec of data) {
    const cam = mapRecord(rec);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Ohio cameras — ODOT: ${cams.length}`);
  return cams;
}

export const fetchOhioCameras = cachedSource('ohio', loadOhioCameras);
