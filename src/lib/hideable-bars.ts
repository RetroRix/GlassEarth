import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hideable side bars — the chrome behaviour for the two desktop bars (the
 * LayerPanel rail on the left, the tool strip on the right).
 *
 * Rick's ask (2026-10-26): the bars should be able to hide/unhide, or reveal
 * on mouse-over hover, so the map gets its screen back. The design:
 *
 *  - Each side carries a PIN. Pinned (the first-visit default) the bar simply
 *    stays on screen, exactly as it always has — a newcomer is never greeted
 *    by missing UI. Unpinning hands the bar to auto-hide.
 *  - Unpinned, the bar tucks itself off its screen edge. Moving the pointer
 *    to that edge reveals it (after a short dwell, so merely crossing the
 *    edge on the way somewhere else does not flash it), and it tucks away
 *    again shortly after the pointer leaves.
 *  - Touch has no hover: a slim edge handle is the affordance instead. A tap
 *    reveals the bar and sticks it; a tap on the handle again, or anywhere
 *    on the map, puts it away.
 *  - A panel opened FROM a bar holds its bar on screen — the bar never hides
 *    out from under its own panel.
 *  - A cockpit ride owns the screen: bars auto-hide for the ride even when
 *    pinned, but hover / edge-tap still reveals one temporarily, and it
 *    tucks away again when the pointer leaves. The ride is never disturbed.
 *
 * The pin choice is remembered per visitor under its own storage key,
 * following the app's other preference keys (`osiris:theme`,
 * `osiris:last-view`, `osiris:sensor-look`). Nothing else about the bars —
 * their contents, their panels, their styling — lives here.
 */

export type BarSide = 'left' | 'right';

export interface BarPins {
  left: boolean;
  right: boolean;
}

export const BARS_STORAGE_KEY = 'osiris:side-bars';

/** First visit: both bars pinned visible. Hiding is opt-in, never a surprise. */
export const DEFAULT_BAR_PINS: BarPins = { left: true, right: true };

/**
 * How long the pointer must dwell at the screen edge before the bar reveals.
 * Crossing the edge on the way to something else takes less than this, so a
 * passing pointer does not flash the bar.
 */
export const BAR_REVEAL_DELAY_MS = 150;

/**
 * How long the bar lingers after the pointer leaves it before tucking away.
 * Long enough to cross the gap between the bar and a flyout or panel without
 * the bar vanishing mid-reach; short enough to feel like it follows you.
 */
export const BAR_HIDE_DELAY_MS = 650;

export function parseBarPins(raw: string | null): BarPins {
  if (!raw) return { ...DEFAULT_BAR_PINS };
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object') {
      const rec = v as Record<string, unknown>;
      return {
        left: typeof rec.left === 'boolean' ? rec.left : DEFAULT_BAR_PINS.left,
        right: typeof rec.right === 'boolean' ? rec.right : DEFAULT_BAR_PINS.right,
      };
    }
  } catch {
    /* a corrupt value reads as the defaults, never as a crash */
  }
  return { ...DEFAULT_BAR_PINS };
}

export function readBarPins(): BarPins {
  try {
    return parseBarPins(localStorage.getItem(BARS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_BAR_PINS };
  }
}

export function writeBarPins(pins: BarPins): void {
  try {
    localStorage.setItem(BARS_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    /* private mode: the choice lasts the session, which is still honest */
  }
}

export interface BarVisibilityInputs {
  /** The visitor's pin: locked visible (subject to a ride). */
  pinned: boolean;
  /** A cockpit ride owns the screen — bars auto-hide regardless of the pin. */
  riding: boolean;
  /** A panel opened from this bar is open right now. */
  panelOpen: boolean;
  /** A transient reveal (edge hover, edge-handle tap, keyboard focus) is live. */
  revealed: boolean;
}

/**
 * The one derivation both bars render from. Order is the design: a panel
 * holds its bar; a live reveal holds its bar; a ride puts an unrevealed,
 * panel-less bar away even when pinned; otherwise the pin decides.
 */
export function barVisible(i: BarVisibilityInputs): boolean {
  if (i.panelOpen) return true;
  if (i.revealed) return true;
  if (i.riding) return false;
  return i.pinned;
}

export interface HideableBar {
  /** Locked visible (the visitor's stored choice for this side). */
  pinned: boolean;
  /** What the bar should render as, right now. */
  visible: boolean;
  /** A transient reveal is live. */
  revealed: boolean;
  /** The live reveal came from a handle tap and sticks until dismissed. */
  tapStuck: boolean;
  /** Attach to the shell wrapping the bar, its edge zone and its handle. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  setPinned: (pinned: boolean) => void;
  togglePinned: () => void;
  /** Pointer entered the edge zone or the bar. */
  noteEnter: () => void;
  /** Pointer left the edge zone or the bar. */
  noteLeave: () => void;
  /** Keyboard focus entered the bar — reveal at once, no dwell. */
  noteFocus: () => void;
  /** Keyboard focus left the bar entirely. */
  noteBlur: (e: React.FocusEvent) => void;
  /** The edge handle was tapped: stick the bar, or put a stuck bar away. */
  toggleTap: () => void;
}

/**
 * One side's hide/show behaviour. The pins initialise from storage (the
 * defaults on the server), and are written back only when the visitor
 * changes them.
 */
export function useHideableBar(
  side: BarSide,
  opts: { panelOpen: boolean; riding: boolean },
): HideableBar {
  /* Read the stored pins lazily, the way the theme reads its own key:
     on the server the read falls back to the defaults, so both renders
     start from the same bar state. */
  const [pins, setPinsState] = useState<BarPins>(() => readBarPins());
  const [revealed, setRevealed] = useState(false);
  const [tapStuck, setTapStuck] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearShowTimer = useCallback(() => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }, []);
  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearShowTimer();
      clearHideTimer();
    },
    [clearShowTimer, clearHideTimer],
  );

  const setPinned = useCallback(
    (pinned: boolean) => {
      setPinsState((prev) => {
        const next = { ...prev, [side]: pinned };
        writeBarPins(next);
        return next;
      });
    },
    [side],
  );
  const togglePinned = useCallback(() => {
    setPinned(!pins[side]);
  }, [pins, setPinned, side]);

  const noteEnter = useCallback(() => {
    clearHideTimer();
    if (revealed || showTimer.current) return;
    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      setRevealed(true);
    }, BAR_REVEAL_DELAY_MS);
  }, [clearHideTimer, revealed]);

  const noteLeave = useCallback(() => {
    clearShowTimer();
    /* A tap-stuck bar is dismissed by taps (the handle again, or the map),
       not by the pointer wandering off — touch taps synthesise a leave
       right behind the click, and hiding on it would undo the tap. */
    if (tapStuck) return;
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      setRevealed(false);
      setTapStuck(false);
    }, BAR_HIDE_DELAY_MS);
  }, [clearHideTimer, clearShowTimer, tapStuck]);

  const noteFocus = useCallback(() => {
    clearShowTimer();
    clearHideTimer();
    setRevealed(true);
  }, [clearHideTimer, clearShowTimer]);

  const noteBlur = useCallback(
    (e: React.FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && rootRef.current?.contains(next)) return;
      noteLeave();
    },
    [noteLeave],
  );

  const toggleTap = useCallback(() => {
    clearShowTimer();
    clearHideTimer();
    if (tapStuck || revealed) {
      setRevealed(false);
      setTapStuck(false);
    } else {
      setRevealed(true);
      setTapStuck(true);
    }
  }, [clearHideTimer, clearShowTimer, revealed, tapStuck]);

  /* A tap-stuck bar is put away by a tap anywhere outside it — on the map,
     most of all. Hover reveals do not install this: the pointer leaving is
     already their dismissal. */
  useEffect(() => {
    if (!tapStuck) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      setRevealed(false);
      setTapStuck(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [tapStuck]);

  const pinned = pins[side];
  const visible = barVisible({
    pinned,
    riding: opts.riding,
    panelOpen: opts.panelOpen,
    revealed,
  });

  return {
    pinned,
    visible,
    revealed,
    tapStuck,
    rootRef,
    setPinned,
    togglePinned,
    noteEnter,
    noteLeave,
    noteFocus,
    noteBlur,
    toggleTap,
  };
}
