/**
 * OSIRIS — satellite date comparison ("Recent Imagery"): NASA's
 * Harmonized Landsat/Sentinel-2 (HLS) daily surface reflectance, served
 * keyless by NASA GIBS (WMTS, EPSG:3857), as an A/B swipe — pick two
 * dates inside the last 30 days and drag a divider across the map to see
 * the ground change (a storm's damage, a fire scar, a flood, a shoreline
 * moving, new construction).
 *
 * Verified live against GIBS on 2026-10-27 (capabilities + tiles):
 *   HLS_S30_Nadir_BRDF_Adjusted_Reflectance — Sentinel-2, preferred.
 *   HLS_L30_Nadir_BRDF_Adjusted_Reflectance — Landsat 8/9, the fill.
 * Both are image/png on GoogleMapsCompatible_Level12 (native zoom ≤ 12,
 * 30 m pixels), TIME is a plain YYYY-MM-DD date, and the newest published
 * date trails today by ~2 days (the capabilities <Default>).
 *
 * Honesty rules — the same pattern as the weather timeline, and the
 * reason the probing below exists:
 *   · HLS does NOT image every place every day. Orbit swaths leave gaps,
 *     and GIBS answers a no-pass tile request with HTTP 200 and a fully
 *     transparent PNG — the status code never tells you. What does tell
 *     you is the `layer-time-actual` response header (GIBS exposes it to
 *     CORS readers): present ⇔ that tile really carries that date's
 *     imagery. A date is "available for this view" when any sampled tile
 *     in the view carries it.
 *   · When the picked date has no pass over the view, the side snaps to
 *     the NEAREST date that does (walked day by day, earlier date wins a
 *     tie), Sentinel-2 first, Landsat as the fill — and the UI labels the
 *     ACTUAL date and sensor shown. Imagery is never presented under a
 *     date it was not taken on.
 *   · If nothing in the 30-day window covers the view, the side says so
 *     and shows no imagery at all.
 */

export type DcSensor = 's30' | 'l30';

export interface DcSensorDef {
  key: DcSensor;
  /** GIBS WMTS layer id. */
  layer: string;
  /** The name the UI labels the imagery with. */
  label: string;
  attribution: string;
}

export const DC_SENSORS: Record<DcSensor, DcSensorDef> = {
  s30: {
    key: 's30',
    layer: 'HLS_S30_Nadir_BRDF_Adjusted_Reflectance',
    label: 'Sentinel-2',
    attribution: 'Imagery © NASA HLS Sentinel-2 via GIBS',
  },
  l30: {
    key: 'l30',
    layer: 'HLS_L30_Nadir_BRDF_Adjusted_Reflectance',
    label: 'Landsat',
    attribution: 'Imagery © NASA HLS Landsat via GIBS',
  },
};

/** Preferred first: Sentinel-2's denser revisit, Landsat as the fill. */
export const DC_SENSOR_ORDER: DcSensor[] = ['s30', 'l30'];

/** The comparison window: the last 30 days of published imagery. */
export const DC_WINDOW_DAYS = 30;
/** GoogleMapsCompatible_Level12 — the layers' native ceiling. */
export const DC_TILE_ZOOM = 12;
/** Below this map zoom the 30 m pixels are mush; the UI says so. */
export const DC_MIN_GOOD_ZOOM = 9;

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

/** One WMTS tile URL for a sensor on a date. Date is YYYY-MM-DD (UTC). */
export function gibsTileUrl(sensor: DcSensor, dateIso: string, z: number, x: number, y: number): string {
  return `${GIBS}/${DC_SENSORS[sensor].layer}/default/${dateIso}/GoogleMapsCompatible_Level12/${z}/${y}/${x}.png`;
}

/** A MapLibre raster source's tiles array for a resolved side. */
export function gibsTiles(sensor: DcSensor, dateIso: string): string[] {
  return [`${GIBS}/${DC_SENSORS[sensor].layer}/default/${dateIso}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`];
}

/* The browser never talks to GIBS directly: tiles and probes ride the
   app's own /api/date-compare/tile route (the pattern the rest of the
   app uses for third-party data), so the comparison keeps working on
   networks that restrict direct third-party requests, and the probe
   reads the route's passed-through layer-time-actual header — the same
   ground truth, one hop closer. */
export function dcTileUrl(sensor: DcSensor, dateIso: string, z: number, x: number, y: number): string {
  return `/api/date-compare/tile?l=${sensor}&d=${dateIso}&z=${z}&x=${x}&y=${y}`;
}

/** MapLibre template form of dcTileUrl. */
export function dcTiles(sensor: DcSensor, dateIso: string): string[] {
  return [`/api/date-compare/tile?l=${sensor}&d=${dateIso}&z={z}&x={x}&y={y}`];
}

export interface DcTileParams { sensor: DcSensor; date: string; z: number; x: number; y: number }

/** Validate tile-route query params. Null = reject (400). */
export function parseDcTileParams(q: URLSearchParams): DcTileParams | null {
  const l = q.get('l');
  const d = q.get('d');
  if (l !== 's30' && l !== 'l30') return null;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return null;
  const z = Number(q.get('z')); const x = Number(q.get('x')); const y = Number(q.get('y'));
  if (!Number.isInteger(z) || z < 0 || z > DC_TILE_ZOOM) return null;
  const max = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= max || y >= max) return null;
  return { sensor: l, date: d, z, x, y };
}

/* ── Calendar ─────────────────────────────────────────────────────────
   All dates are UTC calendar days in ISO form (YYYY-MM-DD) — the form
   GIBS takes — so nothing here depends on the visitor's timezone. */

const DAY_MS = 86_400_000;

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseIsoDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, n: number): string {
  return isoDay(parseIsoDay(iso) + n * DAY_MS);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseIsoDay(b) - parseIsoDay(a)) / DAY_MS);
}

export interface DcWindow {
  /** Oldest pickable date, inclusive. */
  start: string;
  /** Newest published date, inclusive. */
  end: string;
}

export function windowEnding(latestIso: string, days = DC_WINDOW_DAYS): DcWindow {
  return { start: addDays(latestIso, -(days - 1)), end: latestIso };
}

export function clampToWindow(iso: string, w: DcWindow): string {
  if (iso < w.start) return w.start;
  if (iso > w.end) return w.end;
  return iso;
}

/**
 * The dates to try for a picked date, nearest first: the pick itself,
 * then one day earlier, one later, two earlier, two later… clipped to
 * the window. Earlier wins a tie — for a "before" picture the older pass
 * is the honest neighbour, and the walk stays deterministic.
 */
export function snapCandidates(picked: string, w: DcWindow): string[] {
  const pick = clampToWindow(picked, w);
  const out = [pick];
  const span = Math.max(diffDays(w.start, pick), diffDays(pick, w.end));
  for (let d = 1; d <= span; d++) {
    const before = addDays(pick, -d);
    if (before >= w.start) out.push(before);
    const after = addDays(pick, d);
    if (after <= w.end) out.push(after);
  }
  return out;
}

/** "SAT 24 OCT" — a GIBS date labelled in UTC so it never drifts a day. */
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function formatDcDate(iso: string): string {
  const d = new Date(parseIsoDay(iso));
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/* ── Tiles ──────────────────────────────────────────────────────────── */

export interface DcTile { z: number; x: number; y: number }

export function tileXY(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/**
 * A lattice of sample tiles across a view (a 3×3 spread of points,
 * converted to tiles at the layers' native zoom, deduped). Availability
 * is judged on these: a swath that covers any part of the view counts —
 * partial coverage is real HLS behaviour and stays visible as imagery
 * over the compare backdrop where the pass exists, bare backdrop where
 * it does not.
 */
export function sampleTiles(bounds: { west: number; south: number; east: number; north: number }, z = DC_TILE_ZOOM): DcTile[] {
  const seen = new Map<string, DcTile>();
  const spanLng = bounds.east >= bounds.west ? bounds.east - bounds.west : bounds.east + 360 - bounds.west;
  for (const fx of [0.5, 0.08, 0.92]) {
    for (const fy of [0.5, 0.08, 0.92]) {
      const lng = bounds.west + spanLng * fx;
      const lat = bounds.south + (bounds.north - bounds.south) * fy;
      const { x, y } = tileXY(lat, lng > 180 ? lng - 360 : lng, z);
      seen.set(`${x}/${y}`, { z, x, y });
    }
  }
  return [...seen.values()];
}

/* ── Availability + snapping ────────────────────────────────────────── */

/** True when [sensor] carries [date]'s imagery over any of [tiles]. */
export type DcProbe = (sensor: DcSensor, dateIso: string, tiles: DcTile[]) => Promise<boolean>;

export interface DcResolved {
  /** What the visitor picked. */
  picked: string;
  /** The date actually shown — the label always uses this. */
  actual: string;
  sensor: DcSensor;
  /** Days the shown date sits from the pick (0 = the pick itself). */
  snappedDays: number;
}

/**
 * Resolve one side: walk the snap candidates nearest-first; at each
 * date try Sentinel-2, then Landsat. The first real pass wins. Null when
 * no date in the window covers the view.
 *
 * Candidates are probed in small parallel batches (a stalled or slow
 * tile host must not serialize thirty dates of HEAD requests), but the
 * winner is chosen strictly by candidate order — batching changes how
 * fast the answer arrives, never which answer is given.
 */
export async function resolveSide(picked: string, w: DcWindow, tiles: DcTile[], probe: DcProbe): Promise<DcResolved | null> {
  if (!tiles.length) return null;
  const candidates = snapCandidates(picked, w);
  const BATCH = 3;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const hits = await Promise.all(batch.flatMap(date =>
      DC_SENSOR_ORDER.map(async sensor => ({ date, sensor, ok: await probe(sensor, date, tiles) })),
    ));
    for (const date of batch) {
      for (const sensor of DC_SENSOR_ORDER) {
        if (hits.find(h => h.date === date && h.sensor === sensor)?.ok) {
          return { picked, actual: date, sensor, snappedDays: Math.abs(diffDays(picked, date)) };
        }
      }
    }
  }
  return null;
}

/**
 * The live probe: a HEAD request per sampled tile, answered by GIBS's
 * `layer-time-actual` header — present only when that tile truly holds
 * that date's imagery (a no-pass tile comes back a blank PNG with no
 * such header). One carrying tile is enough. Any network failure reads
 * as "no data" for that tile, never as data.
 */
export function headProbe(fetchFn: typeof fetch = fetch): DcProbe {
  return async (sensor, dateIso, tiles) => {
    const hits = await Promise.all(tiles.map(async t => {
      try {
        const res = await fetchFn(dcTileUrl(sensor, dateIso, t.z, t.x, t.y), {
          method: 'HEAD',
          // A stalled probe must read as "no data", never hang the walk.
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok && !!res.headers.get('layer-time-actual');
      } catch { return false; }
    }));
    return hits.some(Boolean);
  };
}

/** Memoise probe answers per component run — dates × tiles repeat a lot. */
export function cachedProbe(probe: DcProbe): DcProbe {
  const cache = new Map<string, Promise<boolean>>();
  return (sensor, dateIso, tiles) => {
    const key = `${sensor}|${dateIso}|${tiles.map(t => `${t.x}/${t.y}`).join(',')}`;
    let hit = cache.get(key);
    if (!hit) { hit = probe(sensor, dateIso, tiles); cache.set(key, hit); }
    return hit;
  };
}

/**
 * The newest date a GIBS layer publishes, read from its WMTS
 * capabilities: the Time dimension's <Default>, cross-checked against
 * the end of the last date range it declares (the two can disagree by a
 * day while a fresh granule lands; the later is the truth the tiles
 * will bear out). Null when the layer isn't in the document.
 */
export function parseGibsLatest(xml: string, sensor: DcSensor): string | null {
  const at = xml.indexOf(`<ows:Identifier>${DC_SENSORS[sensor].layer}</ows:Identifier>`);
  if (at < 0) return null;
  const block = xml.slice(at, at + 8000);
  const dates: string[] = [];
  const def = block.match(/<Default>(\d{4}-\d{2}-\d{2})<\/Default>/);
  if (def) dates.push(def[1]);
  for (const m of block.matchAll(/\d{4}-\d{2}-\d{2}\/(\d{4}-\d{2}-\d{2})\/P1D/g)) dates.push(m[1]);
  return dates.length ? dates.sort().at(-1)! : null;
}
