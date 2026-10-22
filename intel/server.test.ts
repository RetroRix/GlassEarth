import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

// The intel service is plain CommonJS; required here it exports its pieces without starting.
const intel = createRequire(import.meta.url)('./server.js');

afterEach(() => vi.unstubAllGlobals());

describe('normalizeId', () => {
  it('keeps accented and non-Latin names as written', () => {
    expect(intel.normalizeId('person', 'José Álvarez')).toBe('José Álvarez');
    expect(intel.normalizeId('company', 'Газпром')).toBe('Газпром');
  });

  it('keeps an IPv6 address whole and refuses what is not an address', () => {
    expect(intel.normalizeId('ip', '2001:4860:4860::8888')).toBe('2001:4860:4860::8888');
    expect(intel.normalizeId('ip', '8.8.8.8')).toBe('8.8.8.8');
    expect(intel.normalizeId('ip', '999.1.1.1')).toBeNull();
  });

  it('drops control characters from names', () => {
    expect(intel.normalizeId('person', 'Jane\u0000\nDoe')).toBe('Jane Doe');
  });
});

describe('sparqlString', () => {
  // Every quote left in the value must be escaped, and no backslash may remain that is not that escape.
  const closesLiteral = (s: string) => /(^|[^\\])"/.test(s) || /\\(?!")/.test(s);

  it('cannot close the literal it is placed in', () => {
    for (const attack of ['x" } UNION { ?s ?p ?o', 'x\\" }', 'x\\u0022 }', 'line\nbreak"', '\\\\"']) {
      expect(closesLiteral(intel.sparqlString(attack))).toBe(false);
    }
  });

  it('leaves ordinary names alone', () => {
    expect(intel.sparqlString("José Álvarez O'Brien")).toBe("José Álvarez O'Brien");
  });
});

describe('resolver cache', () => {
  beforeEach(() => intel.wdCache.clear());

  it('does not keep a result built while Wikidata was down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const down = await intel.RESOLVERS.company('Example Company');
    expect(down.degraded).toBe(true);
    expect(down.nodes).toHaveLength(0);

    // Wikidata is back: the next request asks it again instead of serving the empty graph.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('wbsearchentities')
      ? Response.json({ search: [{ id: 'Q42' }] })
      : Response.json({ results: { bindings: [{ countryLabel: { value: 'Norway' } }] } })));
    const up = await intel.RESOLVERS.company('Example Company');
    expect(up.degraded).toBe(false);
    expect(up.nodes.map((n: { id: string }) => n.id)).toContain('country:Norway');
  });
});
