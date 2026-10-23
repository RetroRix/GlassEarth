/**
 * OSIRIS — Intelligence Layer (entity resolution), in-process.
 *
 * Ported from the standalone `intel/` Express service (osiris-intel). The
 * sidecar was never deployed alongside the Vercel app — nothing in that
 * hosting can run a second long-lived process — so /api/entity/expand
 * proxied to a host that does not exist and answered 502 to every caller.
 * The resolvers themselves are framework-free (Wikidata SPARQL + ip-api +
 * RIPEstat, no keys, no state beyond an LRU cache), so they live here now
 * and the route calls them directly. `intel/` remains for Docker
 * self-hosters; on Vercel nothing external is required.
 *
 * Cache and semantics are the sidecar's: a graph is cached only when every
 * lookup behind it answered, and a partial answer is flagged `degraded`
 * rather than cached as "no relationships".
 */
import { isIP } from 'node:net';

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const WIKIDATA_UA = 'GlassEarth-Intel/1.0 (https://github.com/RetroRix/GlassEarth; ontology engine)';
const WIKIDATA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const WIKIDATA_CACHE_MAX = 10_000;

const ALLOWED_DOMAINS = new Set(['query.wikidata.org', 'www.wikidata.org', 'ip-api.com', 'stat.ripe.net']);

export interface IntelNode {
  id: string;
  label: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface IntelLink {
  source: string;
  target: string;
  label: string;
}

export interface IntelResult {
  nodes: IntelNode[];
  links: IntelLink[];
  degraded: boolean;
}

type Graph = { nodes: IntelNode[]; links: IntelLink[] };
type Binding = Record<string, { value?: string } | undefined>;

/* ── Wikidata LRU cache ───────────────────────────────────────────────────
   Pinned to globalThis so Next's dev-mode module reloading does not start
   a second cache, the same pattern the malware store uses. On serverless
   the cache is per-instance and ephemeral: losing it costs latency and
   Wikidata load, never correctness. */
const globalForIntel = globalThis as unknown as {
  osirisIntelCache?: Map<string, { data: Graph; ts: number }>;
};
export const wdCache: Map<string, { data: Graph; ts: number }> =
  (globalForIntel.osirisIntelCache ??= new Map());

function wdCacheGet(key: string): Graph | null {
  const entry = wdCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > WIKIDATA_CACHE_TTL) { wdCache.delete(key); return null; }
  wdCache.delete(key);
  wdCache.set(key, entry);
  return entry.data;
}

function wdCacheSet(key: string, data: Graph): void {
  if (wdCache.size >= WIKIDATA_CACHE_MAX) {
    const oldest = wdCache.keys().next().value;
    if (oldest) wdCache.delete(oldest);
  }
  wdCache.set(key, { data, ts: Date.now() });
}

/* ── Sanitisation (ported verbatim in behaviour) ────────────────────────── */

/** Control characters out, runs of whitespace collapsed. Letters of every script stay. */
export function cleanText(s: unknown): string {
  return String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The identifier a lookup of `type` should use, or null when it is not one.
 * Names keep their accents and scripts, an IP must be a real IPv4 or IPv6
 * address, and callsigns and registrations are ASCII by definition.
 */
export function normalizeId(type: string, raw: string): string | null {
  if (type === 'ip') return isIP(raw) ? raw : null;
  if (type === 'aircraft') return raw.replace(/[^a-zA-Z0-9-]/g, '') || null;
  return cleanText(raw) || null;
}

/**
 * A value made safe to place between double quotes in a SPARQL query.
 * Backslashes and control characters are dropped, and quotes are escaped,
 * so the value cannot close the literal.
 */
export function sparqlString(s: unknown): string {
  return String(s).replace(/[\u0000-\u001f\u007f\\]/g, '').replace(/"/g, '\\"');
}

/* ── Wikidata ───────────────────────────────────────────────────────────── */

/** Runs a query. Throws when Wikidata does not answer, so a failure is never read as "no results". */
async function sparql(query: string): Promise<Binding[]> {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  if (!ALLOWED_DOMAINS.has(new URL(url).hostname)) {
    throw new Error(`Blocked domain: ${new URL(url).hostname}`);
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': WIKIDATA_UA, Accept: 'application/sparql-results+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL HTTP ${res.status}`);
  const json = await res.json();
  return json.results?.bindings || [];
}

/** Searches Wikidata for an entity by name. Returns its QID, or null when the search found nothing. */
async function wdSearch(query: string): Promise<string | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&limit=1&format=json`;
  if (!ALLOWED_DOMAINS.has(new URL(url).hostname)) throw new Error(`Blocked domain: ${new URL(url).hostname}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': WIKIDATA_UA },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Wikidata search HTTP ${res.status}`);
  const json = await res.json();
  const id = json.search?.[0]?.id;
  // It goes into the query as wd:<id>, so only a QID shape is taken.
  return typeof id === 'string' && /^Q\d+$/.test(id) ? id : null;
}

/* ── Resolvers ──────────────────────────────────────────────────────────── */

function dedup(nodes: IntelNode[], links: IntelLink[]): Graph {
  const seen = new Set<string>();
  const uNodes: IntelNode[] = [];
  for (const n of nodes) { if (!seen.has(n.id)) { seen.add(n.id); uNodes.push(n); } }
  const lSeen = new Set<string>();
  const uLinks: IntelLink[] = [];
  for (const l of links) {
    const k = `${l.source}→${l.target}→${l.label}`;
    if (!lSeen.has(k)) { lSeen.add(k); uLinks.push(l); }
  }
  return { nodes: uNodes, links: uLinks };
}

/**
 * Caches a resolved graph only when every lookup behind it answered. A
 * provider outage is retried on the next request instead of being served as
 * "no relationships" for a day; the caller is told the answer is partial.
 */
function finish(cacheKey: string, result: Graph, failed: boolean): IntelResult {
  if (!failed) wdCacheSet(cacheKey, result);
  return { ...result, degraded: failed };
}

export interface AircraftProps {
  registration?: string;
  model?: string;
  icao24?: string;
}

async function resolveAircraft(id: string, properties: AircraftProps = {}): Promise<IntelResult> {
  const rootId = `aircraft:${id}`;
  const nodes: IntelNode[] = [], links: IntelLink[] = [];
  const cacheKey = `aircraft:${id}:${properties.registration || ''}`;
  const cached = wdCacheGet(cacheKey);
  if (cached) return { ...cached, degraded: false };
  let failed = false;

  const callsign = id.toUpperCase().trim();
  const registration = (properties.registration || '').toUpperCase().trim();
  const model = properties.model || '';

  // Step 1: Decode ICAO airline prefix from callsign (e.g. TRK → Turkish Airlines)
  const airlinePrefix = callsign.replace(/[0-9]+$/, '');
  let airlineName: string | null = null;

  if (airlinePrefix && airlinePrefix.length >= 2) {
    try {
      const results = await sparql(`
        SELECT ?item ?itemLabel ?countryLabel ?ceoLabel ?parentLabel WHERE {
          ?item wdt:P230 "${sparqlString(airlinePrefix)}" .
          OPTIONAL { ?item wdt:P17 ?country . }
          OPTIONAL { ?item wdt:P169 ?ceo . }
          OPTIONAL { ?item wdt:P749 ?parent . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
        } LIMIT 5`);

      for (const r of results) {
        if (r.itemLabel?.value) {
          airlineName = r.itemLabel.value;
          const airId = `company:${airlineName}`;
          nodes.push({ id: airId, label: airlineName, type: 'company', properties: { icao_code: airlinePrefix, source: 'Wikidata' } });
          links.push({ source: rootId, target: airId, label: 'OPERATED BY' });

          if (r.countryLabel?.value) {
            const cid = `country:${r.countryLabel.value}`;
            nodes.push({ id: cid, label: r.countryLabel.value, type: 'country', properties: { source: 'Wikidata' } });
            links.push({ source: airId, target: cid, label: 'HEADQUARTERED' });
          }
          if (r.ceoLabel?.value) {
            const pid = `person:${r.ceoLabel.value}`;
            nodes.push({ id: pid, label: r.ceoLabel.value, type: 'person', properties: { role: 'CEO', source: 'Wikidata' } });
            links.push({ source: airId, target: pid, label: 'CEO' });
          }
          if (r.parentLabel?.value) {
            const pid = `company:${r.parentLabel.value}`;
            nodes.push({ id: pid, label: r.parentLabel.value, type: 'company', properties: { source: 'Wikidata' } });
            links.push({ source: airId, target: pid, label: 'PARENT ORG' });
          }
        }
      }
    } catch (e) { failed = true; console.warn('[INTEL] Airline ICAO lookup error:', e instanceof Error ? e.message : e); }
  }

  // Step 2: Decode registration prefix → country (e.g. TC → Turkey, N → USA, G → UK)
  const REG_PREFIXES: Record<string, string> = {
    'N': 'United States', 'G': 'United Kingdom', 'F': 'France', 'D': 'Germany', 'I': 'Italy',
    'JA': 'Japan', 'HL': 'South Korea', 'B': 'China', 'VT': 'India', 'TC': 'Turkey',
    'SU': 'Russia', 'RA': 'Russia', 'UR': 'Ukraine', 'A6': 'UAE', 'A7': 'Qatar', '9V': 'Singapore',
    'VH': 'Australia', 'C': 'Canada', 'PP': 'Brazil', 'PR': 'Brazil', 'PT': 'Brazil',
    'EC': 'Spain', 'HS': 'Thailand', '9M': 'Malaysia', 'PK': 'Pakistan',
    'EP': 'Iran', 'YI': 'Iraq', 'HZ': 'Saudi Arabia', '4X': 'Israel', 'SX': 'Greece',
    'OE': 'Austria', 'HB': 'Switzerland', 'SE': 'Sweden', 'OH': 'Finland', 'LN': 'Norway',
    'OY': 'Denmark', 'PH': 'Netherlands', 'OO': 'Belgium', 'CS': 'Portugal', 'SP': 'Poland',
    'OK': 'Czech Republic', 'HA': 'Hungary', 'YR': 'Romania', 'LZ': 'Bulgaria',
    'EI': 'Ireland', 'EW': 'Belarus', 'ES': 'Estonia', 'YL': 'Latvia', 'LY': 'Lithuania',
  };
  // NOTE: as in the sidecar's table, a duplicate 'PH' key resolves to
  // Netherlands (PH- is the Dutch registration prefix).

  if (registration) {
    let regCountry: string | null = null;
    if (REG_PREFIXES[registration.substring(0, 2)]) regCountry = REG_PREFIXES[registration.substring(0, 2)];
    else if (REG_PREFIXES[registration.substring(0, 1)]) regCountry = REG_PREFIXES[registration.substring(0, 1)];

    if (regCountry) {
      const cid = `country:${regCountry}`;
      nodes.push({ id: cid, label: regCountry, type: 'country', properties: { source: 'Registration prefix' } });
      links.push({ source: rootId, target: cid, label: 'REGISTERED IN' });
    }
  }

  // Step 3: Add aircraft model info
  if (model) {
    const mid = `aircraft:model:${model}`;
    nodes.push({ id: mid, label: model, type: 'aircraft', properties: { type: 'model', source: 'ADS-B' } });
    links.push({ source: rootId, target: mid, label: 'AIRCRAFT TYPE' });
  }

  return finish(cacheKey, dedup(nodes, links), failed);
}

async function resolveVessel(id: string): Promise<IntelResult> {
  const rootId = `vessel:${id}`;
  const nodes: IntelNode[] = [], links: IntelLink[] = [];
  const cached = wdCacheGet(`vessel:${id}`);
  if (cached) return { ...cached, degraded: false };
  let failed = false;

  try {
    const results = await sparql(`
      SELECT ?item ?itemLabel ?ownerLabel ?countryLabel ?operatorLabel ?flagLabel WHERE {
        { ?item wdt:P458 "${sparqlString(id)}" . }
        UNION { ?item rdfs:label "${sparqlString(id)}"@en . ?item wdt:P31/wdt:P279* wd:Q11446 . }
        OPTIONAL { ?item wdt:P127 ?owner . }
        OPTIONAL { ?item wdt:P17 ?country . }
        OPTIONAL { ?item wdt:P137 ?operator . }
        OPTIONAL { ?item wdt:P8047 ?flag . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
      } LIMIT 10`);
    for (const r of results) {
      if (r.ownerLabel?.value) {
        const oid = `company:${r.ownerLabel.value}`;
        nodes.push({ id: oid, label: r.ownerLabel.value, type: 'company', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: oid, label: 'OWNED BY' });
      }
      const flag = r.flagLabel?.value || r.countryLabel?.value;
      if (flag) {
        const cid = `country:${flag}`;
        nodes.push({ id: cid, label: flag, type: 'country', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: cid, label: 'FLAG STATE' });
      }
      if (r.operatorLabel?.value) {
        const oid = `company:${r.operatorLabel.value}`;
        nodes.push({ id: oid, label: r.operatorLabel.value, type: 'company', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: oid, label: 'OPERATED BY' });
      }
    }
  } catch (e) { failed = true; console.warn('[INTEL] Wikidata vessel error:', e instanceof Error ? e.message : e); }
  return finish(`vessel:${id}`, dedup(nodes, links), failed);
}

async function resolveCompany(id: string): Promise<IntelResult> {
  const rootId = `company:${id}`;
  const nodes: IntelNode[] = [], links: IntelLink[] = [];
  const cached = wdCacheGet(`company:${id}`);
  if (cached) return { ...cached, degraded: false };
  let failed = false;

  try {
    const qid = await wdSearch(id);
    const filter = qid
      ? `VALUES ?item { wd:${qid} }`
      : `?item rdfs:label "${sparqlString(id)}"@en . { ?item wdt:P31/wdt:P279* wd:Q4830453 . } UNION { ?item wdt:P31/wdt:P279* wd:Q43229 . }`;
    const results = await sparql(`
      SELECT ?item ?itemLabel ?countryLabel ?parentLabel ?ceoLabel ?industryLabel WHERE {
        ${filter}
        OPTIONAL { ?item wdt:P17 ?country . }
        OPTIONAL { ?item wdt:P749 ?parent . }
        OPTIONAL { ?item wdt:P169 ?ceo . }
        OPTIONAL { ?item wdt:P452 ?industry . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
      } LIMIT 10`);
    for (const r of results) {
      if (r.countryLabel?.value) {
        const cid = `country:${r.countryLabel.value}`;
        nodes.push({ id: cid, label: r.countryLabel.value, type: 'country', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: cid, label: 'HEADQUARTERED' });
      }
      if (r.parentLabel?.value) {
        const pid = `company:${r.parentLabel.value}`;
        nodes.push({ id: pid, label: r.parentLabel.value, type: 'company', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: pid, label: 'PARENT ORG' });
      }
      if (r.ceoLabel?.value) {
        const pid = `person:${r.ceoLabel.value}`;
        nodes.push({ id: pid, label: r.ceoLabel.value, type: 'person', properties: { role: 'CEO', source: 'Wikidata' } });
        links.push({ source: rootId, target: pid, label: 'CEO' });
      }
    }
  } catch (e) { failed = true; console.warn('[INTEL] Wikidata company error:', e instanceof Error ? e.message : e); }
  return finish(`company:${id}`, dedup(nodes, links), failed);
}

async function resolvePerson(id: string): Promise<IntelResult> {
  const rootId = `person:${id}`;
  const nodes: IntelNode[] = [], links: IntelLink[] = [];
  const cached = wdCacheGet(`person:${id}`);
  if (cached) return { ...cached, degraded: false };
  let failed = false;

  try {
    const qid = await wdSearch(id);
    const filter = qid
      ? `VALUES ?item { wd:${qid} }`
      : `?item rdfs:label "${sparqlString(id)}"@en . ?item wdt:P31 wd:Q5 .`;
    const results = await sparql(`
      SELECT ?item ?itemLabel ?nationalityLabel ?employerLabel ?positionLabel WHERE {
        ${filter}
        OPTIONAL { ?item wdt:P27 ?nationality . }
        OPTIONAL { ?item wdt:P108 ?employer . }
        OPTIONAL { ?item wdt:P39 ?position . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
      } LIMIT 10`);
    for (const r of results) {
      if (r.nationalityLabel?.value) {
        const cid = `country:${r.nationalityLabel.value}`;
        nodes.push({ id: cid, label: r.nationalityLabel.value, type: 'country', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: cid, label: 'NATIONALITY' });
      }
      if (r.employerLabel?.value) {
        const eid = `company:${r.employerLabel.value}`;
        nodes.push({ id: eid, label: r.employerLabel.value, type: 'company', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: eid, label: 'EMPLOYER' });
      }
      if (r.positionLabel?.value) {
        const pid = `event:${r.positionLabel.value}`;
        nodes.push({ id: pid, label: r.positionLabel.value, type: 'event', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: pid, label: 'POSITION HELD' });
      }
    }
  } catch (e) { failed = true; console.warn('[INTEL] Wikidata person error:', e instanceof Error ? e.message : e); }
  return finish(`person:${id}`, dedup(nodes, links), failed);
}

async function resolveIP(id: string): Promise<IntelResult> {
  const rootId = `ip:${id}`;
  const nodes: IntelNode[] = [], links: IntelLink[] = [];
  const cached = wdCacheGet(`ip:${id}`);
  if (cached) return { ...cached, degraded: false };
  const state = { failed: false };

  /* The four lookups are independent — the sidecar ran them in series for
     a ~32s worst case, most of the proxy timeout's budget. Run together,
     the worst case is one 8s timeout. Each step records its own failure. */
  const stepIpApi = async () => {
    try {
      const ipApiUrl = `http://ip-api.com/json/${encodeURIComponent(id)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting`;
      if (!ALLOWED_DOMAINS.has(new URL(ipApiUrl).hostname)) throw new Error('Blocked domain: ip-api.com');
      const res = await fetch(ipApiUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { state.failed = true; return; }
      const data = await res.json();
      if (data.status === 'success') {
        if (data.isp) {
          const ispId = `company:${data.isp}`;
          nodes.push({ id: ispId, label: data.isp, type: 'company', properties: { role: 'ISP', org: data.org || '', source: 'ip-api.com' } });
          links.push({ source: rootId, target: ispId, label: 'HOSTED_BY' });
        }
        if (data.as) {
          const asLabel = data.asname || data.as;
          const asId = `company:${data.as}`;
          nodes.push({ id: asId, label: asLabel, type: 'company', properties: { as_number: data.as, source: 'ip-api.com' } });
          links.push({ source: rootId, target: asId, label: 'ASN' });
        }
        if (data.country) {
          const cid = `country:${data.country}`;
          nodes.push({ id: cid, label: data.country, type: 'country', properties: { code: data.countryCode || '', source: 'ip-api.com' } });
          links.push({ source: rootId, target: cid, label: 'LOCATED_IN' });
        }
        if (data.city) {
          const cityId = `event:${data.city}`;
          nodes.push({
            id: cityId, label: data.city, type: 'event',
            properties: {
              lat: data.lat, lon: data.lon, region: data.regionName || '',
              zip: data.zip || '', timezone: data.timezone || '', source: 'ip-api.com',
            },
          });
          links.push({ source: rootId, target: cityId, label: 'GEOLOCATED' });
        }
        nodes.push({
          id: rootId, label: id, type: 'ip',
          properties: {
            proxy: !!data.proxy, hosting: !!data.hosting, mobile: !!data.mobile,
            source: 'ip-api.com',
          },
        });
      }
    } catch (e) { state.failed = true; console.warn('[INTEL] ip-api.com error:', e instanceof Error ? e.message : e); }
  };

  const stepWhois = async () => {
    try {
      const whoisUrl = `https://stat.ripe.net/data/whois/data.json?resource=${encodeURIComponent(id)}`;
      if (!ALLOWED_DOMAINS.has(new URL(whoisUrl).hostname)) throw new Error('Blocked domain: stat.ripe.net');
      const res = await fetch(whoisUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { state.failed = true; return; }
      const json = await res.json();
      const records = json.data?.records || [];
      for (const record of records) {
        for (const field of record) {
          if (field.key === 'netname' || field.key === 'NetName') {
            const netId = `company:${field.value}`;
            nodes.push({ id: netId, label: field.value, type: 'company', properties: { role: 'Network', source: 'RIPEstat WHOIS' } });
            links.push({ source: rootId, target: netId, label: 'HOSTED_BY' });
          }
        }
      }
    } catch (e) { state.failed = true; console.warn('[INTEL] RIPEstat WHOIS error:', e instanceof Error ? e.message : e); }
  };

  const stepAbuse = async () => {
    try {
      const abuseUrl = `https://stat.ripe.net/data/abuse-contact-finder/data.json?resource=${encodeURIComponent(id)}`;
      if (!ALLOWED_DOMAINS.has(new URL(abuseUrl).hostname)) throw new Error('Blocked domain: stat.ripe.net');
      const res = await fetch(abuseUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { state.failed = true; return; }
      const json = await res.json();
      const contacts = json.data?.abuse_contacts || [];
      for (const email of contacts) {
        if (email) {
          const eid = `person:${email}`;
          nodes.push({ id: eid, label: email, type: 'person', properties: { role: 'Abuse Contact', source: 'RIPEstat' } });
          links.push({ source: rootId, target: eid, label: 'ABUSE CONTACT' });
        }
      }
    } catch (e) { state.failed = true; console.warn('[INTEL] RIPEstat abuse-contact error:', e instanceof Error ? e.message : e); }
  };

  const stepNetInfo = async () => {
    try {
      const netUrl = `https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(id)}`;
      if (!ALLOWED_DOMAINS.has(new URL(netUrl).hostname)) throw new Error('Blocked domain: stat.ripe.net');
      const res = await fetch(netUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { state.failed = true; return; }
      const json = await res.json();
      const prefix = json.data?.prefix;
      const asns = json.data?.asns || [];
      if (prefix) {
        const prefId = `ip:${prefix}`;
        nodes.push({ id: prefId, label: prefix, type: 'ip', properties: { role: 'Prefix', source: 'RIPEstat' } });
        links.push({ source: rootId, target: prefId, label: 'PREFIX' });
      }
      for (const asn of asns) {
        const asnId = `company:AS${asn}`;
        nodes.push({ id: asnId, label: `AS${asn}`, type: 'company', properties: { as_number: `AS${asn}`, source: 'RIPEstat' } });
        links.push({ source: rootId, target: asnId, label: 'ASN' });
      }
    } catch (e) { state.failed = true; console.warn('[INTEL] RIPEstat network-info error:', e instanceof Error ? e.message : e); }
  };

  await Promise.all([stepIpApi(), stepWhois(), stepAbuse(), stepNetInfo()]);
  return finish(`ip:${id}`, dedup(nodes, links), state.failed);
}

async function resolveCountry(id: string): Promise<IntelResult> {
  const rootId = `country:${id}`;
  const nodes: IntelNode[] = [], links: IntelLink[] = [];
  const cached = wdCacheGet(`country:${id}`);
  if (cached) return { ...cached, degraded: false };
  let failed = false;

  try {
    const qid = await wdSearch(id);
    const filter = qid
      ? `VALUES ?item { wd:${qid} }`
      : `?item rdfs:label "${sparqlString(id)}"@en . ?item wdt:P31 wd:Q6256 .`;
    const results = await sparql(`
      SELECT ?item ?itemLabel ?headLabel ?capitalLabel ?population ?gdp
             ?tld ?callingCode ?memberOfLabel ?neighborLabel WHERE {
        ${filter}
        OPTIONAL { ?item wdt:P35 ?head . }
        OPTIONAL { ?item wdt:P36 ?capital . }
        OPTIONAL { ?item wdt:P1082 ?population . }
        OPTIONAL { ?item wdt:P2131 ?gdp . }
        OPTIONAL { ?item wdt:P78 ?tld . }
        OPTIONAL { ?item wdt:P474 ?callingCode . }
        OPTIONAL { ?item wdt:P463 ?memberOf . }
        OPTIONAL { ?item wdt:P47 ?neighbor . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
      } LIMIT 50`);

    const seenHeads = new Set<string>();
    const seenMembers = new Set<string>();
    const seenNeighbors = new Set<string>();
    let propsSet = false;

    for (const r of results) {
      if (r.headLabel?.value && !seenHeads.has(r.headLabel.value)) {
        seenHeads.add(r.headLabel.value);
        const hid = `person:${r.headLabel.value}`;
        nodes.push({ id: hid, label: r.headLabel.value, type: 'person', properties: { role: 'Head of State', source: 'Wikidata' } });
        links.push({ source: rootId, target: hid, label: 'HEAD OF STATE' });
      }

      if (r.capitalLabel?.value && !propsSet) {
        const capId = `event:${r.capitalLabel.value}`;
        nodes.push({ id: capId, label: r.capitalLabel.value, type: 'event', properties: { role: 'Capital', source: 'Wikidata' } });
        links.push({ source: rootId, target: capId, label: 'CAPITAL' });
      }

      if (!propsSet) {
        const props: Record<string, unknown> = { source: 'Wikidata' };
        if (r.population?.value) props.population = r.population.value;
        if (r.gdp?.value) props.gdp = r.gdp.value;
        if (r.tld?.value) props.tld = r.tld.value;
        if (r.callingCode?.value) props.calling_code = r.callingCode.value;
        nodes.push({ id: rootId, label: id, type: 'country', properties: props });
        propsSet = true;
      }

      if (r.memberOfLabel?.value && !seenMembers.has(r.memberOfLabel.value)) {
        seenMembers.add(r.memberOfLabel.value);
        const mid = `company:${r.memberOfLabel.value}`;
        nodes.push({ id: mid, label: r.memberOfLabel.value, type: 'company', properties: { role: 'Organization', source: 'Wikidata' } });
        links.push({ source: rootId, target: mid, label: 'MEMBER OF' });
      }

      if (r.neighborLabel?.value && !seenNeighbors.has(r.neighborLabel.value)) {
        seenNeighbors.add(r.neighborLabel.value);
        const nid = `country:${r.neighborLabel.value}`;
        nodes.push({ id: nid, label: r.neighborLabel.value, type: 'country', properties: { source: 'Wikidata' } });
        links.push({ source: rootId, target: nid, label: 'NEIGHBOR' });
      }
    }
  } catch (e) { failed = true; console.warn('[INTEL] Wikidata country error:', e instanceof Error ? e.message : e); }
  return finish(`country:${id}`, dedup(nodes, links), failed);
}

export const RESOLVERS = {
  aircraft: resolveAircraft,
  vessel: resolveVessel,
  company: resolveCompany,
  person: resolvePerson,
  ip: resolveIP,
  country: resolveCountry,
} as const;

export type IntelEntityType = keyof typeof RESOLVERS;
export const ALLOWED_TYPES = new Set<string>(Object.keys(RESOLVERS));

/** Resolve one entity to its graph — the in-process successor of GET osiris-intel:/resolve. */
export async function resolveEntity(
  type: string,
  id: string,
  props: AircraftProps = {},
): Promise<IntelResult> {
  const resolver = RESOLVERS[type as IntelEntityType];
  if (!resolver) throw new Error(`Invalid type: ${type}`);
  return resolver(id, props);
}
