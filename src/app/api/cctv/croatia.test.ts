import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCroatiaCameras,
  freshCameraIds,
  hakCameraId,
  mapCroatiaCamera,
  type CroatiaCameraRow,
} from './croatia';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-11-20T21:45:00.000Z');

/** A camera row, verbatim in shape from the directory's answer. */
const row = (over: Partial<CroatiaCameraRow> = {}): CroatiaCameraRow => ({
  name: 'Prilaz NP Lučko iz petlje',
  latitude: 45.7545,
  longitude: 15.8919,
  image_url: 'https://www.hak.hr/info/kamere/728.jpg',
  ...over,
});

describe('Croatia HAK cameras', () => {
  it('reads the camera id out of a HAK picture link and nothing else', () => {
    expect(hakCameraId('https://www.hak.hr/info/kamere/728.jpg')).toBe('728');
    expect(hakCameraId('https://www.hak.hr/info/kamere/728.jpg?v=20261120214154')).toBeNull();
    expect(hakCameraId('https://example.com/info/kamere/728.jpg')).toBeNull();
    expect(hakCameraId(null)).toBeNull();
  });

  it('calls a camera fresh only while its newest picture is under a day old', () => {
    const fresh = freshCameraIds([
      { id: '1', lastImageAtUtc: '2026-11-20T21:42:03.257Z' },
      { id: '2', lastImageAtUtc: '2026-11-19T22:00:00.000Z' },
      { id: '3', lastImageAtUtc: '2026-11-19T20:00:00.000Z' },
      { id: '4', lastImageAtUtc: 'not a date' },
      { lastImageAtUtc: '2026-11-20T21:42:03.257Z' },
    ], NOW);
    expect([...fresh].sort()).toEqual(['1', '2']);
  });

  it('maps a directory row HAK vouches for to a camera', () => {
    expect(mapCroatiaCamera(row(), new Set(['728']))).toEqual({
      id: 'hr-728',
      lat: 45.7545,
      lng: 15.8919,
      name: 'Prilaz NP Lučko iz petlje',
      city: 'Croatia',
      country: 'Croatia',
      feed_url: 'https://www.hak.hr/info/kamere/728.jpg',
      source: 'HAK Croatia',
    });
  });

  it('drops rows HAK does not list as fresh, or with no place in Croatia', () => {
    expect(mapCroatiaCamera(row(), new Set(['999']))).toBeNull();
    expect(mapCroatiaCamera(row({ latitude: 46.3, longitude: 16.4 }), new Set(['728']))).not.toBeNull();
    expect(mapCroatiaCamera(row({ latitude: 48.2, longitude: 16.37 }), new Set(['728']))).toBeNull();
    expect(mapCroatiaCamera(row({ image_url: 'https://kamere.dars.si/kamere/x/1.jpg' }), new Set(['728']))).toBeNull();
  });

  it('joins the manifest and every directory page', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('manifest')) {
        return Promise.resolve(Response.json({
          cameras: [
            { id: '728', lastImageAtUtc: new Date().toISOString(), imageUrl: '/info/kamere/728.jpg?v=1' },
            { id: '681', lastImageAtUtc: new Date().toISOString(), imageUrl: '/info/kamere/681.jpg?v=1' },
          ],
        }));
      }
      if (url.includes('&page=1')) {
        return Promise.resolve(Response.json({ cameras: [row()], meta: { total_pages: 2 } }));
      }
      return Promise.resolve(Response.json({
        cameras: [row({ name: 'Andrijevci', latitude: 45.2004, longitude: 18.3328, image_url: 'https://www.hak.hr/info/kamere/681.jpg' })],
        meta: { total_pages: 2 },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cams = await fetchCroatiaCameras();
    expect(cams.map(c => c.id)).toEqual(['hr-728', 'hr-681']);
  });

  it('fails when HAK cannot be read, so the last good list is kept', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
    await expect(fetchCroatiaCameras()).rejects.toThrow();
  });
});
