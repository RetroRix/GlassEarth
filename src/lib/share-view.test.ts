import { describe, expect, it } from 'vitest';
import { buildShareUrl, decodeShareView, encodeShareParams } from './share-view';

describe('share view round-trip', () => {
  it('carries centre, zoom, bearing, pitch and camera through encode → decode', () => {
    const view = { lat: 31.7619, lng: -106.485, zoom: 9.25, bearing: 42.5, pitch: 20, cameraId: 'txdot-elp-123' };
    const decoded = decodeShareView(encodeShareParams(view).toString());
    expect(decoded).not.toBeNull();
    expect(decoded!.lat).toBeCloseTo(view.lat, 5);
    expect(decoded!.lng).toBeCloseTo(view.lng, 5);
    expect(decoded!.zoom).toBeCloseTo(view.zoom, 2);
    expect(decoded!.bearing).toBeCloseTo(view.bearing, 1);
    expect(decoded!.pitch).toBeCloseTo(view.pitch, 1);
    expect(decoded!.cameraId).toBe(view.cameraId);
  });

  it('builds a URL on the origin root with the encoded params', () => {
    const url = buildShareUrl('https://www.glassearthlive.com', { lat: 10, lng: 20, zoom: 5 });
    expect(url.startsWith('https://www.glassearthlive.com/?')).toBe(true);
    expect(decodeShareView(new URL(url).search)).toEqual({ lat: 10, lng: 20, zoom: 5 });
  });

  it('omits the defaults: no zoom, due-north bearing and flat pitch stay out of the link', () => {
    const params = encodeShareParams({ lat: 1, lng: 2, bearing: 0.2, pitch: 0 });
    expect(params.get('lat')).toBe('1.00000');
    expect(params.get('zoom')).toBeNull();
    expect(params.get('brg')).toBeNull();
    expect(params.get('pit')).toBeNull();
    expect(params.get('cam')).toBeNull();
  });

  it('keeps the layers parameter riding along when provided', () => {
    const params = encodeShareParams({ lat: 1, lng: 2 }, 'cctv,satellites');
    expect(params.get('layers')).toBe('cctv,satellites');
    expect(decodeShareView(params)?.lat).toBe(1);
  });

  it('wraps bearings into [0, 360) both ways', () => {
    expect(decodeShareView('lat=0&lon=0&brg=370')?.bearing).toBe(10);
    expect(decodeShareView('lat=0&lon=0&brg=-90')?.bearing).toBe(270);
  });
});

describe('share view decoding defences', () => {
  it('returns null when the centre is missing, unparseable or off the planet', () => {
    expect(decodeShareView('')).toBeNull();
    expect(decodeShareView('zoom=9')).toBeNull();
    expect(decodeShareView('lat=abc&lon=0')).toBeNull();
    expect(decodeShareView('lat=31.7')).toBeNull();
    expect(decodeShareView('lat=91&lon=0')).toBeNull();
    expect(decodeShareView('lat=0&lon=-181')).toBeNull();
    expect(decodeShareView('lat=&lon=')).toBeNull();
  });

  it('drops individually bad optional fields instead of failing the view', () => {
    const view = decodeShareView('lat=31.7&lon=-106.4&zoom=banana&brg=&pit=999&cam=not a camera!!');
    expect(view).toEqual({ lat: 31.7, lng: -106.4, pitch: 85 });
  });

  it('clamps zoom and pitch into the ranges the map can actually take', () => {
    expect(decodeShareView('lat=0&lon=0&zoom=99')?.zoom).toBe(20);
    expect(decodeShareView('lat=0&lon=0&zoom=0')?.zoom).toBe(0.5);
    expect(decodeShareView('lat=0&lon=0&pit=-5')?.pitch).toBe(0);
  });

  it('accepts the boundary coordinates themselves', () => {
    expect(decodeShareView('lat=-90&lon=180')).toEqual({ lat: -90, lng: 180 });
    expect(decodeShareView('lat=90&lon=-180')).toEqual({ lat: 90, lng: -180 });
  });
});
