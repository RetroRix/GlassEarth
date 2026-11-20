import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSloveniaCameras, mapSloveniaCamera, type SloveniaCameraRow } from './slovenia';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A camera row, verbatim in shape from the NAP catalogue API's answer. */
const row = (over: Partial<SloveniaCameraRow> = {}): SloveniaCameraRow => ({
  id: 6671127,
  name: '  R2-432, Rogatec - Majšperk, Stoperce ',
  latitude: 46.28915,
  longitude: 15.71613,
  image_url: 'https://kamere.dars.si/kamere/drsi_vgrc/Stoperce_stp1_0001.jpg',
  region_name: 'Savinjska',
  ...over,
});

describe('Slovenia DARS cameras', () => {
  it('maps a catalogue row to a camera, trimming the name and proxying the DARS picture', () => {
    expect(mapSloveniaCamera(row())).toEqual({
      id: 'si-6671127',
      lat: 46.28915,
      lng: 15.71613,
      name: 'R2-432, Rogatec - Majšperk, Stoperce',
      city: 'Savinjska',
      country: 'Slovenia',
      feed_url: '/api/cctv/proxy?url=https%3A%2F%2Fkamere.dars.si%2Fkamere%2Fdrsi_vgrc%2FStoperce_stp1_0001.jpg',
      source: 'DARS Slovenia',
    });
  });

  it('falls back to the country as city when the catalogue names no region', () => {
    expect(mapSloveniaCamera(row({ region_name: null }))?.city).toBe('Slovenia');
    expect(mapSloveniaCamera(row({ name: ' ' }))?.name).toBe('DARS camera');
  });

  it('drops rows without an id, a place in Slovenia or a DARS picture', () => {
    expect(mapSloveniaCamera(row({ id: undefined }))).toBeNull();
    expect(mapSloveniaCamera(row({ latitude: 48.2, longitude: 16.37 }))).toBeNull();
    expect(mapSloveniaCamera(row({ image_url: 'https://example.com/cam.jpg' }))).toBeNull();
    expect(mapSloveniaCamera(row({ image_url: 'https://kamere.dars.si/kamere/x/cam.png' }))).toBeNull();
    expect(mapSloveniaCamera(row({ image_url: null }))).toBeNull();
  });

  it('reads every catalogue page and dedupes by id', async () => {
    const page = (cameras: SloveniaCameraRow[], totalPages: number) =>
      Response.json({ cameras, meta: { total: 3, page: 1, per_page: 100, total_pages: totalPages } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page([row(), row({ id: 2, name: 'A1, Ljubljana - Koper, Vrhnika' })], 2))
      .mockResolvedValueOnce(page([row(), row({ id: 3, name: 'A2, Karavanke tunnel' })], 2));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cams = await fetchSloveniaCameras();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cams.map(c => c.id)).toEqual(['si-6671127', 'si-2', 'si-3']);
  });

  it('fails when the catalogue cannot be read, so the last good list is kept', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
    await expect(fetchSloveniaCameras()).rejects.toThrow();
  });
});
