import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { cachedSource } from '@/lib/sourceCache';
import { fingerprint, htmlToText, splitHeadline, type NewsPost } from '@/lib/news-post';
import type { Bloc } from '@/lib/alert-digest';
import { alertKind, budgetedLookup, locateReport, type AlertKind, type AlertPlace } from '@/lib/alert-places';

/**
 * Glass Earth — Live Alerts news feed.
 *
 * Reads wire services and national newsrooms over RSS into one feed. A story
 * carried by several of them folds into one report that names them all.
 *
 * Each source is cached on its own for a few minutes, so a busy dashboard
 * costs an upstream one request per window however many tabs are open, and a
 * source that fails a refresh keeps serving its last good items instead of
 * emptying the feed.
 */

interface Feed { handle: string; name: string; lean: string; bloc: Bloc }

/*
 * Wire services and national newsrooms, labelled for who runs them — a state
 * broadcaster is a state broadcaster whatever it is reporting. `lean` and
 * `bloc` travel with every item to the UI: a partisan field report is still a
 * partisan source, and is labelled as one.
 *
 * Checked 2026-09-20: each answers, carries at least ten items, and its newest
 * item was under an hour old. Left out because they do not: Reuters (feed
 * retired), AP and Al Arabiya (403 to any reader), Xinhua and NHK (404),
 * France 24 (empty), Jerusalem Post (items dated 2025).
 */
const WIRE_FEEDS: (Feed & { url: string })[] = [
  { handle: 'bbc',        url: 'https://feeds.bbci.co.uk/news/world/rss.xml',        name: 'BBC World',        lean: 'British public broadcaster',   bloc: 'western' },
  { handle: 'guardian',   url: 'https://www.theguardian.com/world/rss',              name: 'The Guardian',     lean: 'British newsroom',             bloc: 'western' },
  { handle: 'aljazeera',  url: 'https://www.aljazeera.com/xml/rss/all.xml',          name: 'Al Jazeera',       lean: 'Qatari broadcaster',           bloc: 'regional' },
  { handle: 'timesofisrael', url: 'https://www.timesofisrael.com/feed/',             name: 'Times of Israel',  lean: 'Israeli newsroom',             bloc: 'regional' },
  { handle: 'tass',       url: 'https://tass.com/rss/v2.xml',                        name: 'TASS',             lean: 'Russian state agency',         bloc: 'russian' },
  { handle: 'anadolu',    url: 'https://www.aa.com.tr/en/rss/default?cat=world',     name: 'Anadolu Agency',   lean: 'Turkish state agency',         bloc: 'regional' },
  { handle: 'scmp',       url: 'https://www.scmp.com/rss/91/feed',                   name: 'SCMP',             lean: 'Hong Kong newsroom',           bloc: 'regional' },
  { handle: 'cna',        url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', name: 'CNA', lean: 'Singaporean broadcaster', bloc: 'regional' },
  { handle: 'africanews', url: 'https://www.africanews.com/feed/rss',                name: 'Africanews',       lean: 'Pan-African newsroom',         bloc: 'regional' },
];

const POSTS_PER_SOURCE = 8;
/** A wire publishes far more than the feed shows, so each contributes fewer items. */
const ITEMS_PER_WIRE = 5;
const WIRE_TTL_MS = 5 * 60_000;
/** A live feed shows live posts: anything older is left out, however quiet the source. */
export const MAX_POST_AGE_MS = 72 * 3_600_000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const RISK_KEYWORDS = ['war','missile','strike','attack','crisis','tension','military','conflict','defense','clash','nuclear','invasion','bomb','drone','weapon','sanctions','ceasefire','escalation', 'killed', 'destroyed', 'operation', 'casualty', 'frontline', 'threat'];

/* Whole words, plus plural and verb endings. Substring matching scored
   "award", "software" and "warning" as war, "cooperation" as an operation and
   "Bombay" as a bomb. */
const RISK_PATTERNS = RISK_KEYWORDS.map(kw => ({
  kw,
  rx: new RegExp(`\\b${kw === 'casualty' ? 'casualt(?:y|ies)' : `${kw}(?:s|es|ed|ing)?`}\\b`, 'i'),
}));

const KEYWORD_COORDS: Record<string, [number, number]> = {
  'ukraine': [49.487, 31.272], 'kyiv': [50.450, 30.523], 'russia': [61.524, 105.318],
  'moscow': [55.755, 37.617], 'israel': [31.046, 34.851], 'gaza': [31.416, 34.333],
  'iran': [32.427, 53.688], 'lebanon': [33.854, 35.862], 'syria': [34.802, 38.996],
  'yemen': [15.552, 48.516], 'china': [35.861, 104.195], 'taiwan': [23.697, 120.960],
  'united states': [38.907, -77.036], 'europe': [48.800, 2.300], 'middle east': [31.500, 34.800]
};

/**
 * Counts risk keywords in the text. That is the whole method: one point of
 * base, two per distinct term matched, capped at 10.
 *
 * It used to ship its output labelled "AI Analysis indicates elevated tactical
 * priority based on OSINT stream patterns." No model is consulted and no
 * pattern is learned — the phrasing lent a word count the authority of an
 * analytical judgement. The matched terms now travel with the score so a
 * reader can see exactly what produced it.
 */
export function scoreRisk(text: string): { score: number; matched: string[] } {
  const matched = RISK_PATTERNS.filter(p => p.rx.test(text)).map(p => p.kw);
  return { score: Math.min(10, 1 + matched.length * 2), matched };
}

/**
 * Resolves a place name to its preset anchor — a country or territory
 * centroid, not the location of the reported event. An article about a strike
 * in Rafah resolves to the middle of Gaza, because that is the only thing a
 * keyword match can support. Callers get the term that matched so the marker
 * can be labelled for what it is.
 */
export function findCoords(text: string): { coords: [number, number]; anchor: string } | null {
  const lower = text.toLowerCase();
  for (const [keyword, coords] of Object.entries(KEYWORD_COORDS)) {
    if (lower.includes(keyword)) return { coords, anchor: keyword };
  }
  return null;
}

/** The newest posts inside the live window, newest last as the source lists them. */
export function recentPosts(posts: NewsPost[], now = Date.now()): NewsPost[] {
  return posts
    .filter(p => now - Date.parse(p.publishedAt) <= MAX_POST_AGE_MS)
    .slice(-POSTS_PER_SOURCE);
}

export interface FeedPost { post: NewsPost; source: Feed & { url: string } }

/**
 * Folds the same report carried by several sources into one story: the
 * earliest post leads and the others are listed as carrying it. Cross-posts
 * are the common case, so this records who carried a story, not who
 * confirmed it.
 */
export function mergeCrossPosts(posts: FeedPost[]): { lead: FeedPost; carriedBy: FeedPost[] }[] {
  const byKey = new Map<string, FeedPost[]>();
  for (const p of posts) {
    const fp = fingerprint(p.post.text);
    // Too short to tell two different posts apart ("Video", "Map update").
    const key = fp.split(' ').length >= 6 ? fp : `id:${p.post.id}`;
    byKey.set(key, [...(byKey.get(key) || []), p]);
  }
  return [...byKey.values()].map(group => {
    const [lead, ...rest] = [...group].sort((a, b) => Date.parse(a.post.publishedAt) - Date.parse(b.post.publishedAt));
    // A source reposting itself is not a second source carrying the story.
    const seen = new Set([lead.source.handle]);
    const carriedBy = rest.filter(c => {
      if (seen.has(c.source.handle)) return false;
      seen.add(c.source.handle);
      return true;
    });
    return { lead, carriedBy };
  });
}

/**
 * A wire item in the shape the rest of the route already speaks, so a story
 * from BBC and the same story from Al Jazeera fold together exactly as two
 * sources carrying one report do, and every consumer downstream — the cards,
 * the threads, the place lookup — needs no branch for where an item came from.
 */
export function wirePost(item: RssItem, feed: Feed): NewsPost {
  const text = item.description && item.description !== item.title
    ? `${item.title}\n\n${item.description}`
    : item.title;
  const { headline, summary, flag } = splitHeadline(text);
  return {
    id: `${feed.handle}/${hashId(item.link || item.title).slice(0, 12)}`,
    channel: feed.handle,
    url: item.link,
    publishedAt: item.pubDate,
    text,
    headline,
    flag,
    summary,
    // A wire's own pictures are not ours to serve; the item links to its page.
    media: null,
    forwardedFrom: null,
    replyTo: null,
    views: null,
  };
}

const wireFeeds = WIRE_FEEDS.map(feed => ({
  source: feed,
  load: cachedSource<NewsPost>(`wire:${feed.handle}`, async () => {
    const res = await fetch(feed.url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseRSSItems(await res.text(), feed.name).slice(0, ITEMS_PER_WIRE);
    // Oldest first, as a source page arrives, so recentPosts takes the newest.
    return items
      .map(item => wirePost(item, feed))
      .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  }, WIRE_TTL_MS),
}));

export interface RssItem { title: string; description: string; link: string; pubDate: string; source: string }

function parseRSSItems(xml: string, sourceName: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const getTag = (tag: string) => {
      const m = itemXml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return (m?.[1] || m?.[2] || '').trim();
    };

    const title = htmlToText(getTag('title'));
    const pubDate = getTag('pubDate');
    // Same rule for every source: no timestamp, no item — never back-dated to "now".
    if (!title || !pubDate || Number.isNaN(Date.parse(pubDate))) continue;

    items.push({
      title: title.length > 140 ? `${title.substring(0, 140)}…` : title,
      description: htmlToText(getTag('description')),
      link: getTag('link'),
      pubDate: new Date(pubDate).toISOString(),
      source: sourceName,
    });
  }
  return items;
}

function assess(text: string) {
  const risk = scoreRisk(text);
  const located = findCoords(text);
  return {
    risk_score: risk.score,
    /* How the score was produced, and from what. Both fields exist so no
       consumer has to take the number on trust. */
    risk_method: 'keyword-count',
    risk_keywords: risk.matched,
    keyword_assessment: risk.score >= 8
      ? `Keyword filter matched ${risk.matched.length} risk terms: ${risk.matched.join(', ')}.`
      : null,
    coords: located ? located.coords : null,
    coords_default: !located,
    /* 'country-anchor' means the marker is a preset centroid for the term
       in `coords_anchor`, not the location of the reported event. */
    location_precision: located ? 'country-anchor' as const : null,
    coords_anchor: located ? located.anchor : null,
  };
}

const hashId = (s: string) => crypto.createHash('md5').update(s).digest('hex');

/** How an item names where it came from: the wire's own site. */
export function sourceRef(feed: Feed & { url: string }): string {
  try {
    return new URL(feed.url).hostname.replace(/^www\./, '');
  } catch {
    return feed.handle;
  }
}

interface Carrier { source: string; source_name: string; lean: string; bloc: Bloc; link: string; published: string }

type NewsItem = {
  id: string;
  title: string;
  summary: string;
  description: string;
  link: string;
  published: string;
  source: string;
  source_name: string;
  lean: string | null;
  bloc: Bloc | null;
  flag: NewsPost['flag'];
  media: NewsPost['media'];
  forwarded_from: NewsPost['forwardedFrom'];
  reply_to: string | null;
  views: number | null;
  also_reported_by: Carrier[];
  /** Rocket, event or news — see alertKind. */
  alert_kind: AlertKind;
  /** The place the report names, when one resolved; see locateReport. */
  place: Omit<AlertPlace, 'lat' | 'lng'> | null;
} & Omit<ReturnType<typeof assess>, 'location_precision'> & {
  location_precision: 'country-anchor' | AlertPlace['precision'] | null;
};

/** How many questions this feed may put to Nominatim on one refresh. */
const LOOKUPS_PER_REFRESH = 15;

/** How long a request waits for place lookups before answering with what it has. */
const PLACE_BUDGET_MS = 2500;

/**
 * Pins each item to the place it names, where one resolves. Lookups are
 * throttled to Nominatim's one a second, so a cold start cannot place every
 * item inside one request: whatever has not resolved by the budget keeps its
 * country anchor this time, and the lookup carries on so the next refresh has it.
 */
async function placeItems(items: NewsItem[]): Promise<void> {
  const found = new Map<string, AlertPlace>();
  /* One budget of new questions for the whole refresh, claimed by the newest
     reports first; everything else is placed from names already known. Without
     it a feed of a hundred reports asks Nominatim several hundred questions
     every few minutes, which is how this app came to be running at ten times
     the rate its operators allow — see lib/nominatim.ts. What goes unasked now
     is asked on a later refresh, and an answer is kept for a month. */
  const newestFirst = [...items].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  const lookup = budgetedLookup(LOOKUPS_PER_REFRESH);

  const all = Promise.all(newestFirst.map(async item => {
    const place = await locateReport(item.title, item.description, lookup).catch(() => null);
    if (place) found.set(item.id, place);
  }));
  await Promise.race([all, new Promise(resolve => setTimeout(resolve, PLACE_BUDGET_MS))]);

  for (const item of items) {
    const place = found.get(item.id);
    if (!place) continue;
    item.coords = [place.lat, place.lng];
    item.coords_default = false;
    item.location_precision = place.precision;
    item.coords_anchor = place.name;
    item.place = { name: place.name, label: place.label, precision: place.precision };
  }
}

/**
 * The feed, built at most once a minute and shared by every reader.
 *
 * Building it resolves places, and a place lookup is a request to somebody
 * else's server. Built per request, a hundred dashboards polling would have
 * multiplied that by a hundred — the shape of the problem Nominatim's
 * operators wrote to us about. Built once, they all read the same answer.
 */
let feed: { at: number; body: FeedPayload } | null = null;
let building: Promise<FeedPayload> | null = null;
const FEED_TTL_MS = 60_000;

interface SourceHealth {
  handle: string;
  name: string;
  lean: string;
  bloc: Bloc;
  kind: 'wire';
  count: number;
  latest: string | null;
}

interface FeedPayload {
  news: NewsItem[];
  total: number;
  sources: SourceHealth[];
  timestamp: string;
}

async function buildFeed(): Promise<FeedPayload> {
  {
    const now = Date.now();
    /* Sources are read the same way and fail the same way: one source that
       is slow or blocked costs its own items, not the feed. */
    const loaded = await Promise.all(wireFeeds.map(async f => {
      const all = await f.load().catch(() => [] as NewsPost[]);
      return { source: f.source, all, posts: recentPosts(all, now) };
    }));

    const sources = loaded.map(({ source, all, posts }) => ({
      handle: source.handle,
      name: source.name,
      lean: source.lean,
      bloc: source.bloc,
      /** Where it was read from, so the panel can say what kind of source it is. */
      kind: 'wire' as const,
      /** Posts inside the live window. */
      count: posts.length,
      /** The source's newest post, even when it is older than the window. */
      latest: all.length ? all[all.length - 1].publishedAt : null,
    }));

    const stories = mergeCrossPosts(loaded.flatMap(({ source, posts }) => posts.map(post => ({ post, source }))));

    const newsItems: NewsItem[] = stories.map(({ lead: { post, source }, carriedBy }) => ({
      id: hashId(post.url),
      title: post.headline,
      summary: post.summary,
      description: post.text,
      link: post.url,
      published: post.publishedAt,
      source: sourceRef(source),
      source_name: source.name,
      lean: source.lean,
      bloc: source.bloc,
      flag: post.flag,
      media: post.media,
      forwarded_from: post.forwardedFrom,
      reply_to: post.replyTo,
      views: post.views,
      also_reported_by: carriedBy.map(c => ({
        source: sourceRef(c.source),
        source_name: c.source.name,
        lean: c.source.lean,
        bloc: c.source.bloc,
        link: c.post.url,
        published: c.post.publishedAt,
      })),
      alert_kind: alertKind(post.headline, post.text),
      place: null,
      ...assess(post.text),
    }));

    await placeItems(newsItems);

    newsItems.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));

    return {
      news: newsItems,
      total: newsItems.length,
      sources,
      timestamp: new Date().toISOString(),
    };
  }
}

export async function GET() {
  try {
    const fresh = feed && Date.now() - feed.at < FEED_TTL_MS;
    if (!fresh) {
      // One build at a time: concurrent readers wait for it rather than each
      // starting their own and spending the place budget several times over.
      building ??= buildFeed().finally(() => { building = null; });
      const body = await building;
      feed = { at: Date.now(), body };
    }
    return NextResponse.json(feed!.body, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch {
    // A build that fails leaves the last good feed in place, if there is one.
    if (feed) return NextResponse.json(feed.body, { headers: { 'Cache-Control': 'public, s-maxage=30' } });
    return NextResponse.json({ news: [], error: 'Failed to fetch intel' }, { status: 500 });
  }
}
