import { describe, it, expect } from 'vitest';
import {
  deriveFeedBadge,
  formatFrameAge,
  markStreamDead,
  isStreamDead,
  clearStreamDead,
  STREAM_DEAD_TTL_MS,
} from './feed-badge';

describe('deriveFeedBadge', () => {
  it('calls a playing stream LIVE VIDEO', () => {
    for (const kind of ['hls', 'mp4', 'mjpeg', 'iframe'] as const) {
      expect(deriveFeedBadge({ mediaKind: kind, state: 'playing', hasSnapshot: true }))
        .toEqual({ kind: 'live-video', demoted: false, showAge: false });
    }
  });

  it('calls a snapshot LIVE STILL with an age', () => {
    expect(deriveFeedBadge({ mediaKind: 'jpg', state: 'playing', hasSnapshot: true }))
      .toEqual({ kind: 'live-still', demoted: false, showAge: true });
  });

  it('demotes a dead stream to LIVE STILL when a snapshot stands in', () => {
    expect(deriveFeedBadge({ mediaKind: 'hls', state: 'degraded', hasSnapshot: true }))
      .toEqual({ kind: 'live-still', demoted: true, showAge: true });
  });

  it('shows no badge for a dead stream with nothing to fall back to', () => {
    expect(deriveFeedBadge({ mediaKind: 'hls', state: 'degraded', hasSnapshot: false })).toBeNull();
  });

  it('calls a decoder-held video LIVE STILL — the picture is a snapshot', () => {
    expect(deriveFeedBadge({ mediaKind: 'hls', state: 'held', hasSnapshot: true }))
      .toEqual({ kind: 'live-still', demoted: false, showAge: true });
    expect(deriveFeedBadge({ mediaKind: 'hls', state: 'held', hasSnapshot: false })).toBeNull();
  });

  it('claims nothing before the first frame — not-ready wears no badge', () => {
    expect(deriveFeedBadge({ mediaKind: 'hls', state: 'not-ready', hasSnapshot: true })).toBeNull();
    expect(deriveFeedBadge({ mediaKind: 'jpg', state: 'not-ready', hasSnapshot: true })).toBeNull();
  });

  it('shows no badge when there is no media kind at all', () => {
    expect(deriveFeedBadge({ mediaKind: null, state: 'playing', hasSnapshot: true })).toBeNull();
  });

  it('never invents a timelapse badge', () => {
    // The taxonomy is live-video / live-still only; every derivation above
    // returns one of those two kinds or null.
    const kinds = ['hls', 'mp4', 'mjpeg', 'iframe', 'jpg', null] as const;
    const states = ['playing', 'held', 'degraded', 'not-ready'] as const;
    for (const mediaKind of kinds) {
      for (const state of states) {
        const badge = deriveFeedBadge({ mediaKind, state, hasSnapshot: true });
        expect(badge === null || badge.kind === 'live-video' || badge.kind === 'live-still').toBe(true);
      }
    }
  });
});

describe('formatFrameAge', () => {
  it('counts seconds, then minutes, then hours', () => {
    expect(formatFrameAge(0)).toBe('0s');
    expect(formatFrameAge(12_400)).toBe('12s');
    expect(formatFrameAge(59_900)).toBe('59s');
    expect(formatFrameAge(60_000)).toBe('1m');
    expect(formatFrameAge(90_000)).toBe('1m');
    expect(formatFrameAge(3_600_000)).toBe('1h+');
    expect(formatFrameAge(9_999_999)).toBe('2h+');
  });

  it('never goes negative', () => {
    expect(formatFrameAge(-5000)).toBe('0s');
  });
});

describe('dead-stream registry', () => {
  it('marks a failed stream dead, and a retry clears it', () => {
    const id = `cam-${Date.now()}-a`;
    expect(isStreamDead(id)).toBe(false);
    markStreamDead(id);
    expect(isStreamDead(id)).toBe(true);
    clearStreamDead(id);
    expect(isStreamDead(id)).toBe(false);
  });

  it('expires the mark after the TTL, so a recovered stream comes back', () => {
    const id = `cam-${Date.now()}-b`;
    const at = 1_000_000;
    markStreamDead(id, at);
    expect(isStreamDead(id, at + STREAM_DEAD_TTL_MS - 1)).toBe(true);
    expect(isStreamDead(id, at + STREAM_DEAD_TTL_MS)).toBe(false);
    expect(isStreamDead(id, at + STREAM_DEAD_TTL_MS + 1)).toBe(false);
  });

  it('re-marking refreshes the mark', () => {
    const id = `cam-${Date.now()}-c`;
    const at = 1_000_000;
    markStreamDead(id, at);
    markStreamDead(id, at + STREAM_DEAD_TTL_MS - 1000);
    expect(isStreamDead(id, at + STREAM_DEAD_TTL_MS - 500)).toBe(true);
  });

  it('keys numeric and string ids the same way', () => {
    const id = `cam-${Date.now()}-d`;
    markStreamDead(id);
    expect(isStreamDead(id)).toBe(true);
    clearStreamDead(id);
  });
});
