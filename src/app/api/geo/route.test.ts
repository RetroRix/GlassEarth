import { afterEach, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const request = (headers: Record<string, string> = {}) => new Request('http://localhost/api/geo', { headers });
const ipapi = (lat: number, lon: number, city: string) =>
  Response.json({ ip: 'x', latitude: lat, longitude: lon, city, region: '', country_name: '', org: '' });

it('locates the visitor by their own address', async () => {
  const fetchMock = vi.fn().mockResolvedValue(ipapi(51.5, -0.13, 'London'));
  vi.stubGlobal('fetch', fetchMock);
  const res = await GET(request({ 'cf-connecting-ip': '81.2.69.142' }));
  const body = await res.json();
  expect(fetchMock.mock.calls[0][0]).toBe('https://ipapi.co/81.2.69.142/json/');
  expect(body).toMatchObject({ status: 'success', lat: 51.5, lon: -0.13, city: 'London' });
});

it('never lets a cache hand one visitor’s location to another', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ipapi(51.5, -0.13, 'London')));
  const res = await GET(request({ 'cf-connecting-ip': '81.2.69.142' }));
  expect(res.headers.get('cache-control')).toBe('private, no-store');
});

it('in production, does not fall back to locating the server when the visitor address is lost', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await GET(request({ 'x-real-ip': '172.18.0.5', 'x-forwarded-for': '10.0.0.4' }));
  expect(await res.json()).toMatchObject({ status: 'fail' });
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('in development, locates the developer’s own connection', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  const fetchMock = vi.fn().mockResolvedValue(ipapi(45.5, -73.6, 'Montreal'));
  vi.stubGlobal('fetch', fetchMock);
  await GET(request());
  expect(fetchMock.mock.calls[0][0]).toBe('https://ipapi.co/json/');
});

it('answers from the host geo headers without calling a provider', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = await GET(request({
    'x-vercel-ip-latitude': '31.7619',
    'x-vercel-ip-longitude': '-106.485',
    'x-vercel-ip-city': 'El%20Paso',
    'x-vercel-ip-country-region': 'TX',
    'x-vercel-ip-country': 'US',
  }));
  const body = await res.json();
  expect(body).toMatchObject({ status: 'success', lat: 31.7619, lon: -106.485, city: 'El Paso', regionName: 'TX', country: 'US' });
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('falls through to the providers when the host headers are unusable', async () => {
  const fetchMock = vi.fn().mockResolvedValue(ipapi(51.5, -0.13, 'London'));
  vi.stubGlobal('fetch', fetchMock);
  // Malformed latitude on one call, null-island coordinates on the next.
  await GET(request({ 'x-vercel-ip-latitude': 'not-a-number', 'x-vercel-ip-longitude': '-0.13', 'cf-connecting-ip': '81.2.69.142' }));
  expect(fetchMock).toHaveBeenCalled();
  fetchMock.mockClear();
  await GET(request({ 'x-vercel-ip-latitude': '0', 'x-vercel-ip-longitude': '0', 'cf-connecting-ip': '81.2.69.142' }));
  expect(fetchMock).toHaveBeenCalled();
});
