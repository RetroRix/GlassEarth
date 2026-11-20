import type { CctvCamera } from './types';

/**
 * OSIRIS — Croatia's road cameras (HAK, the Croatian Automobile Club)
 *
 * HAK's camera wall lists 482 cameras — motorways A1–A11, the D8 Adriatic
 * road, border crossings, ferry ports — but the wall itself publishes no
 * coordinates, and its two machine-readable pieces split the facts:
 *
 *   https://www.hak.hr/info/kamere/manifest/svi.json
 *     every camera's id, its current picture and when that picture was
 *     taken (lastImageAtUtc) — the liveness signal;
 *   https://api.livetrafik.com/api/v1/cameras?country=hr
 *     the same cameras with names and WGS84 points, keyed by the same
 *     HAK picture link (its names match the wall's own camera names —
 *     481 of 482 identical on 2026-11-20, the last differing only by
 *     HTML entity encoding).
 *
 * A camera is mapped only when all three agree: the directory places it
 * in Croatia, HAK's manifest carries it, and its last picture is under a
 * day old. The pictures are HAK's own and load straight from hak.hr,
 * which serves them to any page.
 */

const MANIFEST = 'https://www.hak.hr/info/kamere/manifest/svi.json';
const DIRECTORY = 'https://api.livetrafik.com/api/v1/cameras';
const PER_PAGE = 100;
/** A camera whose newest picture is older than this is not shown as live. */
const MAX_IMAGE_AGE_MS = 24 * 60 * 60 * 1000;
/** Croatia; a row outside it is mis-geocoded. */
const BOUNDS = { minLat: 42.3, maxLat: 46.6, minLng: 13.4, maxLng: 19.5 };
const IMAGE = /^https:\/\/www\.hak\.hr\/info\/kamere\/(\d+)\.jpg$/;

/** One camera as the directory lists it (only the fields we read). */
export interface CroatiaCameraRow {
  name?: string | null;
  latitude?: number;
  longitude?: number;
  image_url?: string | null;
}

/** One camera as HAK's manifest lists it (only the fields we read). */
export interface HakManifestEntry {
  id?: string;
  lastImageAtUtc?: string;
}

interface DirectoryPage {
  cameras?: CroatiaCameraRow[];
  meta?: { total_pages?: number };
}

/** The HAK camera id in a picture link, or null when it is not one of HAK's. */
export function hakCameraId(imageUrl: string | null | undefined): string | null {
  return imageUrl ? IMAGE.exec(imageUrl)?.[1] ?? null : null;
}

/** Ids whose newest picture is fresh enough to call the camera live. */
export function freshCameraIds(entries: HakManifestEntry[], nowMs: number): Set<string> {
  const fresh = new Set<string>();
  for (const e of entries ?? []) {
    if (!e?.id) continue;
    const taken = Date.parse(e.lastImageAtUtc ?? '');
    if (Number.isFinite(taken) && taken <= nowMs + 5 * 60 * 1000 && nowMs - taken <= MAX_IMAGE_AGE_MS) {
      fresh.add(String(e.id));
    }
  }
  return fresh;
}

/** Map one directory row to a camera, or null when HAK does not vouch for it as live. */
export function mapCroatiaCamera(row: CroatiaCameraRow, fresh: ReadonlySet<string>): CctvCamera | null {
  const hakId = hakCameraId(row?.image_url);
  const { latitude: lat, longitude: lng } = row ?? {};
  if (!hakId || !fresh.has(hakId)) return null;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return null;
  return {
    id: `hr-${hakId}`,
    lat,
    lng,
    name: row.name?.trim() || 'HAK camera',
    city: 'Croatia',
    country: 'Croatia',
    feed_url: `https://www.hak.hr/info/kamere/${hakId}.jpg`,
    source: 'HAK Croatia',
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchCroatiaCameras(): Promise<CctvCamera[]> {
  const [manifest, first] = await Promise.all([
    fetchJson<{ cameras?: HakManifestEntry[] }>(MANIFEST),
    fetchJson<DirectoryPage>(`${DIRECTORY}?country=hr&per_page=${PER_PAGE}&page=1`),
  ]);
  const fresh = freshCameraIds(manifest.cameras ?? [], Date.now());
  if (!fresh.size) throw new Error('HAK manifest lists no fresh cameras');

  const pages = Math.max(1, Math.min(first.meta?.total_pages ?? 1, 12));
  const rows: CroatiaCameraRow[] = [...(first.cameras ?? [])];
  for (let page = 2; page <= pages; page++) {
    const next = await fetchJson<DirectoryPage>(`${DIRECTORY}?country=hr&per_page=${PER_PAGE}&page=${page}`);
    rows.push(...(next.cameras ?? []));
  }

  const byId = new Map<string, CctvCamera>();
  for (const row of rows) {
    const cam = mapCroatiaCamera(row, fresh);
    if (cam) byId.set(cam.id, cam);
  }
  if (!byId.size) throw new Error('Croatia camera directory returned no usable cameras');
  console.log(`[OSIRIS] Croatia cameras — HAK via livetrafik directory: ${byId.size} of ${rows.length} listed, ${fresh.size} fresh in HAK's manifest`);
  return [...byId.values()];
}
