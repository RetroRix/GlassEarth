import { afterEach, describe, expect, it, vi } from 'vitest';
import { stealthFetch } from '@/lib/stealthFetch';
import { fetchLondonCameras, mapTfLCamera, type TfLPlace } from './london';

vi.mock('@/lib/stealthFetch', () => ({ stealthFetch: vi.fn(), stealthHeaders: vi.fn(() => ({})) }));

afterEach(() => {
  vi.restoreAllMocks();
});

const place = (over: Partial<TfLPlace> = {}): TfLPlace => ({
  id: 'JamCams_00002.00865',
  commonName: 'A406 Billet Upass E',
  lat: 51.60067,
  lon: -0.01594,
  additionalProperties: [
    { key: 'available', value: 'true' },
    { key: 'imageUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg' },
    { key: 'videoUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.mp4' },
    { key: 'view', value: 'West' },
  ],
  ...over,
});

describe('London TfL JamCams', () => {
  it('maps a JamCam with its still and its MP4 clip', () => {
    expect(mapTfLCamera(place())).toEqual({
      id: 'tfl-JamCams_00002.00865',
      lat: 51.60067,
      lng: -0.01594,
      name: 'A406 Billet Upass E',
      city: 'London',
      country: 'UK',
      feed_url: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg',
      stream_url: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.mp4',
      stream_type: 'mp4',
      source: 'TfL',
    });
  });

  it('drops cameras TfL itself flags unavailable', () => {
    const off = place({
      additionalProperties: [
        { key: 'available', value: 'false' },
        { key: 'imageUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg' },
      ],
    });
    expect(mapTfLCamera(off)).toBeNull();
  });

  it('builds the still from the camera id when the list omits it, and drops rows with no place in London', () => {
    const bare = place({ additionalProperties: [{ key: 'available', value: 'true' }] });
    expect(mapTfLCamera(bare)?.feed_url).toBe('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg');
    expect(mapTfLCamera(bare)?.stream_url).toBeUndefined();
    expect(mapTfLCamera(place({ lat: 53.5, lon: -2.2 }))).toBeNull();
    expect(mapTfLCamera(place({ id: undefined }))).toBeNull();
    expect(mapTfLCamera(place({ lat: null }))).toBeNull();
  });

  it('ignores a picture or clip that does not point at the TfL bucket', () => {
    const foreign = place({
      additionalProperties: [
        { key: 'available', value: 'true' },
        { key: 'imageUrl', value: 'https://example.com/cam.jpg' },
        { key: 'videoUrl', value: 'https://example.com/cam.mp4' },
      ],
    });
    const cam = mapTfLCamera(foreign);
    expect(cam?.feed_url).toBe('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg');
    expect(cam?.stream_url).toBeUndefined();
  });

  it('reads the whole list and keeps only the available cameras', async () => {
    vi.mocked(stealthFetch).mockResolvedValue(Response.json([
      place(),
      place({ id: 'JamCams_00001.00001', commonName: 'Off Camera', additionalProperties: [{ key: 'available', value: 'false' }] }),
      place({ id: 'JamCams_00001.00002', commonName: 'Second Camera' }),
    ]));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cams = await fetchLondonCameras();
    expect(cams.map(c => c.id)).toEqual(['tfl-JamCams_00002.00865', 'tfl-JamCams_00001.00002']);
  });

  it('fails when TfL cannot be read, so the last good list is kept', async () => {
    vi.mocked(stealthFetch).mockResolvedValue(new Response('down', { status: 503 }));
    await expect(fetchLondonCameras()).rejects.toThrow();
  });
});
