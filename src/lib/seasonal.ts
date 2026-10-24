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
