import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BARS_STORAGE_KEY,
  BAR_HIDE_DELAY_MS,
  BAR_REVEAL_DELAY_MS,
  DEFAULT_BAR_PINS,
  barVisible,
  parseBarPins,
  readBarPins,
  writeBarPins,
  type BarVisibilityInputs,
} from './hideable-bars';

afterEach(() => {
  vi.unstubAllGlobals();
});

const memoryStore = () => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  });
  return map;
};

describe('parseBarPins', () => {
  it('defaults both bars to pinned when nothing is stored', () => {
    expect(parseBarPins(null)).toEqual({ left: true, right: true });
    expect(parseBarPins('')).toEqual({ left: true, right: true });
  });

  it('reads stored booleans per side', () => {
    expect(parseBarPins('{"left":false,"right":true}')).toEqual({ left: false, right: true });
    expect(parseBarPins('{"left":true,"right":false}')).toEqual({ left: true, right: false });
  });

  it('fills a missing or non-boolean side from the defaults', () => {
    expect(parseBarPins('{"left":false}')).toEqual({ left: false, right: true });
    expect(parseBarPins('{"left":"no","right":0}')).toEqual({ left: true, right: true });
  });

  it('treats corrupt values as the defaults rather than throwing', () => {
    expect(parseBarPins('{not json')).toEqual({ ...DEFAULT_BAR_PINS });
    expect(parseBarPins('"left"')).toEqual({ ...DEFAULT_BAR_PINS });
    expect(parseBarPins('42')).toEqual({ ...DEFAULT_BAR_PINS });
  });
});

describe('pin preference round-trip', () => {
  it('writes under the osiris:side-bars key and reads the same pins back', () => {
    const store = memoryStore();
    writeBarPins({ left: false, right: true });
    expect(store.get(BARS_STORAGE_KEY)).toBe('{"left":false,"right":true}');
    expect(readBarPins()).toEqual({ left: false, right: true });
  });

  it('round-trips an unpin of both sides', () => {
    memoryStore();
    writeBarPins({ left: false, right: false });
    expect(readBarPins()).toEqual({ left: false, right: false });
  });

  it('reads the defaults when storage is empty', () => {
    memoryStore();
    expect(readBarPins()).toEqual({ ...DEFAULT_BAR_PINS });
  });

  it('survives a throwing storage (private mode) on both read and write', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    });
    expect(() => writeBarPins({ left: false, right: false })).not.toThrow();
    expect(readBarPins()).toEqual({ ...DEFAULT_BAR_PINS });
  });
});

describe('barVisible', () => {
  const base: BarVisibilityInputs = {
    pinned: true,
    riding: false,
    panelOpen: false,
    revealed: false,
  };

  it('a pinned bar stays visible — the first-visit behaviour', () => {
    expect(barVisible(base)).toBe(true);
  });

  it('an unpinned, unrevealed bar hides', () => {
    expect(barVisible({ ...base, pinned: false })).toBe(false);
  });

  it('a reveal shows an unpinned bar', () => {
    expect(barVisible({ ...base, pinned: false, revealed: true })).toBe(true);
  });

  it('an open panel holds its bar even when unpinned and unrevealed', () => {
    expect(barVisible({ ...base, pinned: false, panelOpen: true })).toBe(true);
  });

  it('a ride hides even a pinned bar — the FPV frame stays clean', () => {
    expect(barVisible({ ...base, riding: true })).toBe(false);
  });

  it('a ride does not block a temporary reveal', () => {
    expect(barVisible({ ...base, riding: true, revealed: true })).toBe(true);
  });

  it('a ride does not hide a bar out from under its open panel', () => {
    expect(barVisible({ ...base, riding: true, panelOpen: true })).toBe(true);
  });

  it('an unpinned bar with nothing live stays hidden during a ride too', () => {
    expect(barVisible({ ...base, pinned: false, riding: true })).toBe(false);
  });
});

describe('timing constants', () => {
  it('reveal dwells briefly, so crossing the edge does not flash the bar', () => {
    expect(BAR_REVEAL_DELAY_MS).toBeGreaterThan(0);
    expect(BAR_REVEAL_DELAY_MS).toBeLessThanOrEqual(300);
  });

  it('hide lingers longer than the reveal, so reaching a panel is safe', () => {
    expect(BAR_HIDE_DELAY_MS).toBeGreaterThan(BAR_REVEAL_DELAY_MS);
  });
});
