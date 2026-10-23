import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { normalizeId, sparqlString, RESOLVERS, wdCache } from './intel';

/* Ported from intel/server.test.ts — same cases against the in-process lib. */

afterEach(() => vi.unstubAllGlobals());

describe('normalizeId', () => {
  it('keeps accented and non-Latin names as written', () => {
    expect(normalizeId('person', 'José Álvarez')).toBe('José Álvarez');
    expect(normalizeId('company', 'Газпром')).toBe('Газпром');
  });

  it('keeps an IPv6 address whole and refuses what is not an address', () => {
    expect(normalizeId('ip', '2001:4860:4860::8888')).toBe('2001:4860:4860::8888');
    expect(normalizeId('ip', '8.8.8.8')).toBe('8.8.8.8');
    expect(normalizeId('ip', '999.1.1.1')).toBeNull();
  });

  it('drops control characters from names', () => {
    expect(normalizeId('person', 'Jane\u0000\nDoe')).toBe('Jane Doe');
  });
});

describe('sparqlString', () => {
  // Every quote left in the value must be escaped, and no backslash may remain that is not that escape.
  const closesLiteral = (s: string) => /(^|[^\\])"/.test(s) || /\\(?!")/.test(s);

  it('cannot close the literal it is placed in', () => {
    for (const attack of ['x" } UNION { ?s ?p ?o', 'x\\" }', 'x\\u0022 }', 'line\nbreak"', '\\\\"']) {
      expect(closesLiteral(sparqlString(attack))).toBe(false);
    }
  });

  it('leaves ordinary names alone', () => {
    expect(sparqlString("José Álvarez O'Brien")).toBe("José Álvarez O'Brien");
  });
});

describe('resolver cache', () => {
  beforeEach(() => wdCache.clear());

  it('does not keep a result built while Wikidata was down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const down = await RESOLVERS.company('Example Company');
    expect(down.degraded).toBe(true);
    expect(down.nodes).toHaveLength(0);

    // Wikidata is back: the next request asks it again instead of serving the empty graph.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('wbsearchentities')
      ? Response.json({ search: [{ id: 'Q42' }] })
      : Response.json({ results: { bindings: [{ countryLabel: { value: 'Norway' } }] } })));
    const up = await RESOLVERS.company('Example Company');
    expect(up.degraded).toBe(false);
    expect(up.nodes.map(n => n.id)).toContain('country:Norway');
  });
});
