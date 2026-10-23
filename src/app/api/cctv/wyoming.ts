import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Wyoming CCTV Cameras (WYDOT / wyoroad.info)
 * Source: https://map.wyoroad.info/wti511map-data/Msg-FFBK373B.pbf — the
 * protobuf feed the Wyoming 511 map (map.wyoroad.info/511-map) loads its
 * Web Cameras layer from — NO API KEY NEEDED.
 * ~227 camera sites publishing ~758 directional stills.
 *
 * This is the most obfuscated feed on the map, and every layer of it is the
 * site's own doing, undone the site's own way:
 *
 *  • The map's bundle carries its feed URLs XOR-obfuscated — base64 of the
 *    address XORed against a repeating key that is printed in the same
 *    bundle. `deobfuscate` is that decoder, key included verbatim.
 *  • The feed itself is a small protobuf (`webcameras_v1_pkg`): a repeated
 *    site message with an int32 device id, an obfuscated site name, a
 *    repeated image message, and longitude/latitude as doubles in fields
 *    8 and 9. `parseFeed` reads it with a hand-rolled wire reader — the
 *    schema is five fields and does not justify a protobuf dependency.
 *  • The strings inside are obfuscated with the same scheme: site name,
 *    image label, and the image address — a tokenised
 *    `wyoroad.info/web-cam/cache?ref=…` URL that serves a plain JPEG
 *    (verified). The tokens are stable; the feed file is regenerated
 *    whole and is byte-identical between fetches minutes apart.
 */

const FEED_URL = 'https://map.wyoroad.info/wti511map-data/Msg-FFBK373B.pbf';

/** Wyoming bounding box — drops any stray/placeholder coordinates. */
const WY_BOUNDS = { minLat: 40.9, maxLat: 45.0, minLng: -111.1, maxLng: -104.0 };

/** The XOR key the 511 map's own bundle decodes its strings with. */
const XOR_KEY = new TextEncoder().encode('EkhJp6wsgahsqkiw5nahFOSCwAND1zhZ');

/** Undo the bundle's string obfuscation: base64, then XOR with the key. Exported for tests. */
export function deobfuscate(encoded: string): string {
  const bin = atob(encoded.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i) ^ XOR_KEY[i % XOR_KEY.length];
  }
  return new TextDecoder().decode(bytes);
}

export interface WydotImage {
  id: number;
  label: string;
  url: string;
}

export interface WydotSite {
  deviceId: number;
  name: string;
  lat: number;
  lng: number;
  images: WydotImage[];
}

/** A minimal protobuf wire reader — just the types this feed uses. */
class Reader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.buf[this.pos++];
      result += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return result;
      shift += 7;
    }
  }

  bytes(): Uint8Array {
    const len = this.varint();
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  text(): string {
    return new TextDecoder().decode(this.bytes());
  }

  double(): number {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getFloat64(0, true);
  }

  skip(wireType: number): void {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.pos += 8;
    else if (wireType === 2) this.bytes();
    else if (wireType === 5) this.pos += 4;
    else throw new Error(`WYDOT feed: unknown wire type ${wireType}`);
  }
}

function parseImage(buf: Uint8Array): WydotImage {
  const r = new Reader(buf);
  let id = 0;
  let label = '';
  let url = '';
  while (!r.done) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 0) id = r.varint();
    else if (field === 2 && wire === 2) label = deobfuscate(r.text());
    else if (field === 3 && wire === 2) url = deobfuscate(r.text());
    else r.skip(wire);
  }
  return { id, label, url };
}

function parseSite(buf: Uint8Array): WydotSite {
  const r = new Reader(buf);
  let deviceId = 0;
  let name = '';
  let lng = 0;
  let lat = 0;
  const images: WydotImage[] = [];
  while (!r.done) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 0) deviceId = r.varint();
    else if (field === 2 && wire === 2) name = deobfuscate(r.text());
    else if (field === 3 && wire === 2) images.push(parseImage(r.bytes()));
    else if (field === 8 && wire === 1) lng = r.double();
    else if (field === 9 && wire === 1) lat = r.double();
    else r.skip(wire);
  }
  return { deviceId, name, lat, lng, images };
}

/** Decode the whole WebCamerasFeed. Exported for tests. */
export function parseFeed(data: Uint8Array): WydotSite[] {
  const r = new Reader(data);
  const sites: WydotSite[] = [];
  while (!r.done) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) sites.push(parseSite(r.bytes()));
    else r.skip(wire);
  }
  return sites;
}

/**
 * Map one site to its cameras — one per published image, possibly none.
 * Exported for tests.
 */
export function mapSite(site: WydotSite): CctvCamera[] {
  const { lat, lng } = site;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  if (lat < WY_BOUNDS.minLat || lat > WY_BOUNDS.maxLat) return [];
  if (lng < WY_BOUNDS.minLng || lng > WY_BOUNDS.maxLng) return [];

  const cams: CctvCamera[] = [];
  for (const img of site.images) {
    if (!/^https?:\/\//i.test(img.url)) continue;
    cams.push({
      id: `wydot-${site.deviceId}-${img.id}`,
      lat,
      lng,
      name: img.label.trim() || site.name || `WYDOT Camera ${site.deviceId}-${img.id}`,
      city: site.name.trim() || 'Wyoming',
      country: 'US',
      feed_url: img.url,
      source: 'WYDOT',
    });
  }
  return cams;
}

async function loadWyomingCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(FEED_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/x-protobuf' },
  });
  if (!res.ok) throw new Error(`WYDOT feed HTTP ${res.status}`);

  const sites = parseFeed(new Uint8Array(await res.arrayBuffer()));
  if (!sites.length) throw new Error('WYDOT feed decoded to no sites');

  const cams: CctvCamera[] = [];
  for (const site of sites) cams.push(...mapSite(site));

  console.log(`[OSIRIS] Wyoming cameras — WYDOT: ${cams.length} images from ${sites.length} sites`);
  return cams;
}

export const fetchWyomingCameras = cachedSource('wyoming', loadWyomingCameras);
