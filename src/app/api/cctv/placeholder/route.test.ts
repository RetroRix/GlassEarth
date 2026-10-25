import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GET, classifySnapshotBuffer } from './route';

afterEach(() => vi.unstubAllGlobals());

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'lib',
  '__fixtures__',
  'placeholder',
);
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));
const request = (url: string) =>
  new Request(`http://localhost/api/cctv/placeholder?url=${encodeURIComponent(url)}`);

/* A public IP literal passes the SSRF guard without a DNS lookup, so the
   happy-path tests stay hermetic; fetch itself is mocked in every case. */
const CAM_URL = 'https://8.8.8.8/cam.jpg';

describe('classifySnapshotBuffer', () => {
  it('calls a captured placeholder a placeholder', async () => {
    for (const file of [
      'caltrans-temporarily-unavailable.jpg',
      'caltrans-down-for-construction-320.jpg',
      'caltrans-down-for-construction-432.jpg',
      'wsdot-unavailable-airport.jpg',
      'wsdot-unavailable-highway.jpg',
    ]) {
      const verdict = await classifySnapshotBuffer(fixture(file));
      expect(verdict.placeholder).toBe(true);
      expect(verdict.signature).not.toBeNull();
    }
  });

  it('calls a captured real frame a real frame', async () => {
    for (const file of [
      'real-wsdot-i82-horse-heaven.jpg',
      'real-caltrans-hwy5-cosumnes.jpg',
      'real-wsdot-i5-dusk.jpg',
    ]) {
      const verdict = await classifySnapshotBuffer(fixture(file));
      expect(verdict.placeholder).toBe(false);
      expect(verdict.distance).toBeGreaterThan(16);
    }
  });

  it('throws on undecodable bytes instead of inventing a verdict', async () => {
    await expect(classifySnapshotBuffer(Buffer.from('not an image at all'))).rejects.toThrow();
    await expect(classifySnapshotBuffer(Buffer.alloc(0))).rejects.toThrow();
  });
});

describe('GET /api/cctv/placeholder', () => {
  it('verdicts a placeholder snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(fixture('caltrans-temporarily-unavailable.jpg'), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    );
    const res = await GET(request(CAM_URL));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { placeholder: boolean; signature: string | null };
    expect(body.placeholder).toBe(true);
    expect(body.signature).toBe('caltrans-temporarily-unavailable');
  });

  it('verdicts a real frame as not a placeholder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(fixture('real-wsdot-i82-horse-heaven.jpg'), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    );
    const res = await GET(request(CAM_URL));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { placeholder: boolean }).placeholder).toBe(false);
  });

  it('rejects bad URLs before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const url of ['', 'not-a-url', 'http://8.8.8.8/cam.jpg', 'https://127.0.0.1/cam.jpg', 'https://localhost/cam.jpg']) {
      expect((await GET(request(url))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502, not a verdict, when the upstream fails or lies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    expect((await GET(request(CAM_URL))).status).toBe(502);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>error</html>', { status: 200 })));
    expect((await GET(request(CAM_URL))).status).toBe(502);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    expect((await GET(request(CAM_URL))).status).toBe(502);
  });
});
