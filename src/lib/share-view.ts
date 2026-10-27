/**
 * Glass Earth — shareable view links.
 *
 * A share link carries where the sender was standing: the map's centre and
 * zoom, its bearing and pitch when they are worth carrying, and the camera
 * they had open. Opening the link restores that view instead of the default
 * home-base opening. The encode/decode pair lives here, pure and testable,
 * because both ends are easy to get subtly wrong: the encoder runs in the
 * share panel, the decoder runs once on load, and garbage in the address bar
 * must degrade to "no shared view" — never to a broken opening.
 *
 * The parameter names keep the spellings the share panel has always used
 * (lat / lon / zoom / layers), so older links in the wild still parse; the
 * camera and camera-angle parameters are newer (cam / brg / pit), and the
 * live-target parameters (flight / cs, ship / sn) newest of all — a link
 * can name a moving flight or ship for the recipient to re-find, not just
 * a place to stand.
 */

export interface SharedView {
  lat: number;
  lng: number;
  zoom?: number;
  bearing?: number;
  pitch?: number;
  cameraId?: string;
  target?: ShareTarget;
}

/**
 * A live target a link can name (wave item 10): not a place but a moving
 * thing the recipient's app must re-find in the live feed. A flight is keyed
 * by its ICAO24 transponder hex — the one identity that survives between
 * the sender's feed and the recipient's; the callsign rides along only so
 * the app can talk about the flight before (and if) it is found. A ship is
 * keyed by MMSI for the same reason, with its name as the display fallback.
 */
export type ShareTarget =
  | { kind: 'flight'; icao24: string; callsign?: string }
  | { kind: 'ship'; mmsi: string; name?: string };

const LAT_RANGE: [number, number] = [-90, 90];
const LNG_RANGE: [number, number] = [-180, 180];
const ZOOM_RANGE: [number, number] = [0.5, 20];
const PITCH_RANGE: [number, number] = [0, 85];
/** Camera ids are catalogue keys: word characters and a few separators. */
const CAMERA_ID_PATTERN = /^[\w.:/-]{1,80}$/;
/** ICAO24 transponder addresses are exactly six hex digits. */
const ICAO24_PATTERN = /^[0-9a-f]{6}$/i;
/** MMSIs are exactly nine digits. */
const MMSI_PATTERN = /^\d{9}$/;
/** Display-only labels: short, and unable to break out of a URL or a sentence. */
const CALLSIGN_PATTERN = /^[\w .-]{1,16}$/;
const SHIP_NAME_PATTERN = /^[\p{L}\p{N} .,'&()-]{1,60}$/u;

function finiteIn(value: number, [min, max]: [number, number]): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function clamp(value: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

/** Whole degrees of bearing, wrapped into [0, 360). */
function normaliseBearing(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * The query string for a view. Centre is always written; the rest only when
 * present and sane, so a plain centre/zoom link stays short. `layers`, when
 * given, is written too — the layer set has ridden in share links since the
 * panel first shipped, and the loader already restores it.
 */
export function encodeShareParams(view: SharedView, layers?: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set('lat', view.lat.toFixed(5));
  params.set('lon', view.lng.toFixed(5));
  if (view.zoom !== undefined && Number.isFinite(view.zoom)) {
    params.set('zoom', clamp(view.zoom, ZOOM_RANGE).toFixed(2));
  }
  if (view.bearing !== undefined && Number.isFinite(view.bearing)) {
    const bearing = normaliseBearing(view.bearing);
    /* A near-zero bearing is the default stance; not worth the bytes. */
    if (bearing >= 0.5) params.set('brg', bearing.toFixed(1));
  }
  if (view.pitch !== undefined && Number.isFinite(view.pitch) && view.pitch >= 0.5) {
    params.set('pit', clamp(view.pitch, PITCH_RANGE).toFixed(1));
  }
  if (view.cameraId && CAMERA_ID_PATTERN.test(view.cameraId)) {
    params.set('cam', view.cameraId);
  }
  if (view.target?.kind === 'flight' && ICAO24_PATTERN.test(view.target.icao24)) {
    params.set('flight', view.target.icao24.toLowerCase());
    const cs = view.target.callsign?.trim();
    if (cs && CALLSIGN_PATTERN.test(cs)) params.set('cs', cs);
  }
  if (view.target?.kind === 'ship' && MMSI_PATTERN.test(view.target.mmsi)) {
    params.set('ship', view.target.mmsi);
    const name = view.target.name?.trim();
    if (name && SHIP_NAME_PATTERN.test(name)) params.set('sn', name);
  }
  if (layers) params.set('layers', layers);
  return params;
}

/**
 * Read a link's target back out of the query string, on its own.
 *
 * A target is best-effort in exactly the way the view's optional fields
 * are: a mangled hex or a nine-digit MMSI that isn't one is dropped, never
 * fatal. A hand-built target-only link (no lat/lon) still resolves here —
 * the target is the link's whole point, and the view decode below is
 * allowed to say "no view" without taking the target down with it.
 */
export function decodeShareTarget(input: string | URLSearchParams): ShareTarget | null {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;

  const flight = params.get('flight')?.trim();
  if (flight && ICAO24_PATTERN.test(flight)) {
    const target: ShareTarget = { kind: 'flight', icao24: flight.toLowerCase() };
    const cs = params.get('cs')?.trim();
    if (cs && CALLSIGN_PATTERN.test(cs)) target.callsign = cs;
    return target;
  }

  const ship = params.get('ship')?.trim();
  if (ship && MMSI_PATTERN.test(ship)) {
    const target: ShareTarget = { kind: 'ship', mmsi: ship };
    const name = params.get('sn')?.trim();
    if (name && SHIP_NAME_PATTERN.test(name)) target.name = name;
    return target;
  }

  return null;
}

/**
 * Copy a link the way the share panel does: the async clipboard where it
 * exists, a throwaway textarea where it doesn't. Resolves false when every
 * route failed, so the caller only claims "copied" when it is true.
 */
export async function copyShareLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    try {
      const input = document.createElement('textarea');
      input.value = url;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(input);
      return ok;
    } catch {
      return false;
    }
  }
}

export function buildShareUrl(origin: string, view: SharedView, layers?: string): string {
  return `${origin}/?${encodeShareParams(view, layers).toString()}`;
}

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Read a shared view back out of a query string.
 *
 * The centre is the link's whole claim: if lat/lon are missing, unparseable
 * or off the planet, there is no shared view at all (null) and the app opens
 * the way it always does. Every other field is best-effort — a bad zoom or
 * a mangled camera id is dropped, never fatal.
 */
export function decodeShareView(input: string | URLSearchParams): SharedView | null {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  const lat = parseNumber(params.get('lat'));
  const lng = parseNumber(params.get('lon'));
  if (lat === null || lng === null) return null;
  if (!finiteIn(lat, LAT_RANGE) || !finiteIn(lng, LNG_RANGE)) return null;

  const view: SharedView = { lat, lng };

  const zoom = parseNumber(params.get('zoom'));
  if (zoom !== null) view.zoom = clamp(zoom, ZOOM_RANGE);

  const bearing = parseNumber(params.get('brg'));
  if (bearing !== null) view.bearing = normaliseBearing(bearing);

  const pitch = parseNumber(params.get('pit'));
  if (pitch !== null) view.pitch = clamp(pitch, PITCH_RANGE);

  const cam = params.get('cam');
  if (cam && CAMERA_ID_PATTERN.test(cam)) view.cameraId = cam;

  const target = decodeShareTarget(params);
  if (target) view.target = target;

  return view;
}
