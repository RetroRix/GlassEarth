import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import type { CctvCamera } from './types';

/**
 * OSIRIS — Seattle CCTV Cameras (SDOT, via the city's own Wowza edge)
 * List source: Traffic Cam Photobooth (GitHub, wttdotm/traffic_cam_photobooth)
 *   https://raw.githubusercontent.com/wttdotm/traffic_cam_photobooth/main/server_lists/sea_server.json
 * Streams: the City of Seattle's own Wowza StreamLock edge
 *   https://61e0c5d388c2e.streamlock.net:443/live/<camera>.stream/playlist.m3u8
 * ~154 cameras listed, ~117 live at probe time — NO API KEY NEEDED.
 *
 * SDOT publishes no machine-readable camera list of its own that we could
 * find, so the camera IDs come from the community-curated Photobooth list
 * (a public GitHub file of the city's published stream names). The streams
 * themselves are the city's: the list is only an index, nothing is scraped
 * from a page that forbids it.
 *
 * Seattle cameras have NO snapshot URL (the list carries stills for only a
 * handful of cameras, and the stills host is unreliable), so a dead stream
 * has nothing to fall back to — a dead tile would be a bare dot. The fetch
 * therefore PROBE-FILTERS: every listed playlist is fetched once per refresh
 * (concurrency 12, 10 s timeout each — the Wowza edge answers slowly through
 * a proxy, and a 4 s timeout verified 0 of 24 known-good playlists) and only
 * playlists that answer 200 with a real `#EXTM3U` body are wired. Probed
 * 2026-10-24: 117/154 resolve; the rest 404 (retired camera names). The probe
 * runs inside the 30-minute cached source, so it costs one pass per refresh,
 * not per visitor.
 */

const LIST_URL =
  'https://raw.githubusercontent.com/wttdotm/traffic_cam_photobooth/main/server_lists/sea_server.json';

export interface SeattleRecord {
  name?: string;
  liveCameraUrl?: string;
  stillCameraUrl?: string | null;
  /** The list publishes numeric latitude/longitude (some older snapshots used lat/lng). */
  latitude?: string | number;
  longitude?: string | number;
  lat?: string | number;
  lng?: string | number;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** True when the URL answers 200 with a real HLS playlist body. Exported for tests. */
export async function isLivePlaylist(url: string, fetchFn: FetchFn = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes('#EXTM3U');
  } catch {
    return false;
  }
}

/** Probe every listed playlist; returns the set of URLs that are actually live. */
async function probePlaylists(urls: string[], fetchFn: FetchFn = fetch): Promise<Set<string>> {
  const live = new Set<string>();
  const queue = [...new Set(urls)];
  const workers = Array.from({ length: 12 }, async () => {
    while (queue.length) {
      const url = queue.shift() as string;
      if (await isLivePlaylist(url, fetchFn)) live.add(url);
    }
  });
  await Promise.all(workers);
  return live;
}

/** Map one Seattle record to a camera, or null if unusable. Exported for tests. */
export function mapSeattleCamera(id: string, rec: SeattleRecord): CctvCamera | null {
  const latRaw = rec.latitude ?? rec.lat;
  const lngRaw = rec.longitude ?? rec.lng;
  const lat = typeof latRaw === 'number' ? latRaw : parseFloat(String(latRaw ?? ''));
  const lng = typeof lngRaw === 'number' ? lngRaw : parseFloat(String(lngRaw ?? ''));
  const stream = typeof rec.liveCameraUrl === 'string' ? rec.liveCameraUrl.trim() : '';
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 47.3 || lat > 47.9 || lng < -122.6 || lng > -122.1) return null;
  if (!stream.startsWith('https://') || !stream.endsWith('.m3u8')) return null;
  const still = typeof rec.stillCameraUrl === 'string' ? rec.stillCameraUrl.trim() : '';
  const cam: CctvCamera = {
    id: `seattle-${id}`,
    lat,
    lng,
    name: (rec.name ?? '').trim() || 'Seattle Camera',
    city: 'Seattle',
    country: 'US',
    source: 'SDOT',
    stream_url: stream,
    stream_type: 'hls',
  };
  // A still exists for only a handful of cameras; when there is none, leave
  // feed_url unset rather than pointing it at the .m3u8 — an <img> cannot
  // load a playlist, and the snapshot-fallback logic keys off feed_url.
  if (still) cam.feed_url = still;
  return cam;
}

async function loadSeattleCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(LIST_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Seattle list HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, SeattleRecord>;
  if (!json || typeof json !== 'object') throw new Error('Seattle list returned no camera map');

  const mapped: { id: string; rec: SeattleRecord; cam: CctvCamera }[] = [];
  for (const [id, rec] of Object.entries(json)) {
    const cam = mapSeattleCamera(id, rec);
    if (cam) mapped.push({ id, rec, cam });
  }
  // Seattle has no snapshot to fall back to, so only wire streams that answer.
  const live = await probePlaylists(mapped.map(m => m.cam.stream_url as string));
  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const m of mapped) {
    if (!live.has(m.cam.stream_url as string)) continue;
    if (seen.has(m.cam.id)) continue;
    seen.add(m.cam.id);
    cams.push(m.cam);
  }
  return cams;
}

export const fetchSeattleCameras = cachedSource('seattle', loadSeattleCameras);
