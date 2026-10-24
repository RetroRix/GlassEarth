import { describe, expect, it } from 'vitest';
import { createViewHistory, isSameView, VIEW_HISTORY_MAX, type ViewSnapshot } from './view-history';

const elPaso: ViewSnapshot = { lat: 31.7619, lng: -106.485, zoom: 9 };
const australia: ViewSnapshot = { lat: -33.8688, lng: 151.2093, zoom: 13 };
const newYork: ViewSnapshot = { lat: 40.7128, lng: -74.006, zoom: 10 };

describe('isSameView', () => {
  it('treats a tiny pan as the same view', () => {
    expect(isSameView(elPaso, { ...elPaso, lat: elPaso.lat + 0.005 })).toBe(true);
  });

  it('treats a small zoom nudge as the same view', () => {
    expect(isSameView(elPaso, { ...elPaso, zoom: 9.3 })).toBe(true);
  });

  it('treats a real move as a different view', () => {
    expect(isSameView(elPaso, australia)).toBe(false);
    expect(isSameView(elPaso, { ...elPaso, zoom: 10 })).toBe(false);
  });
});

describe('createViewHistory', () => {
  it('starts empty: the opening view is the base, Back disabled', () => {
    const h = createViewHistory();
    expect(h.canGoBack()).toBe(false);
    expect(h.goBack()).toBeNull();
    expect(h.record(elPaso)).toBe(false);
    expect(h.canGoBack()).toBe(false);
  });

  it('records a jump and walks back to the opening view', () => {
    const h = createViewHistory();
    h.record(elPaso);
    expect(h.record(australia)).toBe(true);
    expect(h.canGoBack()).toBe(true);
    expect(h.goBack()).toEqual({ ...elPaso });
    expect(h.canGoBack()).toBe(false);
    expect(h.goBack()).toBeNull();
  });

  it('does not record a pan wiggle, and never re-records a back flight', () => {
    const h = createViewHistory();
    h.record(elPaso);
    h.record({ ...elPaso, lat: elPaso.lat + 0.005 });
    expect(h.canGoBack()).toBe(false);
    h.record(australia);
    const back = h.goBack();
    expect(back).toEqual({ ...elPaso });
    // The settled view at the end of the back flight is the popped entry.
    expect(h.record({ ...elPaso })).toBe(false);
    expect(h.canGoBack()).toBe(false);
  });

  it('walks back through several views in order', () => {
    const h = createViewHistory();
    h.record(elPaso);
    h.record(newYork);
    h.record(australia);
    expect(h.goBack()).toEqual({ ...newYork });
    expect(h.goBack()).toEqual({ ...elPaso });
    expect(h.canGoBack()).toBe(false);
  });

  it('pushing a new view after going back drops the forward entries', () => {
    const h = createViewHistory();
    h.record(elPaso);
    h.record(newYork);
    h.record(australia);
    h.goBack(); // back to New York; Australia is gone
    const tokyo: ViewSnapshot = { lat: 35.6762, lng: 139.6503, zoom: 11 };
    expect(h.record(tokyo)).toBe(true);
    expect(h.goBack()).toEqual({ ...newYork });
    expect(h.goBack()).toEqual({ ...elPaso });
    expect(h.canGoBack()).toBe(false);
  });

  it('caps the stack at VIEW_HISTORY_MAX past views', () => {
    const h = createViewHistory();
    h.record(elPaso);
    for (let i = 0; i < VIEW_HISTORY_MAX + 5; i++) {
      h.record({ lat: i, lng: i, zoom: 9 });
    }
    // 20 pops should empty it; the 21st is null. Count exactly.
    let pops = 0;
    while (h.goBack()) pops++;
    expect(pops).toBe(VIEW_HISTORY_MAX);
    expect(h.canGoBack()).toBe(false);
  });

  it('ignores non-finite views', () => {
    const h = createViewHistory();
    h.record(elPaso);
    expect(h.record({ lat: NaN, lng: 0, zoom: 9 })).toBe(false);
    expect(h.canGoBack()).toBe(false);
  });
});
