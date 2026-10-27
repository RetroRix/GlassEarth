import { describe, expect, it } from 'vitest';
import {
  isUuid, licenseLabel, panoramaxPictureUrl, panoramaxViewerUrl, parseItemHref,
  transformPicture, transformSearchResults, MAX_PHOTOS_PER_FETCH,
} from './street-photos';

const PIC_ID = 'b626672b-df12-4e35-b8b1-32de98c79b83';
const COL_ID = '64065a9c-ea2b-42bc-bab8-069543494dda';
const PREV_ID = 'ff41c95d-51f8-43a2-a0b5-b5ef7941f8c3';
const NEXT_ID = '978e9ccd-3a62-4003-b863-ff06eadcfddf';

/** Trimmed from a real api.panoramax.xyz search result (Paris, IGN instance). */
const REAL_ITEM = {
  id: PIC_ID,
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [2.344961778, 48.867573472] },
  collection: COL_ID,
  providers: [
    { id: 'c95c30da-0d1e-4e2f-90ad-356a861e44e0', name: 'geovelo', roles: ['producer'] },
    { name: 'simon_geovelo', roles: ['producer'] },
  ],
  assets: {
    hd: { href: 'https://panoramax.ign.fr/api/pictures/b626672b-df12-4e35-b8b1-32de98c79b83/hd.jpg' },
    sd: { href: 'https://panoramax.ign.fr/api/pictures/b626672b-df12-4e35-b8b1-32de98c79b83/sd.jpg' },
    thumb: { href: 'https://panoramax.ign.fr/api/pictures/b626672b-df12-4e35-b8b1-32de98c79b83/thumb.jpg' },
  },
  links: [
    { rel: 'license', href: 'https://alliance.numerique.gouv.fr/licence-ouverte-open-licence/', title: 'License for this object (etalab-2.0)' },
    { rel: 'self', href: `https://api.panoramax.xyz/api/collections/${COL_ID}/items/${PIC_ID}` },
    { rel: 'prev', href: `https://api.panoramax.xyz/api/collections/${COL_ID}/items/${PREV_ID}` },
    { rel: 'next', href: `https://api.panoramax.xyz/api/collections/${COL_ID}/items/${NEXT_ID}` },
  ],
  properties: {
    datetime: '2017-11-05T10:55:25.501000+00:00',
    license: 'etalab-2.0',
    'view:azimuth': 248,
    'geovisio:producer': 'geovelo',
  },
};

describe('isUuid', () => {
  it('accepts real picture ids and rejects junk', () => {
    expect(isUuid(PIC_ID)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe('licenseLabel', () => {
  it('labels the licences the federation actually uses', () => {
    expect(licenseLabel('CC-BY-SA-4.0')).toBe('CC BY-SA 4.0');
    expect(licenseLabel('etalab-2.0')).toBe('Licence Ouverte / Open Licence 2.0');
  });
  it('passes unknown ids through raw and nulls absence', () => {
    expect(licenseLabel('ODbL-1.0')).toBe('ODbL-1.0');
    expect(licenseLabel('')).toBe(null);
    expect(licenseLabel(undefined)).toBe(null);
  });
});

describe('url builders', () => {
  it('builds meta-catalog picture and viewer urls from the id alone', () => {
    expect(panoramaxPictureUrl(PIC_ID, 'sd')).toBe(`https://api.panoramax.xyz/api/pictures/${PIC_ID}/sd.jpg`);
    expect(panoramaxViewerUrl(PIC_ID)).toBe(`https://api.panoramax.xyz/#focus=pic&pic=${PIC_ID}`);
  });
});

describe('parseItemHref', () => {
  it('extracts collection + picture ids from a STAC item href', () => {
    expect(parseItemHref(`https://api.panoramax.xyz/api/collections/${COL_ID}/items/${PREV_ID}`))
      .toEqual({ collectionId: COL_ID, pictureId: PREV_ID });
  });
  it('rejects non-item hrefs', () => {
    expect(parseItemHref('https://panoramax.ign.fr')).toBe(null);
    expect(parseItemHref(null)).toBe(null);
  });
});

describe('transformPicture', () => {
  it('carries capture date, contributor, licence and sequence neighbours verbatim', () => {
    const f = transformPicture(REAL_ITEM);
    expect(f).not.toBe(null);
    expect(f!.geometry.coordinates).toEqual([2.344961778, 48.867573472]);
    expect(f!.properties).toMatchObject({
      id: PIC_ID,
      capturedAt: '2017-11-05T10:55:25.501000+00:00',
      contributor: 'geovelo, simon_geovelo',
      license: 'etalab-2.0',
      licenseLabel: 'Licence Ouverte / Open Licence 2.0',
      licenseUrl: 'https://alliance.numerique.gouv.fr/licence-ouverte-open-licence/',
      azimuth: 248,
      collectionId: COL_ID,
      prevId: PREV_ID,
      prevCollection: COL_ID,
      nextId: NEXT_ID,
      nextCollection: COL_ID,
      sourceUrl: `https://api.panoramax.xyz/#focus=pic&pic=${PIC_ID}`,
    });
  });

  it('falls back to the producer property when providers are absent', () => {
    const bare = { ...REAL_ITEM, providers: undefined };
    expect(transformPicture(bare)!.properties.contributor).toBe('geovelo');
  });

  it('drops pictures with no geometry, bad id or no image asset', () => {
    expect(transformPicture({ ...REAL_ITEM, geometry: null })).toBe(null);
    expect(transformPicture({ ...REAL_ITEM, id: 'nope' })).toBe(null);
    expect(transformPicture({ ...REAL_ITEM, assets: {} })).toBe(null);
    expect(transformPicture(null)).toBe(null);
    expect(transformPicture('junk')).toBe(null);
  });

  it('keeps a CC BY-SA picture labelled as such', () => {
    const cc = { ...REAL_ITEM, properties: { ...REAL_ITEM.properties, license: 'CC-BY-SA-4.0' } };
    expect(transformPicture(cc)!.properties.licenseLabel).toBe('CC BY-SA 4.0');
  });

  it('nulls missing optional fields instead of inventing them', () => {
    const sparse = {
      id: PIC_ID,
      geometry: { type: 'Point', coordinates: [1, 2] },
      assets: { sd: { href: 'https://x/sd.jpg' } },
      properties: {},
    };
    const f = transformPicture(sparse)!;
    expect(f.properties.capturedAt).toBe(null);
    expect(f.properties.contributor).toBe(null);
    expect(f.properties.licenseLabel).toBe(null);
    expect(f.properties.azimuth).toBe(null);
    expect(f.properties.prevId).toBe(null);
    expect(f.properties.nextId).toBe(null);
  });
});

describe('transformSearchResults', () => {
  it('transforms a collection and skips broken features', () => {
    const body = { type: 'FeatureCollection', features: [REAL_ITEM, { id: 'broken' }, REAL_ITEM] };
    const out = transformSearchResults(body);
    expect(out).toHaveLength(2);
    expect(out[0].properties.id).toBe(PIC_ID);
  });

  it('caps the result count', () => {
    const many = { features: Array.from({ length: MAX_PHOTOS_PER_FETCH + 50 }, () => REAL_ITEM) };
    expect(transformSearchResults(many)).toHaveLength(MAX_PHOTOS_PER_FETCH);
    expect(transformSearchResults(many, 3)).toHaveLength(3);
  });

  it('returns empty for non-collection bodies (no-coverage areas)', () => {
    expect(transformSearchResults({ features: [] })).toEqual([]);
    expect(transformSearchResults({})).toEqual([]);
    expect(transformSearchResults(null)).toEqual([]);
  });
});
