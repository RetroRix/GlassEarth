import { useEffect, useState } from 'react';

/**
 * Glass Earth — client side of the placeholder check.
 *
 * A snapshot tile asks the server route whether the image at its feed URL
 * is one of the agencies' placeholder graphics. The verdict is cached per
 * URL, so a camera that stays on screen is checked once per TTL, not once
 * per 15-second snapshot refresh — and every surface showing the same
 * camera (map tile, wall tile, viewer) shares the one check.
 *
 * A camera can recover while the verdict is cached, and can go down
 * between checks: the badge is honest within one TTL, not to the second.
 * Any failure — route error, undecodable image, network — reads as "not a
 * placeholder", so the tile keeps its LIVE STILL badge. Only a positive
 * verdict flips it to UNAVAILABLE.
 */

/** How long one verdict stands before the camera is checked again. */
export const PLACEHOLDER_CHECK_TTL_MS = 10 * 60 * 1000;
/** How often a mounted tile re-asks while it is on screen. */
const RECHECK_MS = 5 * 60 * 1000;

interface CachedVerdict {
  verdict: boolean;
  at: number;
}

const cache = new Map<string, CachedVerdict>();
const inflight = new Map<string, Promise<boolean>>();

/** Test seam: the module cache is process-wide, so tests clear it. */
export function clearPlaceholderCheckCache(): void {
  cache.clear();
  inflight.clear();
}

function cacheKey(feedUrl: string): string {
  return feedUrl.trim();
}

/**
 * Whether the image at this snapshot URL is a known placeholder graphic.
 * Returns false for anything unknown — an error is never a reason to call
 * a real frame unavailable.
 */
export async function checkPlaceholder(feedUrl: string): Promise<boolean> {
  const key = cacheKey(feedUrl);
  if (!key) return false;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < PLACEHOLDER_CHECK_TTL_MS) return hit.verdict;
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = (async () => {
    try {
      const res = await fetch(`/api/cctv/placeholder?url=${encodeURIComponent(key)}`);
      if (!res.ok) return false;
      const data: unknown = await res.json();
      return (
        typeof data === 'object' &&
        data !== null &&
        (data as { placeholder?: unknown }).placeholder === true
      );
    } catch {
      return false;
    }
  })();
  inflight.set(key, run);
  try {
    const verdict = await run;
    cache.set(key, { verdict, at: Date.now() });
    return verdict;
  } finally {
    inflight.delete(key);
  }
}

/**
 * The placeholder verdict for a snapshot on screen, or false while the
 * check is pending / not running / inconclusive. Only runs while `active`
 * — a tile whose snapshot is not displayed has nothing to check.
 *
 * The verdict is stored against the URL it belongs to, keyed the same way
 * the viewer's frame state is: a reply that arrives late carries the
 * previous URL, so it is simply not read rather than painting the last
 * camera's verdict onto the current one. No reset effect is needed — the
 * return derives "not a placeholder" from the key comparison.
 */
export function usePlaceholder(feedUrl: string | null | undefined, active: boolean): boolean {
  const [found, setFound] = useState<{ url: string; verdict: boolean } | null>(null);
  useEffect(() => {
    if (!active || !feedUrl) return;
    let live = true;
    const ask = () => {
      void checkPlaceholder(feedUrl).then(v => {
        if (live) setFound({ url: feedUrl, verdict: v });
      });
    };
    ask();
    const iv = setInterval(ask, RECHECK_MS);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, [feedUrl, active]);
  return Boolean(active && feedUrl && found !== null && found.url === feedUrl && found.verdict);
}
