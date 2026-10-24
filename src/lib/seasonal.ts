/**
 * Glass Earth — seasonal chrome.
 *
 * The Halloween launch-week theme: a few pumpkin-orange accents on the
 * default chrome (boot screen, header subtitle, the roulette dice), shown
 * only while the visitor's own calendar is inside the window — Oct 29
 * through Nov 1, every year — or while the hidden preview override is in
 * the address. Outside the window nothing in the app changes: the accents
 * are conditional renders/styles keyed off these helpers, so a dormant
 * theme is the app exactly as it always looks.
 *
 * "Visitor-local" is the point of using Date's local getters: a launch
 * morning in El Paso is still Oct 30 in Tokyo, and each visitor gets the
 * theme on their own Halloween.
 */

/**
 * True when `date` (default: now) falls on Oct 29, 30, 31 or Nov 1 in the
 * date's own timezone. Pure: same date in, same answer out.
 */
export function isHalloweenWindow(date: Date = new Date()): boolean {
  const month = date.getMonth(); // 0-based: October is 9, November is 10
  const day = date.getDate();
  return (month === 9 && day >= 29) || (month === 10 && day <= 1);
}

/**
 * The hidden preview override: `?spooky=1` in the address forces the theme
 * on for that visit only, so it can be eyeballed before Oct 29. It is read
 * from the address at mount, never persisted, and nothing in the UI links
 * to it. Anything but exactly "1" — including a missing param — is off.
 */
export function hasSpookyPreview(search: string): boolean {
  try {
    return new URLSearchParams(search).get('spooky') === '1';
  } catch {
    return false;
  }
}

/** The whole decision: inside the window, or previewing it. */
export function isSpookySeason(date: Date = new Date(), search?: string): boolean {
  return isHalloweenWindow(date) || (search !== undefined && hasSpookyPreview(search));
}

/**
 * Splash dwell times. The normal values are the long-standing ones (stage 3
 * — SYSTEM READY — lingers just long enough to read, and the failsafe
 * guarantees the splash never traps anyone past 7 s if the map stalls).
 *
 * In the Halloween window the splash is the pumpkin globe's stage, so it
 * gets a longer dwell: stage 3 holds 4.5 s instead of 550 ms, and the
 * failsafe stretches to 12 s so it can never cut that hold short on a
 * fast load (stage 3 lands ~2.2 s in, + 4.5 s = ~6.7 s, well inside 12 s).
 * Tap-to-dismiss on the splash itself is the escape hatch for repeat
 * visitors. These live here — not inline in page.tsx — so tests can pin
 * the arithmetic instead of trusting magic numbers in a component.
 */
export const SPLASH_STAGE3_HOLD_MS = 550;
export const SPOOKY_STAGE3_HOLD_MS = 4500;
export const SPLASH_FAILSAFE_MS = 7000;
export const SPOOKY_SPLASH_FAILSAFE_MS = 12000;
