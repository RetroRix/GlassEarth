import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchIrelandCameras, mapTiiCamera, type TiiFeature } from './ireland';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A TII camera feature, verbatim in shape from traffic.tii.ie's MapFeatures answer. */
const feature = (over: Partial<TiiFeature> = {}): TiiFeature => ({
  __typename: 'Camera',
  active: true,
  uri: 'camera/91',
  title: 'Reaghstown',
  features: [{ geometry: { coordinates: [-6.64806, 53.92972] } }],
  views: [{ category: 'IMAGE', url: 'https://irecam.carsprogram.org/Vaisala/1681_cam1.jpeg?1795204800000' }],
  ...over,
});

describe('Ireland TII cameras', () => {
  it('maps a TII camera feature to a camera', () => {
    expect(mapTiiCamera(feature())).toEqual({
      id: 'ie-camera-91',
      lat: 53.92972,
      lng: -6.64806,
      name: 'Reaghstown',
      city: 'Ireland',
      country: 'Ireland',
      feed_url: 'https://irecam.carsprogram.org/Vaisala/1681_cam1.jpeg?1795204800000',
      source: 'TII Ireland',
    });
  });

  it('drops inactive cameras, non-cameras and features with no place in Ireland', () => {
    expect(mapTiiCamera(feature({ active: false }))).toBeNull();
    expect(mapTiiCamera(feature({ __typename: 'WeatherStation' }))).toBeNull();
    expect(mapTiiCamera(feature({ features: [{ geometry: { coordinates: [-0.1, 51.5] } }] }))).toBeNull();
    expect(mapTiiCamera(feature({ features: [] }))).toBeNull();
    expect(mapTiiCamera(feature({ features: [{ geometry: { coordinates: ['x', 'y'] } }] }))).toBeNull();
  });

  it('drops cameras whose picture is not a JPEG on the TII camera host', () => {
    expect(mapTiiCamera(feature({ views: [{ category: 'IMAGE', url: 'https://example.com/cam.jpg' }] }))).toBeNull();
    expect(mapTiiCamera(feature({ views: [{ category: 'IMAGE', url: 'https://irecam.carsprogram.org/cam.png' }] }))).toBeNull();
    expect(mapTiiCamera(feature({ views: [] }))).toBeNull();
    /* A later IMAGE view is used when the first view is something else. */
    const twoViews = feature({
      views: [
        { category: 'VIDEO', url: 'https://irecam.carsprogram.org/clip.mp4' },
        { category: 'IMAGE', url: 'https://irecam.carsprogram.org/Vaisala/1_cam1.jpg' },
      ],
    });
    expect(mapTiiCamera(twoViews)?.feed_url).toBe('https://irecam.carsprogram.org/Vaisala/1_cam1.jpg');
  });

  it('reads the GraphQL answer, dedupes by uri, and keeps only cameras', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        mapFeaturesQuery: {
          mapFeatures: [
            feature(),
            feature(),
            feature({ uri: 'camera/92', title: 'Emyvale', features: [{ geometry: { coordinates: [-6.9, 54.3] } }] }),
            feature({ __typename: 'WeatherStation', uri: 'weather/1' }),
          ],
        },
      },
    }), { status: 200 })));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cams = await fetchIrelandCameras();
    expect(cams.map(c => c.id)).toEqual(['ie-camera-91', 'ie-camera-92']);
  });

  it('retries once when TII answers with an HTML page instead of JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<!DOCTYPE html><html>challenge</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { mapFeaturesQuery: { mapFeatures: [feature()] } },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cams = await fetchIrelandCameras();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cams.map(c => c.id)).toEqual(['ie-camera-91']);
  });

  it('fails when TII cannot be read, so the last good list is kept', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(fetchIrelandCameras()).rejects.toThrow();
  });
});
