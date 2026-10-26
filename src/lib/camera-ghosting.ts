/**
 * Glass Earth — camera ghosting while exploring (Rick's idea, 2026-10-26).
 *
 * A visitor opens on their own local cameras at full strength. When they
 * scan away — panning across the planet, or sitting zoomed out over it —
 * all ~69k camera dots at full strength is a wall of green that says
 * nothing. So while the map is moving, or settled anywhere wider than a
 * city, the dots GHOST: faint, but visible. The planet's camera density
 * still reads; nothing is hidden or removed (Rick's standing rule: he
 * decides what gets hidden — this is a styling treatment, not hiding).
 * When the view settles at city zoom or deeper, that area's cameras
 * populate: they fade up to the full strength they have always had, and
 * the preview tiles and badges that appear at street zoom work exactly
 * as before.
 *
 * "Settled" is the app's own notion, not a second detector: the view the
 * page records (view history, last-view memory) is the moveend view, so
 * the ghost wiring hangs off the same movestart/moveend pair, plus a
 * short stillness window before the fade-in so a pan that ends
 * mid-gesture — wheel ticks, a flight chained into another flight —
 * doesn't flash full strength between moves.
 *
 * The camera open in the viewer is exempt by construction, not by this
 * module: it rides its own layer (cctv-open) at full paint whatever the
 * dots are doing. This module only decides the shared dot layers.
 *
 * Everything here is pure. Reading the zoom and applying the paint is
 * the map component's job.
 */

/** Populated at full strength, or ghosted faint. */
export type CameraGhostState = 'full' | 'ghost';

/** The map themes, as OsirisMap receives them. */
export type CameraGhostTheme = 'core' | 'ghost' | 'day';

/**
 * The zoom at which a settled view counts as "arrived". It is the
 * home-base zoom (lib/opening-view's HOME_BASE.zoom, 9): a visitor who
 * opens on their city is settled at 9 and sees full-strength cameras,
 * and flying anywhere at city zoom or deeper populates on landing.
 * Wider than that — a region, a continent, the globe — is travelling,
 * and travelling reads as ghosts.
 */
export const CAMERA_POPULATE_ZOOM = 9;

/**
 * How long the map must sit still after moveend before the cameras
 * populate. Shorter than the 1.5 s the page waits before recording a
 * settled view (that memory should lag), long enough that the fade-in
 * only starts once the visitor has actually arrived.
 */
export const CAMERA_SETTLE_MS = 350;

/** Ghosting is a quick dim — the map is moving, the dots step back now. */
export const CAMERA_GHOST_FADE_MS = 250;

/** Populating is the arrival moment, so it takes its time. */
export const CAMERA_POPULATE_FADE_MS = 800;

/** The view facts the derivation needs: current zoom, and whether the map is at rest. */
export interface CameraGhostView {
  zoom: number;
  settled: boolean;
}

/**
 * The rule, whole: settled AND zoomed in is populated; anything else —
 * in motion at any zoom, or at rest over anything wider than a city —
 * is ghosts. A garbage zoom never populates.
 */
export function cameraGhostState(view: CameraGhostView): CameraGhostState {
  if (!view.settled) return 'ghost';
  if (!Number.isFinite(view.zoom)) return 'ghost';
  return view.zoom >= CAMERA_POPULATE_ZOOM ? 'full' : 'ghost';
}

/** The opacity of each camera paint channel, per state and theme. */
export interface CameraGhostPaint {
  /** cctv-dots circle-opacity. */
  dots: number;
  /** cctv-dots circle-stroke-opacity — the black ring must fade too, or ghosted dots read as dark rings, which is more clutter, not less. */
  stroke: number;
  /** cctv-glow circle-opacity. */
  glow: number;
  /** cctv-label text-opacity. */
  label: number;
}

/**
 * Full strength is exactly what the layers have always drawn (dots 0.9,
 * ring 0.9, glow 0.35; labels 0.8 on the dark themes, 1 in day where
 * CCTV_LABEL_DAY asks for full opacity) — populating changes nothing
 * about how a settled, zoomed-in map has ever looked.
 */
export const CAMERA_FULL_PAINT: CameraGhostPaint = { dots: 0.9, stroke: 0.9, glow: 0.35, label: 0.8 };

/**
 * Ghost strength, per theme. The dark themes (core, and the phantom
 * 'ghost' theme) take the same values: a fifth-strength dot on a dark
 * basemap is a clear speck of density. Day needs more — its camera
 * green (#00A152) sits on Positron's pale ground, and the dark themes'
 * ghost values wash out there to near-invisible, which would be hiding
 * by another name. Ghosts must stay visible in every theme: faint is
 * the point, gone is not allowed.
 */
const CAMERA_GHOST_PAINT: Record<CameraGhostTheme, CameraGhostPaint> = {
  core: { dots: 0.22, stroke: 0.2, glow: 0.12, label: 0.25 },
  ghost: { dots: 0.22, stroke: 0.2, glow: 0.12, label: 0.25 },
  day: { dots: 0.35, stroke: 0.3, glow: 0.12, label: 0.35 },
};

/** The paint for a state under a theme. Day's full label is 1 (CCTV_LABEL_DAY.opacity), not 0.8. */
export function cameraGhostPaint(theme: CameraGhostTheme, state: CameraGhostState): CameraGhostPaint {
  if (state === 'full') {
    return theme === 'day' ? { ...CAMERA_FULL_PAINT, label: 1 } : CAMERA_FULL_PAINT;
  }
  return CAMERA_GHOST_PAINT[theme] ?? CAMERA_GHOST_PAINT.core;
}

/** How long the fade toward a state takes: arriving is slower than stepping back. */
export function cameraGhostFadeMs(state: CameraGhostState): number {
  return state === 'ghost' ? CAMERA_GHOST_FADE_MS : CAMERA_POPULATE_FADE_MS;
}
