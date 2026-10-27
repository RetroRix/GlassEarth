/**
 * OSIRIS — the NOAA weather-imagery suite: three time-enabled WMS layers
 * served by NOAA's nowCOAST GeoServer (the same public services the
 * nowCOAST viewer itself uses), stepped together by one history timeline.
 *
 *   radar     — MRMS base-reflectivity mosaic (WSR-88D + ECCC network),
 *               a frame roughly every 4 minutes over CONUS.
 *   satellite — GOES East/West longwave infrared composite, every 5 minutes.
 *   lightning — LDN lightning-strike density (NLDN / GLD360), every 15 minutes.
 *
 * No key, no account: nowCOAST is a public NOAA service. The frame lists
 * come from each layer's WMS GetCapabilities time dimension, read by
 * /api/weather-imagery; the tiles are requested straight from nowCOAST.
 *
 * Honesty rules, same as the rest of the app: the timeline only ever shows
 * frames the source actually published (their real timestamps), and a
 * source with fewer frames holds its NEAREST published frame — the UI
 * labels it with that frame's own time, never the slider's.
 */

export type WxSourceKey = 'radar' | 'satellite' | 'lightning';

export interface WxSourceDef {
  key: WxSourceKey;
  /** The layer panel's name for it. */
  label: string;
  /** nowCOAST GeoServer workspace WMS endpoint. */
  wms: string;
  /** WMS layer name in that workspace. */
  layer: string;
  /** Attribution MapLibre shows while the layer is on the map. */
  attribution: string;
  /** Short credit for the layer panel / report. */
  credit: string;
  maxZoom: number;
  /** Default raster opacity. */
  opacity: number;
}

const GEOSERVER = 'https://nowcoast.noaa.gov/geoserver';

export const WX_SOURCES: Record<WxSourceKey, WxSourceDef> = {
  radar: {
    key: 'radar',
    label: 'NOAA Radar',
    wms: `${GEOSERVER}/weather_radar/wms`,
    layer: 'base_reflectivity_mosaic',
    attribution: 'Radar © NOAA/NWS MRMS via nowCOAST',
    credit: 'NOAA/NWS Multi-Radar Multi-Sensor (MRMS) via nowCOAST',
    maxZoom: 9,
    opacity: 0.75,
  },
  satellite: {
    key: 'satellite',
    label: 'Satellite IR',
    wms: `${GEOSERVER}/satellite/wms`,
    layer: 'goes_longwave_imagery',
    attribution: 'Satellite © NOAA/NESDIS GOES via nowCOAST',
    credit: 'NOAA/NESDIS GOES East/West longwave IR via nowCOAST',
    maxZoom: 8,
    opacity: 0.9,
  },
  lightning: {
    key: 'lightning',
    label: 'Lightning',
    wms: `${GEOSERVER}/lightning_detection/wms`,
    layer: 'ldn_lightning_strike_density',
    attribution: 'Lightning © NOAA nowCOAST (NLDN/GLD360)',
    credit: 'Lightning Detection Network density (NLDN/GLD360) via nowCOAST',
    maxZoom: 8,
    opacity: 0.9,
  },
};

/** Draw order, bottom first: satellite under radar under lightning. */
export const WX_DRAW_ORDER: WxSourceKey[] = ['satellite', 'radar', 'lightning'];

export type WxFrames = Partial<Record<WxSourceKey, number[]>>;

/**
 * The frame times a time-enabled WMS layer publishes, read out of its
 * GetCapabilities document: the comma-separated ISO instants in the time
 * dimension of the layer with the given name. Sorted, deduped, epoch ms.
 * Anything unparseable is dropped — a frame we cannot date is not a frame
 * we may show.
 */
export function parseWmsTimes(xml: string, layerName: string): number[] {
  const nameAt = xml.indexOf(`<Name>${layerName}</Name>`);
  if (nameAt < 0) return [];
  const dimAt = xml.indexOf('<Dimension name="time"', nameAt);
  if (dimAt < 0) return [];
  const open = xml.indexOf('>', dimAt);
  const close = xml.indexOf('</Dimension>', open);
  if (open < 0 || close < 0) return [];
  const out = new Set<number>();
  for (const part of xml.slice(open + 1, close).split(',')) {
    const t = Date.parse(part.trim());
    if (Number.isFinite(t)) out.add(t);
  }
  return [...out].sort((a, b) => a - b);
}

/** The WMS tile address for one frame of one source, as MapLibre wants it. */
export function wmsTileUrl(def: WxSourceDef, timeMs: number): string {
  const time = new Date(timeMs).toISOString();
  return `${def.wms}?service=WMS&version=1.3.0&request=GetMap`
    + `&layers=${encodeURIComponent(def.layer)}&styles=&format=image/png&transparent=true`
    + `&width=256&height=256&crs=EPSG:3857&bbox={bbox-epsg-3857}&tiled=true`
    + `&time=${encodeURIComponent(time)}`;
}

/**
 * The frame a source shows at time `t`: its nearest published frame.
 * Before its first frame it holds the first; after its last, the last.
 * An exact tie goes to the EARLIER frame — the one already on screen when
 * stepping forward — so playback never flickers between two equals.
 */
export function nearestFrame(times: number[], t: number): number | null {
  if (!times.length) return null;
  let best = times[0];
  let bestD = Math.abs(t - best);
  for (let i = 1; i < times.length; i++) {
    const d = Math.abs(t - times[i]);
    if (d < bestD) { best = times[i]; bestD = d; }
  }
  return best;
}

/** Every active source's frame at time `t`, by the nearest-frame rule. */
export function framesAt(frames: WxFrames, active: WxSourceKey[], t: number): Partial<Record<WxSourceKey, number>> {
  const out: Partial<Record<WxSourceKey, number>> = {};
  for (const key of active) {
    const f = nearestFrame(frames[key] ?? [], t);
    if (f !== null) out[key] = f;
  }
  return out;
}

/**
 * The shared timeline: the sorted union of every active source's frame
 * times. Every step is a real frame of at least one source; stepping to it
 * shows each other source's nearest frame beside it.
 */
export function unionTimeline(frames: WxFrames, active: WxSourceKey[]): number[] {
  const out = new Set<number>();
  for (const key of active) for (const t of frames[key] ?? []) out.add(t);
  return [...out].sort((a, b) => a - b);
}

/** Local half-hour marks inside [first, last], for the track's ticks. */
export function halfHourTicks(first: number, last: number): number[] {
  const HALF = 30 * 60_000;
  const out: number[] = [];
  const d = new Date(first);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  for (let t = d.getTime(); t <= last; t += HALF) out.push(t);
  return out;
}

/** Keep the newest `cap` frames; older history is dropped, never faked. */
export function capFrames(times: number[], cap: number): number[] {
  return times.length > cap ? times.slice(times.length - cap) : times;
}
