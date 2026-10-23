import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Mississippi CCTV Cameras (MDOT / mdottraffic.com)
 * Source: https://www.mdottraffic.com/default.aspx/LoadCameraData — the
 * ASP.NET page method the MDOTtraffic map itself POSTs to
 * 458 camera sites statewide, each with 1–6 views — NO API KEY NEEDED.
 *
 * The page method returns site markers only: a name and a position, no
 * image. Each site's own bubble page (`mapbubbles/camerasite.aspx?site=N`)
 * lists its views as JavaScript calls carrying the three things a camera
 * needs — a Wowza thumbnail URL, the stream id, and the view's label
 * ("I-55 N at Lakeland Dr PTZ") — so the loader reads one small page per
 * site. No session cookie is wanted here: sharing one serialises the
 * requests behind ASP.NET's session lock and the fan-out crawls.
 *
 * The live playlist is derived, not scraped: a view's thumbnail lives on
 * `streaming*.mdottraffic.com/thumbnail?application=rtplive&streamname=
 * {id}.stream`, and the same host serves the stream at
 * `/rtplive/{id}.stream/playlist.m3u8`. Both were verified live (a real
 * 352×240 JPEG and a real master playlist, on a numeric Jackson stream and
 * on a D6-* Gulf stream alike).
 *
 * A short read throws, like the IBI loader: if a burst of site pages fails,
 * caching the survivors would quietly shrink the state for half an hour.
 */

const BASE = 'https://www.mdottraffic.com';
const SITES_URL = `${BASE}/default.aspx/LoadCameraData`;

/** Mississippi bounding box — drops any stray/placeholder coordinates. */
const MS_BOUNDS = { minLat: 30.1, maxLat: 35.0, minLng: -91.7, maxLng: -88.1 };

/** Site pages fetched at once. The host answers in ~1s and tolerates this
    comfortably; more only bought throttling. */
const CONCURRENCY = 12;

/** One site marker from LoadCameraData's `d` array. */
export interface MdotSite {
  markerid?: string | null;
  tooltip?: string | null;
  lat?: number | null;
  lon?: number | null;
}

/** One camera view parsed out of a site's bubble page. */
export interface MdotView {
  thumbnailUrl: string;
  streamId: string;
  label: string;
}

/**
 * The views on a camerasite page are handed to its switcher as
 * `('thumbnail-url', 'streamId', 'Label', …)` calls — the first three
 * arguments are the camera. Exported for tests.
 */
export function parseSiteViews(html: string): MdotView[] {
  const views: MdotView[] = [];
  const seen = new Set<string>();
  const re = /\('(https:\/\/streaming[^']+)',\s*'([^']+)',\s*'([^']+)'/g;
  for (const m of html.matchAll(re)) {
    const [, thumbnailUrl, streamId, label] = m;
    if (seen.has(streamId)) continue;
    seen.add(streamId);
    views.push({ thumbnailUrl, streamId, label });
  }
  return views;
}

/** The HLS playlist for a view's thumbnail address, or null if it is not a
    Wowza thumbnail on an MDOT streaming host. Exported for tests. */
export function hlsUrlFor(thumbnailUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(thumbnailUrl);
  } catch {
    return null;
  }
  if (!u.hostname.endsWith('.mdottraffic.com')) return null;
  const streamname = u.searchParams.get('streamname');
  if (!streamname) return null;
  return `https://${u.hostname}/rtplive/${streamname}/playlist.m3u8`;
}

/** Map one site + view to a camera, or null if unusable. Exported for tests. */
export function mapCamera(site: MdotSite, view: MdotView): CctvCamera | null {
  const lat = site?.lat;
  const lng = site?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < MS_BOUNDS.minLat || lat > MS_BOUNDS.maxLat) return null;
  if (lng < MS_BOUNDS.minLng || lng > MS_BOUNDS.maxLng) return null;

  const video = hlsUrlFor(view.thumbnailUrl);
  if (!video) return null;

  return {
    id: `mdot-${view.streamId}`,
    lat,
    lng,
    name: view.label.trim() || site.tooltip?.trim() || `MDOT Camera ${view.streamId}`,
    city: 'Mississippi',
    country: 'US',
    feed_url: view.thumbnailUrl,
    stream_url: video,
    stream_type: 'hls',
    source: 'MDOT',
  };
}

async function fetchSites(): Promise<MdotSite[]> {
  const res = await stealthFetch(SITES_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`MDOT HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.d)) throw new Error('MDOT returned no site markers');
  return data.d as MdotSite[];
}

async function fetchSiteViews(siteId: string): Promise<MdotView[]> {
  const res = await stealthFetch(`${BASE}/mapbubbles/camerasite.aspx?site=${siteId}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`MDOT site ${siteId} HTTP ${res.status}`);
  return parseSiteViews(await res.text());
}

async function loadMississippiCameras(): Promise<CctvCamera[]> {
  const sites = (await fetchSites()).filter(s => {
    const id = s.markerid?.match(/^camsite_(\d+)$/)?.[1];
    return id && typeof s.lat === 'number' && typeof s.lon === 'number' &&
      s.lat >= MS_BOUNDS.minLat && s.lat <= MS_BOUNDS.maxLat &&
      s.lon >= MS_BOUNDS.minLng && s.lon <= MS_BOUNDS.maxLng;
  });

  const cams = new Map<string, CctvCamera>();
  let parsedSites = 0;

  const ingest = async (batch: MdotSite[]): Promise<MdotSite[]> => {
    const results = await Promise.allSettled(
      batch.map(s => fetchSiteViews(s.markerid!.split('_')[1])),
    );
    const failed: MdotSite[] = [];
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') { failed.push(batch[i]); return; }
      parsedSites++;
      for (const view of r.value) {
        const cam = mapCamera(batch[i], view);
        if (cam) cams.set(cam.id, cam);
      }
    });
    return failed;
  };

  let failed: MdotSite[] = [];
  for (let i = 0; i < sites.length; i += CONCURRENCY) {
    failed.push(...await ingest(sites.slice(i, i + CONCURRENCY)));
  }
  // One more go at whatever dropped, a page at a time in the same batches.
  if (failed.length) {
    const retry = failed;
    failed = [];
    for (let i = 0; i < retry.length; i += CONCURRENCY) {
      failed.push(...await ingest(retry.slice(i, i + CONCURRENCY)));
    }
  }

  /* A short read is a failed refresh, not a smaller state (see ibi511). */
  if (sites.length > 0 && parsedSites < sites.length * 0.9) {
    throw new Error(`MDOT short read: ${parsedSites} of ${sites.length} sites`);
  }

  const list = [...cams.values()];
  console.log(`[OSIRIS] Mississippi cameras — MDOT: ${list.length} from ${parsedSites} sites`);
  return list;
}

export const fetchMississippiCameras = cachedSource('mississippi', loadMississippiCameras);
