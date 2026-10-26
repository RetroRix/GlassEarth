/**
 * Sensor looks — display treatments over the live picture.
 *
 * A look is not a theme, and the distinction is the whole design:
 *
 *  - A Style Studio theme is a set of tokens the user composed. A look is a
 *    camera treatment — the map and the live pictures seen through night
 *    vision, a thermal palette, and so on. It must sit ON TOP of whatever
 *    theme is active and come off without leaving a mark, because the theme
 *    underneath belongs to the user.
 *  - So a look owns exactly four artefacts, none of them the studio's: a
 *    `data-look` attribute on <body>, one injected <style> tag holding the
 *    filter rules, one hidden <svg> of filter definitions (only the looks
 *    that need a palette ramp), and one overlay div (only the looks with a
 *    scanline/vignette layer). Its storage key is its own. Applying a look
 *    never reads or writes the studio's settings, and removing one deletes
 *    all four artefacts — the theme that was there is the theme that remains,
 *    byte for byte.
 *
 * The treatment itself is CSS `filter` on the picture surfaces only: the
 * MapLibre canvas and every live-imagery element wearing `.ge-look-media`
 * (camera tiles and previews, the theater wall, Ambient TV, the full viewer,
 * the TV wall and stations player, the airport and ISS camera embeds). One
 * surface composes rather than replaces: Ambient TV's blurred backdrop is
 * itself a picture with a blur to keep, so its rule runs blur first and the
 * treatment second. DOM
 * chrome — panels, text, and above all the honest feed badges — is never
 * filtered: a badge carries its own dark pill and has to read the same in
 * every look, or the trust mark stops meaning anything. Map labels ride
 * inside the canvas, so they take the treatment with the map; the palette
 * ramps are luminance-ordered (dark stays dark, bright stays bright), which
 * is what keeps them legible.
 *
 * We have no shader engine, so the two signature looks are SVG filters:
 * a luminance ramp to phosphor green for night vision, and a luminance ramp
 * through the ironbow palette for thermal. Noir, CRT and Snow are plain CSS
 * filter chains; CRT adds its scanlines through the overlay div.
 *
 * One hard-won mechanical rule: the defs element MUST be a real SVG element,
 * created with createElementNS. A plain createElement('svg') returns an
 * HTMLUnknownElement in HTML documents, and its innerHTML parses as unknown
 * HTML tags — the ids exist in the document but no SVGFilterElement is ever
 * registered, so every `filter: url("#…")` declaration is invalid and the
 * browser silently drops it, leaving the look completely untreated on every
 * surface. That is exactly what shipped in f4b3bfc and what the 2026-10-26
 * browser verification caught (Night Vision showed only its vignette;
 * Thermal showed nothing at all). The namespaced construction below is
 * proven against a real Chromium: img, canvas-2d and WebGL surfaces all
 * take the ramp (see the fix-round report).
 *
 * Two more rules, bought on iOS the same evening (Rick's iPhone, 2026-10-26):
 *
 *  - THE OVERLAY LIVES INSIDE THE MAP, NEVER OVER THE VIEWPORT. The first
 *    version appended the vignette div to <body> as position:fixed at
 *    z-index 9990. Every piece of chrome in this app lives at z-index 999
 *    or below (mobile sheet and Style Studio 400, drawers 940, splash 999),
 *    so the overlay outranked ALL of it. On desktop nobody noticed — the
 *    vignette is transparent across the middle of the screen, where desktop
 *    panels sit. The mobile LAYERS & STATS sheet spans the bottom half of a
 *    phone screen, deep inside the gradient, and its rows crushed to
 *    black-on-black: the user could not read the menus, could not find OFF,
 *    and was stuck in the look. The overlay is now homed inside the
 *    .maplibregl-map element at z-index 2 (body-fixed at z-index 1 only if
 *    the map element does not exist yet) — beneath every chrome z-index in
 *    the app by construction, on every engine and every layout. A look must
 *    never be able to trap its user.
 *
 *  - WEBKIT NEVER GETS THE SVG RAMPS. iOS Safari does not apply CSS
 *    `filter: url("#…")` references — Rick's iPhone showed Thermal as
 *    completely untreated while desktop Chromium rendered the same build
 *    correctly (and WebKit's ports disagree with each other about filter
 *    references, so no port's behaviour can stand in for another's). CSS
 *    filter *functions*, by contrast, render in every WebKit. So engines in
 *    the WebKit family (Safari, every browser on iOS, WebKit ports) get
 *    CSS-chain versions of the two ramp looks — monotone sepia ramps that
 *    keep the SVG versions' luminance ordering — and Blink/Gecko keep the
 *    true palette ramps. The choice is made on the user agent's engine
 *    tokens, and it fails safe: a WebKit that one day grows filter
 *    references still gets a working look, just the chain one.
 */

export const LOOK_STORAGE_KEY = 'osiris:sensor-look';
export const LOOK_STYLE_TAG_ID = 'osiris-sensor-looks';
export const LOOK_DEFS_ID = 'osiris-look-defs';
export const LOOK_OVERLAY_ID = 'osiris-look-overlay';

/** The class every live-imagery element wears so a look can find it. */
export const LOOK_MEDIA_CLASS = 'ge-look-media';

export type SensorLookId = 'night-vision' | 'thermal' | 'noir' | 'crt' | 'snow';

export interface SensorLook {
  id: SensorLookId;
  label: string;
  /** One plain line for the Studio — what the look is, in our words. */
  blurb: string;
  /** The dot shown on the Studio button (a colour or a gradient). */
  swatch: string;
  /** The CSS filter applied to the map canvas and every live picture. */
  filter: string;
  /**
   * WebKit-family substitute for `filter`, for the looks whose primary
   * filter is an SVG reference WebKit cannot be trusted to render. A CSS
   * filter-function chain with the same character and the same luminance
   * ordering. Absent on looks that are already plain chains.
   */
  cssFilter?: string;
  /** True when `filter` references an SVG filter in LOOK_DEFS. */
  svg: boolean;
  /** Screen-overlay background layers (scanlines, vignette), or null. */
  overlay: string | null;
}

export const LOOKS: SensorLook[] = [
  {
    id: 'night-vision',
    label: 'NIGHT VISION',
    blurb: 'The picture through an image intensifier — phosphor green, edges falling off like a tube.',
    swatch: '#3dff6e',
    filter: 'url("#ge-look-nightvision")',
    /* WebKit chain: grayscale → sepia (a monotone warm ramp) → rotate to
       green and push saturation. Same phosphor family as the CRT chain,
       brighter and cleaner — a tube, not a monitor. */
    cssFilter: 'grayscale(1) sepia(1) hue-rotate(66deg) saturate(3.1) contrast(1.16) brightness(1.06)',
    svg: true,
    /* A tube vignette: the centre stays clear, the edges fall to black-green. */
    overlay: 'radial-gradient(ellipse at center, transparent 52%, rgba(1, 12, 3, 0.55) 100%)',
  },
  {
    id: 'thermal',
    label: 'THERMAL',
    blurb: 'A heat palette laid over brightness — dark is cold, bright is hot, ironbow colours between.',
    swatch: 'linear-gradient(90deg, #1b0033, #a200ff, #ff2a00, #ffb300, #fff6c8)',
    filter: 'url("#ge-look-thermal")',
    /* WebKit chain: grayscale → sepia → rotate the warm ramp down into the
       reds and push it hard. Dark stays near-black warm, mid-tones go
       red-orange, highlights blow out pale — a red-heat palette (a real
       FLIR family) standing in for ironbow's extra hues. */
    cssFilter: 'grayscale(1) sepia(1) hue-rotate(-40deg) saturate(3.6) contrast(1.22) brightness(1.05)',
    svg: true,
    overlay: null,
  },
  {
    id: 'noir',
    label: 'NOIR',
    blurb: 'Black and white with the contrast pushed — the planet as a surveillance still.',
    swatch: 'linear-gradient(90deg, #000000, #ffffff)',
    filter: 'grayscale(1) contrast(1.3) brightness(1.06)',
    svg: false,
    overlay: null,
  },
  {
    id: 'crt',
    label: 'CRT',
    blurb: 'A green-phosphor monitor from the ops room — scanlines and all.',
    swatch: '#27e07c',
    filter: 'grayscale(1) sepia(1) hue-rotate(63deg) saturate(2.4) contrast(1.22)',
    svg: false,
    overlay: [
      'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.22) 0px, rgba(0, 0, 0, 0.22) 1px, transparent 1px, transparent 3px)',
      'radial-gradient(ellipse at center, transparent 58%, rgba(0, 8, 2, 0.4) 100%)',
    ].join(', '),
  },
  {
    id: 'snow',
    label: 'SNOW',
    blurb: 'Pale, washed winter light — colour drained, everything a little overexposed.',
    swatch: '#dcebf5',
    filter: 'saturate(0.28) brightness(1.3) contrast(0.8)',
    svg: false,
    overlay: null,
  },
];

export const LOOK_IDS = LOOKS.map(l => l.id) as SensorLookId[];

/**
 * The two palette ramps, as SVG filters. Both start from the same luminance
 * matrix (Rec. 601 — the weights a camera sensor roughly sees), then map
 * brightness through a per-channel table. Table stops are ordered so
 * perceived brightness never inverts: what was dark stays dark.
 *
 * Night vision: black lifts slightly off zero in the green channel (a tube
 * is never truly off), whites land short of pure white with the blue channel
 * catching up — that is what makes highlights bloom green-white instead of
 * clipping to a flat green.
 *
 * Thermal (ironbow): black → purple → magenta → red → orange → yellow →
 * white, the palette every thermal camera since the eighties has shipped.
 */
export const LOOK_DEFS = `<defs>
<filter id="ge-look-nightvision" color-interpolation-filters="sRGB">
<feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0"/>
<feComponentTransfer>
<feFuncR type="table" tableValues="0 0.03 0.10 0.30 0.70"/>
<feFuncG type="table" tableValues="0.02 0.28 0.58 0.88 1"/>
<feFuncB type="table" tableValues="0 0.05 0.12 0.32 0.62"/>
</feComponentTransfer>
</filter>
<filter id="ge-look-thermal" color-interpolation-filters="sRGB">
<feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0"/>
<feComponentTransfer>
<feFuncR type="table" tableValues="0 0.25 0.62 0.92 1 1 1"/>
<feFuncG type="table" tableValues="0 0.02 0.06 0.16 0.52 0.86 1"/>
<feFuncB type="table" tableValues="0 0.42 0.55 0.10 0.04 0.22 1"/>
</feComponentTransfer>
</filter>
</defs>`;

/* ── Engine split ──
   Which mechanism a look may use is a property of the browser ENGINE, not
   of the look. 'svg' engines (Blink, Gecko) render CSS filter references
   to the palette ramps. 'css' engines (the WebKit family) are never handed
   a url() reference at all — iOS WebKit does not render them (proven on
   Rick's iPhone, 2026-10-26) — and get filter-function chains instead,
   which every WebKit renders. Detection reads the engine tokens in the
   user agent: a WebKit-family UA carries AppleWebKit WITHOUT a Blink
   token (Chrome/Edge/Opera all carry one, including on desktop; Chrome
   and Firefox on iOS carry CriOS/FxiOS instead and stay WebKit, which is
   correct — on iOS they ARE WebKit). */

export type LookEngine = 'svg' | 'css';

const WEBKIT_TOKEN = /AppleWebKit\//;
const BLINK_TOKEN = /(Chrome|Chromium|Edg|OPR)\//;
const IOS_BADGE_TOKEN = /(CriOS|FxiOS)\//;

/** The mechanism a user agent's engine may be trusted with. Pure. */
export function lookEngineForUserAgent(ua: string): LookEngine {
  if (!WEBKIT_TOKEN.test(ua)) return 'svg';
  /* CriOS/FxiOS are WebKit wearing another browser's badge on iOS — the
     engine is WebKit whatever the badge says. */
  if (IOS_BADGE_TOKEN.test(ua)) return 'css';
  return BLINK_TOKEN.test(ua) ? 'svg' : 'css';
}

let cachedEngine: LookEngine | null = null;

/** This browser's engine, detected once. Non-browser contexts get 'svg'. */
export function detectLookEngine(): LookEngine {
  if (cachedEngine) return cachedEngine;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  cachedEngine = lookEngineForUserAgent(ua);
  return cachedEngine;
}

/** The filter a look actually runs under an engine. */
export function lookFilter(look: SensorLook, engine: LookEngine): string {
  return engine === 'css' && look.cssFilter ? look.cssFilter : look.filter;
}

/**
 * The filter rules for one look, scoped to its own `data-look` value so the
 * attribute alone gates them: strip the attribute and the treatment is off
 * even before the tag is removed. Only two hooks are ever targeted — the
 * map canvas and the live-imagery class. Nothing else on the page matches,
 * which is the legibility rule made structural: badges, labels in panels
 * and UI text cannot be filtered because no selector can reach them.
 */
export function buildLookCss(look: SensorLook, engine: LookEngine = 'svg'): string {
  const filter = lookFilter(look, engine);
  const at = `body[data-look="${look.id}"]`;
  return `${at} .maplibregl-canvas,
${at} .${LOOK_MEDIA_CLASS} {
  filter: ${filter};
}
${at} .${LOOK_MEDIA_CLASS}.blur-2xl {
  filter: blur(40px) ${filter};
}`;
}

/** What the DOM should look like while a look is active — the whole plan. */
export interface LookPlan {
  /** Value for body's data-look attribute, or null for no look. */
  dataLook: string | null;
  /** Text of the injected style tag; empty means the tag must not exist. */
  css: string;
  /** Whether the SVG filter definitions must be in the document. */
  defs: boolean;
  /** Overlay background-image; null means the overlay div must not exist. */
  overlayCss: string | null;
}

const NO_LOOK: LookPlan = { dataLook: null, css: '', defs: false, overlayCss: null };

export function lookPlan(id: SensorLookId | null, engine: LookEngine = 'svg'): LookPlan {
  const look = id ? LOOKS.find(l => l.id === id) : undefined;
  if (!look) return NO_LOOK;
  return {
    dataLook: look.id,
    css: buildLookCss(look, engine),
    /* The defs only exist for an engine that will actually reference them;
       under 'css' the ramp looks run their chains and no <svg> is added. */
    defs: look.svg && engine === 'svg',
    overlayCss: look.overlay,
  };
}

/** Storage and stored values are untrusted: only the five ids are looks. */
export function parseLookId(v: unknown): SensorLookId | null {
  return typeof v === 'string' && (LOOK_IDS as string[]).includes(v) ? (v as SensorLookId) : null;
}

/* ── DOM application ──
   A thin writer for lookPlan: it touches only the four artefacts above.
   It never sets an inline style on <body>, never reads the studio's
   storage key, and never goes near the studio's style tag — the theme
   restoration property is that there is simply no code path from here
   to there. */

function upsert(id: string, tag: string, parent: HTMLElement, fill: (el: HTMLElement) => void) {
  let el = document.getElementById(id) as HTMLElement | null;
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    parent.appendChild(el);
  }
  fill(el);
  return el;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The defs element MUST live in the SVG namespace, or the <filter> children
 * parse as unknown HTML elements and `url("#…")` references resolve to
 * nothing (see the header note). createElementNS is the only construction
 * that registers real filter primitives. Falls back to createElement only
 * where createElementNS does not exist (non-browser stubs).
 */
function upsertSvgDefs(id: string, parent: HTMLElement, fill: (el: HTMLElement) => void) {
  let el = document.getElementById(id) as HTMLElement | null;
  if (!el) {
    el = (typeof document.createElementNS === 'function'
      ? document.createElementNS(SVG_NS, 'svg')
      : document.createElement('svg')) as HTMLElement;
    el.id = id;
    parent.appendChild(el);
  }
  fill(el);
  return el;
}

function drop(id: string) {
  document.getElementById(id)?.remove();
}

/** The map element the overlay is homed into (MapLibre's own class). */
export const LOOK_MAP_SELECTOR = '.maplibregl-map';
/** Overlay z-index inside the map element: above the canvas, below every
 *  piece of app chrome (the lowest chrome in the app sits at z-index 100). */
export const LOOK_OVERLAY_Z_IN_MAP = 2;
/** Overlay z-index for the no-map-yet fallback: fixed, but still below all
 *  chrome — the overlay must never outrank a menu, whatever happens. */
export const LOOK_OVERLAY_Z_FALLBACK = 1;

/**
 * Put the overlay where it can only ever touch the picture: inside the map
 * element itself, absolutely positioned over the canvas. Panels, sheets,
 * drawers and menus are never descendants of the map element, so the
 * vignette cannot reach them — that is the structural form of "chrome is
 * never treated". If the map element does not exist yet, fall back to a
 * body-fixed overlay at a z-index still below all chrome; the next
 * applyLook re-homes it into the map.
 */
function placeOverlay(el: HTMLElement, backgroundImage: string) {
  const mapEl = (typeof document.querySelector === 'function'
    ? document.querySelector(LOOK_MAP_SELECTOR)
    : null) as HTMLElement | null;
  const parent = mapEl ?? document.body;
  /* Detach first, then append: appendChild alone would also move the node
     in a real DOM, but the explicit detach keeps the operation identical
     everywhere — and re-running it is what re-homes an overlay that was
     placed before the map element existed. */
  el.remove();
  parent.appendChild(el);
  el.setAttribute(
    'style',
    mapEl
      ? `position:absolute;inset:0;pointer-events:none;z-index:${LOOK_OVERLAY_Z_IN_MAP};background-image:${backgroundImage}`
      : `position:fixed;inset:0;pointer-events:none;z-index:${LOOK_OVERLAY_Z_FALLBACK};background-image:${backgroundImage}`,
  );
}

/** The overlay background of the look currently applied, if any — kept so
 *  the overlay can be re-homed when the map element appears after the
 *  boot-time apply (the map is constructed after the page's first effect
 *  on some boots, and the fallback placement must not become permanent). */
let activeOverlayCss: string | null = null;

/**
 * Re-home the overlay into the map element if one has appeared since the
 * look was applied. Called by the map component once its Map exists; a
 * no-op when no look with an overlay is active.
 */
export function rehomeLookOverlay() {
  if (typeof document === 'undefined' || !activeOverlayCss) return;
  const el = document.getElementById(LOOK_OVERLAY_ID) as HTMLElement | null;
  if (el) placeOverlay(el, activeOverlayCss);
}

/** Push a look onto the page, or strip every trace of one when passed null. */
export function applyLook(id: SensorLookId | null, engine: LookEngine = detectLookEngine()) {
  if (typeof document === 'undefined') return;
  const plan = lookPlan(id, engine);
  const body = document.body;

  if (plan.dataLook) body.setAttribute('data-look', plan.dataLook);
  else body.removeAttribute('data-look');

  if (plan.css) {
    upsert(LOOK_STYLE_TAG_ID, 'style', document.head, el => { el.textContent = plan.css; });
  } else drop(LOOK_STYLE_TAG_ID);

  if (plan.defs) {
    upsertSvgDefs(LOOK_DEFS_ID, body, el => {
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
      el.innerHTML = LOOK_DEFS;
    });
  } else drop(LOOK_DEFS_ID);

  activeOverlayCss = plan.overlayCss;
  if (plan.overlayCss) {
    const el = upsert(LOOK_OVERLAY_ID, 'div', body, e => { e.setAttribute('aria-hidden', 'true'); });
    placeOverlay(el, plan.overlayCss);
  } else drop(LOOK_OVERLAY_ID);
}

/** The look currently on the page, if any — the attribute is the truth. */
export function readActiveLook(): SensorLookId | null {
  if (typeof document === 'undefined') return null;
  return parseLookId(document.body.getAttribute('data-look'));
}

/** Persist the look choice under its own key. Silently a no-op in private mode. */
export function saveLook(id: SensorLookId | null) {
  try {
    if (id) localStorage.setItem(LOOK_STORAGE_KEY, id);
    else localStorage.removeItem(LOOK_STORAGE_KEY);
  } catch { /* private mode */ }
}

/** Reapply the saved look on load. A junk stored value is simply no look. */
export function loadSavedLook(): SensorLookId | null {
  try {
    return parseLookId(localStorage.getItem(LOOK_STORAGE_KEY));
  } catch {
    return null;
  }
}
