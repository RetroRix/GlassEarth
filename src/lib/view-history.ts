/**
 * Glass Earth — the view-history stack (the Back button).
 *
 * Browser-style back navigation for map views. Rick tested a camera in
 * Australia and getting back to the USA cams was a pain; Home flies to
 * El Paso, which is not the same thing — Back returns to the view you were
 * just at, and keeps walking back from there.
 *
 * The stack is in-memory only, for this session: the last-view persistence
 * in lib/opening-view already covers return visits, and a back stack from a
 * previous visit would be a surprise, not a help.
 *
 * Model: a stack of past views plus a current view. Recording a new settled
 * view pushes the old current onto the stack; going back pops the stack and
 * makes that entry current. Forward entries are therefore gone the moment
 * you go back — pushing a new view after a Back can never resurrect them,
 * exactly like a browser. The settled view that arrives at the end of a
 * back flight is the entry just popped, so it dedupes against current and
 * is never re-recorded: no loops, no extra guard flag needed.
 *
 * Only settled views are recorded (the page feeds this from the moveend-
 * driven mapView, debounced through the last-view timer), and only
 * SIGNIFICANT ones — a pan wiggle must not fill the stack. The page also
 * guards the globe view (zoom <= 3) and the splash the same way the
 * last-view writer does.
 */

/** One settled map view: where the camera sits and how it looks. */
export interface ViewSnapshot {
  lat: number;
  lng: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

/** How many past views Back can walk through. */
export const VIEW_HISTORY_MAX = 20;

/* A move counts as a new view when the centre moved by more than ~2 km, the
   zoom changed by half a level, or the camera angle moved noticeably. At
   street-level zooms 0.02° is a couple of blocks; at continental zooms the
   same move is a whole region — either way it is a view worth coming back
   to, and anything smaller is a wiggle. */
const MIN_LAT_LNG_DELTA = 0.02;
const MIN_ZOOM_DELTA = 0.5;
const MIN_BEARING_DELTA = 15;
const MIN_PITCH_DELTA = 10;

/** Two views are the same stop when nothing about them moved enough to matter. */
export function isSameView(a: ViewSnapshot, b: ViewSnapshot): boolean {
  return (
    Math.abs(a.lat - b.lat) <= MIN_LAT_LNG_DELTA &&
    Math.abs(a.lng - b.lng) <= MIN_LAT_LNG_DELTA &&
    Math.abs(a.zoom - b.zoom) < MIN_ZOOM_DELTA &&
    Math.abs((a.bearing ?? 0) - (b.bearing ?? 0)) < MIN_BEARING_DELTA &&
    Math.abs((a.pitch ?? 0) - (b.pitch ?? 0)) < MIN_PITCH_DELTA
  );
}

export interface ViewHistory {
  /** Record a settled view. Returns whether Back now has somewhere to go. */
  record(view: ViewSnapshot): boolean;
  /** Go back one view. Null when the stack is empty — the button is disabled then. */
  goBack(): ViewSnapshot | null;
  /** Whether Back has somewhere to go right now. */
  canGoBack(): boolean;
}

/** A fresh, empty history. Pure — no React, no storage, fully testable. */
export function createViewHistory(maxPast: number = VIEW_HISTORY_MAX): ViewHistory {
  const past: ViewSnapshot[] = [];
  let current: ViewSnapshot | null = null;

  return {
    record(view: ViewSnapshot): boolean {
      if (!Number.isFinite(view.lat) || !Number.isFinite(view.lng) || !Number.isFinite(view.zoom)) return past.length > 0;
      if (current === null) {
        // The first settled view is the base of the stack — the opening
        // view itself, so Back from the first jump returns to where the
        // session started.
        current = { ...view };
        return false;
      }
      if (isSameView(current, view)) return past.length > 0;
      past.push(current);
      if (past.length > maxPast) past.shift();
      current = { ...view };
      return true;
    },

    goBack(): ViewSnapshot | null {
      const target = past.pop();
      if (!target) return null;
      // The settled view at the end of this flight is this same entry, so
      // record() will dedupe it against current — the back flight can never
      // push itself back onto the stack.
      current = { ...target };
      return { ...target };
    },

    canGoBack(): boolean {
      return past.length > 0;
    },
  };
}
