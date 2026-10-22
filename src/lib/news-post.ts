/**
 * Glass Earth — the shared shape of a news-feed item and the text helpers
 * that produce it.
 *
 * The Live Alerts feed (src/app/api/news/route.ts) reads wire services and
 * national newsrooms over RSS and normalises every item into this shape, so
 * downstream consumers — the cards, the cross-post folding, the place
 * lookup — never branch on where an item came from.
 */

export interface NewsMedia {
  kind: 'photo' | 'video';
  /** Preview image URL. */
  thumb: string | null;
  /** Video length as printed by the source, e.g. "0:29". */
  duration: string | null;
  /** The lead video's file, playable in place, when the source serves one. */
  video: string | null;
  /** Items in the post — more than one for an album. */
  count: number;
}

export interface NewsPost {
  /** "<source>/<id>" — stable across refreshes. */
  id: string;
  /** Handle of the source that published the item. */
  channel: string;
  url: string;
  /** ISO timestamp from the item itself. */
  publishedAt: string;
  /** Full plain text, paragraph breaks kept. */
  text: string;
  headline: string;
  /** Set when the source marked the item as breaking news. */
  flag: 'BREAKING' | null;
  /** The text after the headline. */
  summary: string;
  media: NewsMedia | null;
  forwardedFrom: { name: string; url: string | null } | null;
  /** Permalink of the item this one replies to. */
  replyTo: string | null;
  views: number | null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', deg: '°',
};

/** One pass, so `&amp;lt;` decodes to `&lt;` rather than `<`. */
export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string): string {
  const text = decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(?:blockquote|p|div)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\u00a0/g, ' ');

  return text
    .split('\n')
    .map(line => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Emoji, flags (regional indicators), skin tones, keycaps and the joiners between them.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu;
// Bullets, dashes, hashes and other decoration before the first word.
const LEADING_DECORATION = /^[^\p{L}\p{N}"'“‘«(]+/u;
// Urgency labels sources put ahead of a headline, in the languages seen.
const BREAKING_PREFIX = /^(?:breaking(?: news)?|just in|urgent|flash|срочно|молния|última hora|ultima hora)(?![\p{L}])\s*[:|—–-]?\s*/iu;
const OTHER_PREFIX = /^(?:new|update|developing)\s*[:|—–-]\s*/iu;
const HEADLINE_MAX = 140;

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/, '')}…`;
}

function tidyLine(line: string): { text: string; breaking: boolean } {
  let s = line
    // Styled "𝗯𝗼𝗹𝗱" and full-width letters back to plain text.
    .normalize('NFKC')
    .replace(/^\W*Fwd from @\S*/iu, '')
    .replace(PICTOGRAPHS, ' ')
    .replace(/[([]\s*[)\]]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(LEADING_DECORATION, '');
  const breaking = BREAKING_PREFIX.test(s);
  s = s
    .replace(BREAKING_PREFIX, '')
    .replace(OTHER_PREFIX, '')
    .replace(LEADING_DECORATION, '')
    .replace(/[\s|:—–-]+$/u, '')
    .trim();
  // A guillemet whose partner was an emoji-wrapped title marker.
  if (s.startsWith('«') && !s.includes('»')) s = s.slice(1);
  if (s.endsWith('»') && !s.includes('«')) s = s.slice(0, -1);
  return { text: s.trim(), breaking };
}

const SIGN_OFF = [
  /^@\w+(?:\s*[|•·].*)?$/u, //                 "@BellumActaNews", "@DDGeopolitics | Socials | Donate"
  /^@\w+\s+[—–-]\s+.{0,80}$/u, //             "@rybar_africa — where politics is hotter…" (network promo)
  /^[\p{L} ]{1,20}(?:\s*\|\s*[\p{L} ]{1,20}){2,}$/u, // "VK | RuTube | OK | Zen"
  /^(?:support us|subscribe|donate|join us|follow us|original msg)\b.{0,30}$/iu,
  /^(?:#[\p{L}\p{N}_]+\s*)+$/u, //            "#NATO #Russia #USA #Ukraine"
];
// A rule of dashes or emoji ("➖➖➖➖", "———") that sources put above a footer.
const isRule = (line: string) => line.trim().length >= 3 && !/[\p{L}\p{N}]/u.test(line);

/**
 * Drops the sign-off sources append to every item — their handle, link
 * menus, separators — so it never surfaces as a summary. Only trailing lines
 * are touched; a handle mentioned inside the report stays.
 */
export function stripSignOff(text: string): string {
  let lines = text.split('\n');
  // Everything under a closing rule is footer — sign-off or advertising — when it
  // is short. Some sources stack two, so look twice.
  for (let pass = 0; pass < 2; pass++) {
    const rule = lines.findLastIndex(isRule);
    if (rule <= 0) break;
    const footer = lines.slice(rule + 1).filter(l => l.trim());
    if (footer.length > 3 || footer.join(' ').length > 240) break;
    lines = lines.slice(0, rule);
  }
  while (lines.length > 1) {
    const last = lines[lines.length - 1].normalize('NFKC').replace(PICTOGRAPHS, ' ').replace(/\s+/g, ' ').trim();
    const bare = last.replace(/^[^\p{L}\p{N}@#]+/u, '');
    if (!/[\p{L}\p{N}]/u.test(last) || SIGN_OFF.some(rx => rx.test(bare))) lines.pop();
    else break;
  }
  return lines.join('\n').trim();
}

/**
 * The headline a newsroom would print: the first line that carries real
 * words, without the emoji, flags, urgency labels and forwarding debris
 * sources decorate it with. A first line that runs on as a paragraph is cut
 * at its first sentence, and the remainder moves to the summary.
 */
export function splitHeadline(text: string): { headline: string; summary: string; flag: NewsPost['flag'] } {
  const lines = text.split('\n');
  let breaking = false;
  for (let i = 0; i < lines.length; i++) {
    const line = tidyLine(lines[i]);
    breaking ||= line.breaking;
    let headline = line.text;
    // A line that is only decoration, a lone word or an urgency label ("ÚLTIMA HORA").
    if ((headline.match(/\p{L}/gu) || []).length < 8 || !headline.includes(' ')) continue;

    let restAt = i + 1;
    // "Speaker Name:" on its own line with the quote beneath — keep them together.
    if (/:\s*$/.test(lines[i]) && headline.length <= 80) {
      while (restAt < lines.length && !lines[restAt].trim()) restAt++;
      const quote = restAt < lines.length ? tidyLine(lines[restAt]).text : '';
      if (quote) {
        headline = `${headline}: ${quote}`;
        restAt++;
      }
    }

    let rest = lines.slice(restAt).join('\n').trim();
    if (headline.length > HEADLINE_MAX) {
      const sentence = headline.match(/^(.{20,}?[.!?])\s+(?=\S)/u);
      if (sentence && sentence[1].length <= HEADLINE_MAX) {
        rest = `${headline.slice(sentence[0].length)}\n${rest}`.trim();
        headline = sentence[1];
      }
    }
    return { headline: clip(headline, HEADLINE_MAX), summary: rest, flag: breaking ? 'BREAKING' : null };
  }
  const whole = tidyLine(text.replace(/\n+/g, ' '));
  return {
    headline: clip(whole.text, HEADLINE_MAX),
    summary: '',
    flag: breaking || whole.breaking ? 'BREAKING' : null,
  };
}

/**
 * Word-level fingerprint for spotting the same report carried by several
 * sources. Links, handles and emoji are dropped; the opening words compared.
 */
export function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+|@\w+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 1)
    .slice(0, 24)
    .join(' ');
}
