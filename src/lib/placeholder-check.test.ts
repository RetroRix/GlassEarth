import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPlaceholder, clearPlaceholderCheckCache, PLACEHOLDER_CHECK_TTL_MS } from './placeholder-check';

beforeEach(() => {
  clearPlaceholderCheckCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T00:30:00Z'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const URL = 'https://cwwp2.dot.ca.gov/data/d6/cctv/image/fre168atfowlerave/fre168atfowlerave.jpg';

function mockRoute(placeholder: boolean) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ placeholder, distance: placeholder ? 0 : 90 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('checkPlaceholder', () => {
  it('returns the route verdict for a placeholder', async () => {
    const fetchMock = mockRoute(true);
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkPlaceholder(URL)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0] as string).toContain('/api/cctv/placeholder?url=');
  });

  it('returns false for a real frame', async () => {
    vi.stubGlobal('fetch', mockRoute(false));
    await expect(checkPlaceholder(URL)).resolves.toBe(false);
  });

  it('shares one fetch between concurrent callers and caches the verdict', async () => {
    const fetchMock = mockRoute(true);
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([checkPlaceholder(URL), checkPlaceholder(URL)]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Still cached: no second fetch.
    await expect(checkPlaceholder(URL)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-checks once the verdict expires', async () => {
    const fetchMock = mockRoute(false);
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkPlaceholder(URL)).resolves.toBe(false);
    vi.advanceTimersByTime(PLACEHOLDER_CHECK_TTL_MS + 1000);
    await expect(checkPlaceholder(URL)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads any failure as "not a placeholder", never as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 502 })));
    await expect(checkPlaceholder(URL)).resolves.toBe(false);
    clearPlaceholderCheckCache();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(checkPlaceholder(URL)).resolves.toBe(false);
  });

  it('never fetches for an empty URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkPlaceholder('  ')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
