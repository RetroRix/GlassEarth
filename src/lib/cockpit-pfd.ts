/**
 * Glass Earth — Cockpit glass PFD (pipeline #20).
 *
 * Rick, riding the FPV cockpit on his iPhone, asked for the telemetry as
 * aircraft instruments — "kinda like you're in the cockpit" — and picked
 * the modern glass-cockpit layout from mockups: a speed tape, an attitude
 * ball, an altitude tape, on the BOTTOM of the screen. His refinement,
 * verbatim in spirit: the satellite VIEW is the hero; the instruments are
 * secondary, low-profile and translucent, and must not block the view.
 *
 * This module is the band's pure logic — tape geometry, the derived
 * instruments, the ride's framing/basemap/fullscreen decisions — kept
 * framework-free so every number can be tested without a DOM.
 *
 * Honest-data rules, inherited from the whole cockpit line:
 *  - Speed, altitude and heading are the feed's own values.
 *  - Vertical speed is arithmetic on real altitude reports (a slope),
 *    nothing more.
 *  - The attitude ball's BANK is an ESTIMATE: the ADS-B feed carries no
 *    pitch or roll, so bank is derived from the turn rate and ground
 *    speed with the standard coordinated-turn relation — and it is
 *    labelled EST in the glass. Pitch is never shown: the ladder is
 *    fixed at zero because there is no pitch data to draw.
 */

import { angleDeltaDeg, COCKPIT_TOP_PADDING_FRACTION } from './cockpit';

/* ── Band geometry ──────────────────────────────────────────────────────── */

/** The instrument band's height. Low-profile on purpose (Rick: the view
 *  is the focal point) — the smallest band in which the tapes still read
 *  as instruments. The component renders exactly these heights; the map
 *  uses them as the fallback when it cannot measure the band's DOM box. */
export const PFD_BAND_HEIGHT_MOBILE_PX = 104;
export const PFD_BAND_HEIGHT_DESKTOP_PX = 120;

/** Speed tape scale: 1 px per knot, major labels every 20 kt. */
export const SPEED_TAPE_PX_PER_KT = 1;
export const SPEED_TAPE_TICK_KT = 10;
export const SPEED_TAPE_LABEL_KT = 20;
/** Altitude tape scale: 100 ft every 9 px, major labels every 500 ft. */
export const ALT_TAPE_PX_PER_FT = 0.09;
export const ALT_TAPE_TICK_FT = 100;
export const ALT_TAPE_LABEL_FT = 500;
/** How far the rendered tick strip extends past the visible window, so
 *  the chase between feed reports never runs off the drawn ticks. */
export const TAPE_TICK_MARGIN = 3;

/** One drawn tick on a tape. `yPx` is relative to the tape's centre line:
 *  positive is DOWN the strip (lower values sit lower). */
export interface TapeTick {
  value: number;
  label: boolean;
  yPx: number;
}

/**
 * The ticks to draw for a tape whose window is centred on `anchor` (the
 * value the strip is built around): every `tickStep` from anchor −
 * spanSteps·step to anchor + spanSteps·step, each marked as a major
 * (labelled) tick when it lands on a `labelStep` boundary. The strip is
 * then translated by `tapeStripOffsetPx` so the live value sits centred.
 */
export function tapeTicks(
  anchor: number,
  tickStep: number,
  labelStep: number,
  pxPerUnit: number,
  spanSteps: number = TAPE_TICK_MARGIN * 10,
): TapeTick[] {
  const ticks: TapeTick[] = [];
  for (let i = -spanSteps; i <= spanSteps; i++) {
    const value = anchor + i * tickStep;
    ticks.push({
      value,
      label: ((value % labelStep) + labelStep) % labelStep === 0,
      yPx: 0 - i * tickStep * pxPerUnit,
    });
  }
  return ticks;
}

/**
 * The strip's translateY for a live value: ticks are laid out around the
 * anchor, so the strip shifts by the value's distance from the anchor —
 * as the value grows the strip moves DOWN, bringing higher ticks in from
 * the top, the way a real tape scrolls.
 */
export function tapeStripOffsetPx(displayValue: number, anchor: number, pxPerUnit: number): number {
  return (displayValue - anchor) * pxPerUnit;
}

/** The tape anchor for a value: the nearest tick boundary at or below it,
 *  so anchors step discretely (at feed cadence) while the strip's offset
 *  animates continuously between them. */
export function tapeAnchorFor(value: number, tickStep: number): number {
  return Math.floor(value / tickStep) * tickStep;
}

/* ── Derived instruments ──────────────────────────────────────────────── */

const KNOT_TO_MS = 0.514444;
const G_MS2 = 9.80665;
/** No transport banks past this in normal flight; the estimate clamps. */
export const BANK_ESTIMATE_LIMIT_DEG = 35;

/**
 * Bank angle (degrees) for a coordinated turn: tan φ = ω·v / g, with ω
 * the turn rate and v the ground speed. Straight flight (ω ≈ 0) reads
 * ≈ 0°; a standard-rate turn (3°/s) at jet speeds reads in the high 20s,
 * the way the real panel does. Sign follows the turn: right turn,
 * positive (right) bank. No speed or no turn → level.
 */
export function estimateBankDeg(turnRateDegPerSec: number, speedKnots: number): number {
  if (!Number.isFinite(turnRateDegPerSec) || !Number.isFinite(speedKnots)) return 0;
  if (speedKnots <= 0 || turnRateDegPerSec === 0) return 0;
  const omega = (turnRateDegPerSec * Math.PI) / 180;
  const v = speedKnots * KNOT_TO_MS;
  const bank = (Math.atan((omega * v) / G_MS2) * 180) / Math.PI;
  return Math.max(-BANK_ESTIMATE_LIMIT_DEG, Math.min(BANK_ESTIMATE_LIMIT_DEG, bank));
}

/** Turn rate between two heading samples, degrees per second, taking the
 *  short way around the compass (359° → 1° is +2°, not −358°). */
export function turnRateDegPerSec(prevHeadingDeg: number, nextHeadingDeg: number, dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
  return (angleDeltaDeg(prevHeadingDeg, nextHeadingDeg) / dtMs) * 1000;
}

/** Vertical speed between two altitude samples, feet per minute. Pure
 *  arithmetic on real reports — a slope, never a sensor. */
export function deriveVerticalSpeedFpm(prevAltFt: number, nextAltFt: number, dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
  return ((nextAltFt - prevAltFt) / dtMs) * 60_000;
}

/** The VS readout as the glass shows it: signed, to the nearest 10 fpm,
 *  and a clean 0 when the slope is negligible. */
export function formatVerticalSpeed(fpm: number): string {
  if (!Number.isFinite(fpm)) return 'VS —';
  const rounded = Math.round(fpm / 10) * 10;
  if (Math.abs(rounded) < 50) return 'VS 0';
  return `VS ${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString()}`;
}

/* ── Framing ──────────────────────────────────────────────────────────── */

/**
 * The map padding for a ride: the instrument band occupies
 * `occupiedBottomPx` at the bottom of the screen, and the aircraft is
 * framed in the CLEAR area above it — low in that area (the FPV rule:
 * the frame is overwhelmingly the world ahead), never behind the glass.
 * MapLibre projects the camera target to the centre of the padded
 * viewport, so with top padding = fraction × clear height the nose sits
 * at (1 + fraction) / 2 of the clear height — 0.76 with the shipped
 * fraction, the bottom quarter of the stage.
 */
export function cockpitRidePadding(
  containerHeightPx: number,
  occupiedBottomPx: number,
): { top: number; bottom: number } {
  const bottom = Math.max(0, Math.round(occupiedBottomPx));
  const clear = Math.max(0, containerHeightPx - bottom);
  return { top: Math.round(COCKPIT_TOP_PADDING_FRACTION * clear), bottom };
}

/* ── Basemap: satellite by default in a ride ──────────────────────────── */

export type RideMapStyle = 'dark' | 'satellite';

/**
 * The style the map should show: while a ride is on, satellite — unless
 * its tiles have failed this ride, in which case the visitor's own style
 * (the fallback is the previous style, never a blank map). Outside a
 * ride, always the visitor's own choice, untouched.
 */
export function effectiveRideStyle(
  riding: boolean,
  satelliteFailed: boolean,
  visitorStyle: RideMapStyle,
): RideMapStyle {
  return riding && !satelliteFailed ? 'satellite' : visitorStyle;
}

/** The ArcGIS World_Imagery tile URL the satellite layer serves — also
 *  what the ride probes to learn whether the imagery is reachable. */
export function satelliteTileUrl(lat: number, lng: number, zoom: number): string {
  const z = Math.max(0, Math.floor(zoom));
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${clamp(y)}/${clamp(x)}`;
}

/* ── Fullscreen ───────────────────────────────────────────────────────── */

export type FullscreenAction = 'request' | 'exit' | 'none';

/**
 * What a ride transition should do with the browser's fullscreen: ask
 * for it when a ride starts (where the platform supports it — the call
 * itself degrades silently where it doesn't, e.g. iPhone Safari, where
 * the chrome-hidden ride IS the fullscreen), give it back when the ride
 * ends, and never fight the visitor — if they left fullscreen mid-ride
 * (Esc), nothing re-asks until the next ride.
 */
export function fullscreenTransition(
  wasRiding: boolean,
  isRiding: boolean,
  fullscreenActive: boolean,
): FullscreenAction {
  if (!wasRiding && isRiding) return fullscreenActive ? 'none' : 'request';
  if (wasRiding && !isRiding) return fullscreenActive ? 'exit' : 'none';
  return 'none';
}

/* ── Cruise dim (the refinement's bonus) ──────────────────────────────── */

/** Quiet cruising for this long lets the band fade back. */
export const BAND_DIM_AFTER_MS = 10_000;
/** The band's opacity while faded — dimmed, never gone: a glance must
 *  still find the numbers, and any touch restores full strength. */
export const BAND_DIM_OPACITY = 0.45;

export interface BandDimInputs {
  lock: 'follow' | 'free';
  /** The displayed record is held through a feed gap. */
  flightHeld: boolean;
  /** No record yet — nothing to fade away from or to. */
  hasFlight: boolean;
  nowMs: number;
  /** When the ride (or the current target) began. */
  cruiseStartMs: number;
  /** The last pointer interaction anywhere, if any. */
  lastInteractMs: number | null;
}

/**
 * The band dims only while the ride is simply cruising: following,
 * freshly fed, with a record on the glass, and no interaction for a
 * while. A feed gap, a grabbed map, a fresh ride or hop, or any touch
 * brings it straight back to full readability.
 */
export function bandDimmed(i: BandDimInputs): boolean {
  if (i.lock !== 'follow' || i.flightHeld || !i.hasFlight) return false;
  const quietSince = Math.max(i.cruiseStartMs, i.lastInteractMs ?? 0);
  return i.nowMs - quietSince > BAND_DIM_AFTER_MS;
}
