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

/**
 * The filter rules for one look, scoped to its own `data-look` value so the
 * attribute alone gates them: strip the attribute and the treatment is off
 * even before the tag is removed. Only two hooks are ever targeted — the
 * map canvas and the live-imagery class. Nothing else on the page matches,
 * which is the legibility rule made structural: badges, labels in panels
 * and UI text cannot be filtered because no selector can reach them.
 */
export function buildLookCss(look: SensorLook): string {
  const at = `body[data-look="${look.id}"]`;
  return `${at} .maplibregl-canvas,
${at} .${LOOK_MEDIA_CLASS} {
  filter: ${look.filter};
}
${at} .${LOOK_MEDIA_CLASS}.blur-2xl {
  filter: blur(40px) ${look.filter};
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

export function lookPlan(id: SensorLookId | null): LookPlan {
  const look = id ? LOOKS.find(l => l.id === id) : undefined;
  if (!look) return NO_LOOK;
  return {
    dataLook: look.id,
    css: buildLookCss(look),
    defs: look.svg,
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

function drop(id: string) {
  document.getElementById(id)?.remove();
}

/** Push a look onto the page, or strip every trace of one when passed null. */
export function applyLook(id: SensorLookId | null) {
  if (typeof document === 'undefined') return;
  const plan = lookPlan(id);
  const body = document.body;

  if (plan.dataLook) body.setAttribute('data-look', plan.dataLook);
  else body.removeAttribute('data-look');

  if (plan.css) {
    upsert(LOOK_STYLE_TAG_ID, 'style', document.head, el => { el.textContent = plan.css; });
  } else drop(LOOK_STYLE_TAG_ID);

  if (plan.defs) {
    upsert(LOOK_DEFS_ID, 'svg', body, el => {
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
      el.innerHTML = LOOK_DEFS;
    });
  } else drop(LOOK_DEFS_ID);

  if (plan.overlayCss) {
    upsert(LOOK_OVERLAY_ID, 'div', body, el => {
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute(
        'style',
        `position:fixed;inset:0;pointer-events:none;z-index:9990;background-image:${plan.overlayCss}`,
      );
    });
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
