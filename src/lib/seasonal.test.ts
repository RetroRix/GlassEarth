import { describe, expect, it } from 'vitest';
import { hasSpookyPreview, isHalloweenWindow, isSpookySeason, SPLASH_FAILSAFE_MS, SPOOKY_SPLASH_FAILSAFE_MS, SPLASH_STAGE3_HOLD_MS, SPOOKY_STAGE3_HOLD_MS } from './seasonal';

// Local-time constructors (month is 0-based): the window is defined on the
// visitor's own calendar, so the tests pin local dates, not UTC instants.
const d = (year: number, month: number, day: number, hour = 12) => new Date(year, month, day, hour);

describe('isHalloweenWindow', () => {
  it('is off on Oct 28 and on from Oct 29', () => {
    expect(isHalloweenWindow(d(2026, 9, 28))).toBe(false);
    expect(isHalloweenWindow(d(2026, 9, 28, 23))).toBe(false);
    expect(isHalloweenWindow(d(2026, 9, 29, 0))).toBe(true);
    expect(isHalloweenWindow(d(2026, 9, 29))).toBe(true);
  });

  it('stays on through Halloween and Nov 1, and is off on Nov 2', () => {
    expect(isHalloweenWindow(d(2026, 9, 30))).toBe(true);
    expect(isHalloweenWindow(d(2026, 9, 31))).toBe(true);
    expect(isHalloweenWindow(d(2026, 10, 1))).toBe(true);
    expect(isHalloweenWindow(d(2026, 10, 1, 23))).toBe(true);
    expect(isHalloweenWindow(d(2026, 10, 2, 0))).toBe(false);
    expect(isHalloweenWindow(d(2026, 10, 2))).toBe(false);
  });

  it('is off the rest of the year', () => {
    expect(isHalloweenWindow(d(2026, 0, 1))).toBe(false); // Jan 1
    expect(isHalloweenWindow(d(2026, 6, 4))).toBe(false); // Jul 4
    expect(isHalloweenWindow(d(2026, 8, 30))).toBe(false); // Sep 30
    expect(isHalloweenWindow(d(2026, 11, 25))).toBe(false); // Dec 25
  });

  it('recurs on the same dates every year', () => {
    for (const year of [2025, 2027, 2030]) {
      expect(isHalloweenWindow(d(year, 9, 28))).toBe(false);
      expect(isHalloweenWindow(d(year, 9, 29))).toBe(true);
      expect(isHalloweenWindow(d(year, 10, 1))).toBe(true);
      expect(isHalloweenWindow(d(year, 10, 2))).toBe(false);
    }
  });
});

describe('hasSpookyPreview', () => {
  it('is on only for exactly ?spooky=1', () => {
    expect(hasSpookyPreview('?spooky=1')).toBe(true);
    expect(hasSpookyPreview('?lat=31.7&spooky=1')).toBe(true);
    expect(hasSpookyPreview('?spooky=0')).toBe(false);
    expect(hasSpookyPreview('?spooky=true')).toBe(false);
    expect(hasSpookyPreview('?spooky=')).toBe(false);
    expect(hasSpookyPreview('')).toBe(false);
    expect(hasSpookyPreview('?layers=cctv')).toBe(false);
  });
});

describe('isSpookySeason', () => {
  it('combines the window and the preview', () => {
    const july = d(2026, 6, 15);
    expect(isSpookySeason(july)).toBe(false);
    expect(isSpookySeason(july, '?spooky=0')).toBe(false);
    expect(isSpookySeason(july, '?spooky=1')).toBe(true);
    expect(isSpookySeason(d(2026, 9, 31))).toBe(true);
    expect(isSpookySeason(d(2026, 9, 31), '')).toBe(true);
  });
});

describe('splash dwell times', () => {
  it('keeps the normal timings exactly as they always were', () => {
    expect(SPLASH_STAGE3_HOLD_MS).toBe(550);
    expect(SPLASH_FAILSAFE_MS).toBe(7000);
  });

  it('holds the spooky splash far longer than the normal one', () => {
    expect(SPOOKY_STAGE3_HOLD_MS).toBeGreaterThan(SPLASH_STAGE3_HOLD_MS);
    expect(SPOOKY_STAGE3_HOLD_MS).toBe(4500);
  });

  it('never lets the spooky failsafe cut the spooky hold short on a fast load', () => {
    // Fast load: stage 3 lands ~2.2 s in (1.7 s stage timers + 0.5 s after
    // the map's first frame), then the spooky hold runs. The failsafe must
    // sit beyond that sum, or it would defeat the hold it exists to protect.
    expect(2200 + SPOOKY_STAGE3_HOLD_MS).toBeLessThan(SPOOKY_SPLASH_FAILSAFE_MS);
    expect(SPOOKY_SPLASH_FAILSAFE_MS).toBeGreaterThan(SPLASH_FAILSAFE_MS);
  });
});
