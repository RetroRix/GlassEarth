/**
 * Glass Earth — Sunrise Chaser (pipeline #14, picked by Rick 2026-11-02).
 *
 * Ride the terminator: find the catalogue cameras where the sun is rising
 * right now. The solar math is the app's own — `sunElevation` from
 * lib/live-clouds, the same model that shades Live Clouds — so the dawn
 * line this module draws is the one the rest of the app already believes.
 *
 * Pure and dependency-light: given the camera catalogue and a moment, it
 * returns the cameras in the dawn band, each with its real sun elevation
 * and a minutes-to-sunrise figure derived from the model's own rate of
 * change (finite difference, labelled approximate in the UI). Nothing is
 * curated by hand and nothing is invented: a camera is here because the
 * sun is actually coming up over it.
 */

import { sunElevation } from './live-clouds';
import { isWallPlayable, type WallCamera } from './theater-wall';

/** The dawn band: from just before geometric sunrise to golden morning. */
export const DAWN_BAND_MIN_DEG = -2;
export const DAWN_BAND_MAX_DEG = 6;

/** Sun elevation in degrees at a place and moment (negative = below horizon). */
export function sunElevationDeg(lat: number, lng: number, timeMs: number): number {
  const sinElev = sunElevation(timeMs)(lat * (Math.PI / 180), lng * (Math.PI / 180));
  return (Math.asin(Math.max(-1, Math.min(1, sinElev))) * 180) / Math.PI;
}

export interface SunriseState {
  elevationDeg: number;
  /** Elevation is climbing — the morning side of the terminator. */
  rising: boolean;
  /**
   * Minutes until the sun crosses 0° at the model's own current rate:
   * negative when it already rose that long ago. Null when the sun is
   * barely moving (polar day/night edges) and the figure would mislead.
   */
  minutesToSunrise: number | null;
  /** Inside the dawn band and on the rising side. */
  inDawnBand: boolean;
}

const STEP_MS = 5 * 60_000;

export function sunriseState(lat: number, lng: number, timeMs: number): SunriseState {
  const elev = sunElevationDeg(lat, lng, timeMs);
  const ahead = sunElevationDeg(lat, lng, timeMs + STEP_MS);
  const ratePerMin = (ahead - elev) / (STEP_MS / 60_000);
  const rising = ratePerMin > 0.005;
  const minutesToSunrise = ratePerMin > 0.02 ? (0 - elev) / ratePerMin : null;
  return {
    elevationDeg: elev,
    rising,
    minutesToSunrise,
    inDawnBand: rising && elev >= DAWN_BAND_MIN_DEG && elev <= DAWN_BAND_MAX_DEG,
  };
}

export interface SunriseCamera {
  cam: WallCamera;
  elevationDeg: number;
  minutesToSunrise: number | null;
}

/**
 * The catalogue's dawn-line cameras, closest to the sunrise moment first
 * (a camera whose sun is crossing the horizon now outranks one that rose
 * five degrees ago). Playable cameras only — the chaser opens what it
 * lists, so a pin with no picture has no place here.
 */
export function sunriseCameras(cameras: WallCamera[], timeMs: number, limit = 40): SunriseCamera[] {
  const found: SunriseCamera[] = [];
  for (const cam of cameras) {
    const lat = Number(cam.lat);
    const lng = Number(cam.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isWallPlayable(cam)) continue;
    const state = sunriseState(lat, lng, timeMs);
    if (!state.inDawnBand) continue;
    found.push({ cam, elevationDeg: state.elevationDeg, minutesToSunrise: state.minutesToSunrise });
  }
  const closeness = (c: SunriseCamera) =>
    c.minutesToSunrise === null ? Number.POSITIVE_INFINITY : Math.abs(c.minutesToSunrise);
  found.sort((a, b) => closeness(a) - closeness(b));
  return found.slice(0, limit);
}
