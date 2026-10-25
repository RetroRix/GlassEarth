/**
 * Glass Earth — honest feed badges + the dead-stream registry.
 *
 * The live-video pilot (commit 1cba184) put 5,531 cameras on real video and
 * left the rest on snapshots — but nothing on screen said which was which,
 * and a dead stream still wore the same "LIVE" chip as a working one until
 * it failed in front of the viewer. This module is the rulebook for the
 * badge, kept pure so the rules are testable without a DOM full of video
 * elements:
 *
 *   LIVE VIDEO — a stream is actually playing, right now.
 *   LIVE STILL — the picture on screen is a snapshot, with its honest age.
 *
 * There is deliberately no TIMELAPSE badge: timelapse is not built, and a
 * badge for a feature that does not exist would be the same dishonesty this
 * exists to kill. The badge describes what the viewer is seeing, not what
 * the catalogue claims the camera can do: a video camera held back by the
 * decoder budget shows its snapshot, so it wears LIVE STILL until it plays.
 *
 * The registry is the second half: when a stream fails, the camera is
 * marked dead for the session, so the next surface that opens it — map tile,
 * wall tile, full viewer — starts on the snapshot with a STILL badge instead
 * of re-attempting the dead stream and flashing LIVE VIDEO first. The mark
 * expires after STREAM_DEAD_TTL_MS, so a recovered stream comes back, and
 * a retry clears it immediately. It is per-browser, per-session, in memory
 * only: no shared store (D5 is tabled), no bulk probing of ~69k cameras —
 * a stream is only ever marked by an actual failed attempt to play it.
 */

import type { PreviewKind } from './camera-preview';

/** What a camera can show that a badge can describe. */
export type BadgeMediaKind = PreviewKind | 'iframe';

/** Kinds that move on their own — a stream, not a still. */
export const LIVE_VIDEO_KINDS: ReadonlySet<BadgeMediaKind> = new Set<BadgeMediaKind>([
  'hls',
  'mp4',
  'mjpeg',
  'iframe',
]);

/**
 * Where the picture on screen is in its life:
 * - `playing` — the declared media is producing frames.
 * - `held` — a video camera held back by the decoder budget; the tile is
 *   showing its snapshot instead.
 * - `degraded` — the declared video failed; the tile is showing its
 *   snapshot instead.
 * - `not-ready` — nothing has produced a frame yet. A badge now would be
 *   a claim about a picture nobody has seen.
 */
export type FeedBadgeState = 'playing' | 'held' | 'degraded' | 'not-ready';

export interface FeedBadge {
  kind: 'live-video' | 'live-still' | 'unavailable';
  /** The video failed and the snapshot is standing in for it. */
  demoted: boolean;
  /** The badge carries a frame age — only stills have one. */
  showAge: boolean;
}

export interface DeriveFeedBadgeInput {
  mediaKind: BadgeMediaKind | null;
  state: FeedBadgeState;
  hasSnapshot: boolean;
  /**
   * The snapshot on screen is one of the agency's placeholder graphics,
   * not a camera frame (see lib/placeholder). A placeholder is not a
   * still — it wears UNAVAILABLE with no age, because an age on a
   * placeholder would claim a freshness the picture does not have.
   * Only ever applied to a badge that would otherwise be LIVE STILL: a
   * playing stream never shows its snapshot, so there is nothing to
   * re-label there.
   */
  placeholder?: boolean;
}

/**
 * The badge for what is actually on screen — or null when there is nothing
 * honest to claim (still loading, or a dead stream with no snapshot to
 * stand in for it).
 */
export function deriveFeedBadge({ mediaKind, state, hasSnapshot, placeholder }: DeriveFeedBadgeInput): FeedBadge | null {
  if (!mediaKind || state === 'not-ready') return null;

  let badge: FeedBadge | null;
  if (LIVE_VIDEO_KINDS.has(mediaKind)) {
    if (state === 'playing') {
      badge = { kind: 'live-video', demoted: false, showAge: false };
    } else if (state === 'held' || state === 'degraded') {
      /* Held or degraded, the picture is a snapshot — say so. Without one
         there is no picture at all, and the tile's own Still card speaks. */
      badge = hasSnapshot
        ? { kind: 'live-still', demoted: state === 'degraded', showAge: true }
        : null;
    } else {
      badge = null;
    }
  } else {
    /* 'jpg' is a snapshot in every state — the only kind that is one. */
    badge = { kind: 'live-still', demoted: false, showAge: true };
  }

  /* A placeholder wears UNAVAILABLE, never LIVE STILL: the picture is the
     operator's graphic, and an age on it would claim a freshness it does
     not have. A playing stream is untouched — its snapshot is not on screen. */
  if (badge?.kind === 'live-still' && placeholder) {
    return { kind: 'unavailable', demoted: false, showAge: false };
  }
  return badge;
}

/**
 * How old the frame on screen is, in the badge's voice.
 *
 * The age is measured from when the displayed frame arrived in the browser
 * — the snapshot's own refresh, not a guess. An agency's capture delay is
 * invisible to us and is not claimed: a frame that arrived 12 seconds ago
 * reads "12s", whatever the camera saw before that.
 */
export function formatFrameAge(ageMs: number): string {
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h+`;
}

// ── Dead-stream registry ──────────────────────────────────────────────────

/** A dead mark lives one session half-hour: long enough to stop the
 *  re-attempt loop, short enough that a recovered stream comes back on
 *  its own. A reload clears it too — a fresh session re-probes. */
export const STREAM_DEAD_TTL_MS = 30 * 60 * 1000;

/** camera id → when it was marked dead (ms since epoch). */
const deadStreams = new Map<string, number>();

export function streamKey(id: string | number): string {
  return String(id);
}

/** A stream that failed to play is dead for the session. */
export function markStreamDead(id: string | number, at: number = Date.now()): void {
  deadStreams.set(streamKey(id), at);
}

/** Whether this camera's stream is currently marked dead. Expired marks are
 *  swept on read, so a recovered stream is re-attempted without a reload. */
export function isStreamDead(id: string | number, now: number = Date.now()): boolean {
  const at = deadStreams.get(streamKey(id));
  if (at === undefined) return false;
  if (now - at >= STREAM_DEAD_TTL_MS) {
    deadStreams.delete(streamKey(id));
    return false;
  }
  return true;
}

/** A retry clears the mark, so the re-attempt actually happens. */
export function clearStreamDead(id: string | number): void {
  deadStreams.delete(streamKey(id));
}
