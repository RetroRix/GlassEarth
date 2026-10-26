import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LOOKS,
  LOOK_DEFS,
  LOOK_IDS,
  LOOK_STORAGE_KEY,
  LOOK_STYLE_TAG_ID,
  LOOK_DEFS_ID,
  LOOK_OVERLAY_ID,
  LOOK_MEDIA_CLASS,
  LOOK_MAP_SELECTOR,
  LOOK_OVERLAY_Z_IN_MAP,
  LOOK_OVERLAY_Z_FALLBACK,
  SVG_NS,
  buildLookCss,
  lookPlan,
  lookFilter,
  lookEngineForUserAgent,
  parseLookId,
  applyLook,
  rehomeLookOverlay,
  readActiveLook,
  saveLook,
  loadSavedLook,
  type SensorLookId,
} from './sensor-looks';

const byId = (id: SensorLookId) => LOOKS.find(l => l.id === id)!;

describe('the five looks', () => {
  it('are exactly the set Rick picked, in Studio order', () => {
    expect(LOOK_IDS).toEqual(['night-vision', 'thermal', 'noir', 'crt', 'snow']);
    for (const look of LOOKS) {
      expect(look.label.length).toBeGreaterThan(0);
      expect(look.blurb.length).toBeGreaterThan(0);
      expect(look.filter.length).toBeGreaterThan(0);
    }
  });

  it('marks only night vision and thermal as SVG-palette looks', () => {
    expect(byId('night-vision').svg).toBe(true);
    expect(byId('thermal').svg).toBe(true);
    expect(byId('noir').svg).toBe(false);
    expect(byId('crt').svg).toBe(false);
    expect(byId('snow').svg).toBe(false);
  });

  it('gives only night vision and CRT a screen overlay', () => {
    expect(byId('night-vision').overlay).toContain('radial-gradient');
    expect(byId('crt').overlay).toContain('repeating-linear-gradient');
    expect(byId('thermal').overlay).toBeNull();
    expect(byId('noir').overlay).toBeNull();
    expect(byId('snow').overlay).toBeNull();
  });
});

describe('palette ramps (LOOK_DEFS)', () => {
  it('defines both SVG filters, each a luminance step then a table ramp', () => {
    expect(LOOK_DEFS).toContain('id="ge-look-nightvision"');
    expect(LOOK_DEFS).toContain('id="ge-look-thermal"');
    expect(LOOK_DEFS.match(/feColorMatrix/g)).toHaveLength(2);
    expect(LOOK_DEFS.match(/type="table"/g)).toHaveLength(6);
  });

  it('keeps the thermal ramp brightness-ordered in the green channel', () => {
    // Ironbow reads as heat only if brighter input stays brighter output;
    // the green channel carries most of perceived brightness.
    const g = LOOK_DEFS.match(/<feFuncG type="table" tableValues="([^"]+)"\/>/g);
    expect(g).toHaveLength(2);
    for (const func of g!) {
      const values = func.match(/tableValues="([^"]+)"/)![1].split(' ').map(Number);
      const sorted = [...values].sort((a, b) => a - b);
      expect(values).toEqual(sorted);
    }
  });
});

describe('buildLookCss — the legibility rule, made structural', () => {
  it('targets only the map canvas and the live-imagery class', () => {
    for (const look of LOOKS) {
      const css = buildLookCss(look);
      expect(css).toContain(`body[data-look="${look.id}"] .maplibregl-canvas`);
      expect(css).toContain(`.${LOOK_MEDIA_CLASS}`);
      expect(css).toContain(`filter: ${look.filter};`);
      // No bare element selectors: badges, panel text and every other image
      // on the page are unreachable by these rules, so a look cannot wash
      // them out — that is a property of the selector list, not of tuning.
      expect(css).not.toMatch(/[{,]\s*(img|video|span|div|iframe|canvas)\b/);
    }
  });

  it('composes the Ambient backdrop’s blur ahead of the treatment', () => {
    // The backdrop <img> already spends its `filter` on blur-2xl; a plain
    // override would sharpen it back into a second picture.
    for (const look of LOOKS) {
      expect(buildLookCss(look)).toContain(`filter: blur(40px) ${look.filter};`);
    }
  });

  it('never restyles a theme token or the studio’s own scope', () => {
    for (const look of LOOKS) {
      const css = buildLookCss(look);
      expect(css).not.toContain('--');
      expect(css).not.toContain('data-studio');
    }
  });
});

describe('lookPlan', () => {
  it('is the empty plan for no look', () => {
    expect(lookPlan(null)).toEqual({ dataLook: null, css: '', defs: false, overlayCss: null });
  });

  it('carries each look’s css, defs need and overlay', () => {
    for (const look of LOOKS) {
      const plan = lookPlan(look.id);
      expect(plan.dataLook).toBe(look.id);
      expect(plan.css).toBe(buildLookCss(look));
      expect(plan.defs).toBe(look.svg);
      expect(plan.overlayCss).toBe(look.overlay);
    }
  });
});

describe('parseLookId', () => {
  it('accepts exactly the five ids', () => {
    for (const id of LOOK_IDS) expect(parseLookId(id)).toBe(id);
  });

  it('rejects everything else — stored values are untrusted', () => {
    for (const junk of ['night', 'NIGHT-VISION', '', 'thermal ', null, undefined, 7, {}, ['thermal']]) {
      expect(parseLookId(junk)).toBeNull();
    }
  });
});

/* ── DOM application, against a minimal fake document ──
   The suite runs in node, so the document below is a stub with just the
   surface applyLook uses. That is enough for the property that matters:
   the theme-restoration round trip over a seeded, realistic page state. */

class FakeEl {
  id = '';
  className = '';
  textContent = '';
  innerHTML = '';
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  /** The namespace the element was created in — the whole point of the
   *  2026-10-26 fix: an 'svg' element in the HTML namespace (what a plain
   *  createElement('svg') yields) never registers its <filter> children,
   *  so the look silently renders nothing. */
  namespaceURI: string | null = null;
  constructor(readonly tagName: string) {}
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  appendChild(c: FakeEl) { c.parent = this; this.children.push(c); return c; }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(c => c !== this);
      this.parent = null;
    }
  }
}

const HTML_NS = 'http://www.w3.org/1999/xhtml';

function makeDocument() {
  const body = new FakeEl('body');
  const head = new FakeEl('head');
  const nsCalls: Array<{ ns: string; tag: string }> = [];
  const find = (el: FakeEl, id: string): FakeEl | null => {
    if (el.id === id) return el;
    for (const c of el.children) { const hit = find(c, id); if (hit) return hit; }
    return null;
  };
  const findByClass = (el: FakeEl, cls: string): FakeEl | null => {
    if ((el.className || '').split(/\s+/).includes(cls)) return el;
    for (const c of el.children) { const hit = findByClass(c, cls); if (hit) return hit; }
    return null;
  };
  return {
    body,
    head,
    nsCalls,
    /* A plain createElement puts the element in the HTML namespace — for
       'svg' that means HTMLUnknownElement in a real browser, which is the
       exact behaviour the shipped bug ran into. */
    createElement: (tag: string) => { const el = new FakeEl(tag); el.namespaceURI = HTML_NS; return el; },
    createElementNS: (ns: string, tag: string) => {
      nsCalls.push({ ns, tag });
      const el = new FakeEl(tag);
      el.namespaceURI = ns;
      return el;
    },
    getElementById: (id: string) => find(body, id) ?? find(head, id),
    /* Only the simple class selectors the lib asks for ('.maplibregl-map'). */
    querySelector: (sel: string) => {
      const cls = sel.replace(/^\./, '');
      return findByClass(body, cls) ?? findByClass(head, cls);
    },
  };
}

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

type FakeDoc = ReturnType<typeof makeDocument>;
type FakeStorage = ReturnType<typeof makeStorage>;

/** A page the way a returning user has it: saved theme applied, studio tag in. */
function seedTheme(doc: FakeDoc, ls: FakeStorage) {
  ls.setItem('osiris:style-studio', '{"accent":"#123456","note":"the user’s theme"}');
  const tag = doc.createElement('style');
  tag.id = 'osiris-style-studio';
  tag.textContent = '/* the studio’s own css */';
  doc.head.appendChild(tag as unknown as FakeEl);
  doc.body.setAttribute('data-studio', 'on');
  doc.body.style['--gold-primary'] = '#123456';
  doc.body.style['--text-primary'] = '#abcdef';
  const app = doc.createElement('div');
  app.id = 'app-root';
  doc.body.appendChild(app as unknown as FakeEl);
}

/** Everything the theme owns, serialised — the restoration yardstick. */
function themeSnapshot(doc: FakeDoc, ls: FakeStorage) {
  return JSON.stringify({
    studioStored: ls.getItem('osiris:style-studio'),
    bodyAttrs: [...doc.body.attrs.entries()].sort(),
    bodyStyle: doc.body.style,
    headChildren: doc.head.children.map(c => [c.id, c.textContent]),
    bodyChildren: doc.body.children.map(c => c.id),
  });
}

describe('applyLook — theme restoration', () => {
  let doc: FakeDoc;
  let ls: FakeStorage;

  beforeEach(() => {
    doc = makeDocument();
    ls = makeStorage();
    seedTheme(doc, ls);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', ls);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies each look as its own four artefacts, and only those', () => {
    const before = themeSnapshot(doc, ls);
    for (const look of LOOKS) {
      applyLook(look.id);
      expect(doc.body.getAttribute('data-look')).toBe(look.id);
      expect(readActiveLook()).toBe(look.id);
      const tag = doc.getElementById(LOOK_STYLE_TAG_ID);
      expect(tag?.textContent).toBe(buildLookCss(look));
      expect(Boolean(doc.getElementById(LOOK_DEFS_ID))).toBe(look.svg);
      expect(Boolean(doc.getElementById(LOOK_OVERLAY_ID))).toBe(Boolean(look.overlay));
      if (look.svg) expect(doc.getElementById(LOOK_DEFS_ID)?.innerHTML).toBe(LOOK_DEFS);
      // The theme underneath is untouched even while the look is on.
      expect(themeSnapshot(doc, ls)).not.toBe(before); // the look's own attr/children differ
      expect(ls.getItem('osiris:style-studio')).toBe('{"accent":"#123456","note":"the user’s theme"}');
      expect(doc.body.getAttribute('data-studio')).toBe('on');
      expect(doc.body.style).toEqual({ '--gold-primary': '#123456', '--text-primary': '#abcdef' });
      expect(doc.getElementById('osiris-style-studio')?.textContent).toBe('/* the studio’s own css */');
    }
  });

  it('switching looks replaces the artefacts wholesale — nothing stacks', () => {
    applyLook('thermal');
    applyLook('snow');
    expect(doc.head.children.filter(c => c.id === LOOK_STYLE_TAG_ID)).toHaveLength(1);
    expect(doc.getElementById(LOOK_STYLE_TAG_ID)?.textContent).toBe(buildLookCss(byId('snow')));
    expect(doc.getElementById(LOOK_DEFS_ID)).toBeNull();
    expect(doc.getElementById(LOOK_OVERLAY_ID)).toBeNull();
    expect(doc.body.getAttribute('data-look')).toBe('snow');
  });

  it('removing a look restores the seeded page exactly, for every look', () => {
    const before = themeSnapshot(doc, ls);
    for (const look of LOOKS) {
      applyLook(look.id);
      applyLook(null);
      expect(themeSnapshot(doc, ls)).toBe(before);
      expect(readActiveLook()).toBeNull();
    }
  });

  it('removing when nothing is applied is a no-op', () => {
    const before = themeSnapshot(doc, ls);
    applyLook(null);
    expect(themeSnapshot(doc, ls)).toBe(before);
  });

  /* The 2026-10-26 browser-verification failure: the defs were created with
     a plain createElement('svg'), which is an HTMLUnknownElement in a real
     browser — its <filter> children never register, `url("#…")` resolves to
     nothing, and the two palette looks rendered completely untreated. The
     defs element must be built in the SVG namespace. */
  it('creates the defs element in the SVG namespace, never via createElement', () => {
    for (const id of ['night-vision', 'thermal'] as SensorLookId[]) {
      doc.nsCalls.length = 0;
      applyLook(null);
      applyLook(id);
      const defs = doc.getElementById(LOOK_DEFS_ID);
      expect(defs).not.toBeNull();
      expect(defs!.tagName).toBe('svg');
      expect(defs!.namespaceURI).toBe(SVG_NS);
      expect(doc.nsCalls).toEqual([{ ns: SVG_NS, tag: 'svg' }]);
      expect(defs!.innerHTML).toBe(LOOK_DEFS);
    }
  });

  it('creates no namespaced element at all for the CSS-chain looks', () => {
    for (const id of ['noir', 'crt', 'snow'] as SensorLookId[]) {
      doc.nsCalls.length = 0;
      applyLook(null);
      applyLook(id);
      expect(doc.getElementById(LOOK_DEFS_ID)).toBeNull();
      expect(doc.nsCalls).toEqual([]);
    }
  });
});

describe('look persistence', () => {
  let ls: FakeStorage;

  beforeEach(() => {
    ls = makeStorage();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('document', makeDocument());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips under its own key, never the studio’s', () => {
    saveLook('thermal');
    expect(ls.getItem(LOOK_STORAGE_KEY)).toBe('thermal');
    expect(ls.getItem('osiris:style-studio')).toBeNull();
    expect(loadSavedLook()).toBe('thermal');
    saveLook(null);
    expect(ls.getItem(LOOK_STORAGE_KEY)).toBeNull();
    expect(loadSavedLook()).toBeNull();
  });

  it('treats a junk stored value as no look', () => {
    ls.setItem(LOOK_STORAGE_KEY, 'infrared-9000');
    expect(loadSavedLook()).toBeNull();
  });
});

/* ── The iOS fix (2026-10-26): engine split + overlay homing ──
   Rick's iPhone ran the same build desktop Chromium verified and showed
   Thermal as nothing at all, then trapped him in a look whose vignette
   overlay (body-fixed, z-index 9990) sat over the mobile sheet (z-400) and
   crushed its menus to black. The two suites below pin both halves of the
   fix: WebKit-family engines are never handed an SVG filter reference, and
   the overlay lives inside the map element at a z-index below all chrome. */

describe('lookEngineForUserAgent — the WebKit family gets chains, never url()', () => {
  const cases: Array<[string, 'svg' | 'css']> = [
    // iOS: every browser is WebKit, whatever its badge.
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 'css'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1', 'css'],
    ['Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15', 'css'],
    // Desktop Safari and WebKit ports.
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15', 'css'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', 'css'],
    // Blink: Chrome, Edge, Opera — all carry AppleWebKit AND a Blink token.
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'svg'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', 'svg'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Mobile Safari/537.36', 'svg'],
    // Gecko.
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0', 'svg'],
    // Unknown/absent: the ramp path, as before.
    ['', 'svg'],
    ['Node.js/24', 'svg'],
  ];
  for (const [ua, engine] of cases) {
    it(`${engine} — ${ua.slice(0, 60)}…`, () => {
      expect(lookEngineForUserAgent(ua)).toBe(engine);
    });
  }
});

describe('the css engine — filter-function versions of the ramp looks', () => {
  it('gives only the two ramp looks a chain substitute', () => {
    expect(byId('night-vision').cssFilter).toBeTruthy();
    expect(byId('thermal').cssFilter).toBeTruthy();
    for (const id of ['noir', 'crt', 'snow'] as SensorLookId[]) {
      expect(byId(id).cssFilter).toBeUndefined();
      expect(lookFilter(byId(id), 'css')).toBe(byId(id).filter);
    }
  });

  it('never lets a url() reference into css-engine rules', () => {
    for (const look of LOOKS) {
      const css = buildLookCss(look, 'css');
      expect(css).not.toContain('url(');
      expect(css).toContain(`filter: ${lookFilter(look, 'css')};`);
      expect(css).toContain(`filter: blur(40px) ${lookFilter(look, 'css')};`);
    }
  });

  it('keeps the svg engine’s rules exactly as they were', () => {
    for (const look of LOOKS) {
      expect(buildLookCss(look, 'svg')).toBe(buildLookCss(look));
      expect(lookFilter(look, 'svg')).toBe(look.filter);
    }
  });

  it('drops the defs under the css engine — nothing references them', () => {
    for (const look of LOOKS) {
      expect(lookPlan(look.id, 'css').defs).toBe(false);
      expect(lookPlan(look.id, 'svg').defs).toBe(look.svg);
      expect(lookPlan(look.id, 'css').css).toBe(buildLookCss(look, 'css'));
    }
  });

  it('applying a ramp look under the css engine creates no SVG at all', () => {
    const doc = makeDocument();
    const ls = makeStorage();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', ls);
    try {
      applyLook('thermal', 'css');
      expect(doc.getElementById(LOOK_DEFS_ID)).toBeNull();
      expect(doc.nsCalls).toEqual([]);
      expect(doc.getElementById(LOOK_STYLE_TAG_ID)?.textContent).toBe(buildLookCss(byId('thermal'), 'css'));
      // Switching engines mid-session replaces wholesale, like switching looks.
      applyLook('thermal', 'svg');
      expect(doc.getElementById(LOOK_DEFS_ID)).not.toBeNull();
      applyLook('thermal', 'css');
      expect(doc.getElementById(LOOK_DEFS_ID)).toBeNull();
      expect(doc.head.children.filter(c => c.id === LOOK_STYLE_TAG_ID)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the overlay — homed inside the map, below all chrome', () => {
  let doc: FakeDoc;
  let ls: FakeStorage;

  beforeEach(() => {
    doc = makeDocument();
    ls = makeStorage();
    seedTheme(doc, ls);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', ls);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function addMapElement(): FakeEl {
    const map = doc.createElement('div');
    map.className = 'maplibregl-map';
    doc.body.appendChild(map as unknown as FakeEl);
    return map as unknown as FakeEl;
  }

  it('keeps both overlay z-indexes below the app’s lowest chrome (z-100)', () => {
    // LayerPanel flyouts sit at z-[100], the mobile sheet and Style Studio
    // at z-[400], drawers at 940. The overlay must lose to ALL of them.
    expect(LOOK_OVERLAY_Z_IN_MAP).toBeLessThan(100);
    expect(LOOK_OVERLAY_Z_FALLBACK).toBeLessThan(100);
  });

  it('homes the overlay inside the map element when one exists', () => {
    const map = addMapElement();
    applyLook('night-vision');
    const overlay = doc.getElementById(LOOK_OVERLAY_ID);
    expect(overlay).not.toBeNull();
    expect(overlay!.parent).toBe(map);
    expect(doc.body.children.map(c => c.id)).not.toContain(LOOK_OVERLAY_ID);
    const style = overlay!.attrs.get('style') ?? '';
    expect(style).toContain('position:absolute');
    expect(style).toContain(`z-index:${LOOK_OVERLAY_Z_IN_MAP}`);
    // …and it is gone from the map when the look comes off.
    applyLook(null);
    expect(doc.getElementById(LOOK_OVERLAY_ID)).toBeNull();
  });

  it('without a map element, falls back to body — fixed, but still below chrome', () => {
    applyLook('crt');
    const overlay = doc.getElementById(LOOK_OVERLAY_ID);
    expect(overlay).not.toBeNull();
    expect(overlay!.parent).toBe(doc.body);
    const style = overlay!.attrs.get('style') ?? '';
    expect(style).toContain('position:fixed');
    expect(style).toContain(`z-index:${LOOK_OVERLAY_Z_FALLBACK}`);
    expect(style).not.toContain('9990');
  });

  it('re-homes into the map on the next apply once the map exists', () => {
    applyLook('night-vision');
    expect(doc.getElementById(LOOK_OVERLAY_ID)?.parent).toBe(doc.body);
    const map = addMapElement();
    applyLook('night-vision');
    expect(doc.getElementById(LOOK_OVERLAY_ID)?.parent).toBe(map);
    // Still exactly one overlay element in the whole tree.
    expect(map.children.filter(c => c.id === LOOK_OVERLAY_ID)).toHaveLength(1);
    expect(doc.body.children.filter(c => c.id === LOOK_OVERLAY_ID)).toHaveLength(0);
  });

  it('rehomeLookOverlay moves a boot-placed overlay once the map appears', () => {
    // The real boot order on a cold load: the saved look is applied before
    // the Map is constructed, so the overlay starts in the body fallback;
    // the map calls rehomeLookOverlay() the moment it exists.
    applyLook('night-vision');
    expect(doc.getElementById(LOOK_OVERLAY_ID)?.parent).toBe(doc.body);
    const map = addMapElement();
    rehomeLookOverlay();
    const overlay = doc.getElementById(LOOK_OVERLAY_ID);
    expect(overlay?.parent).toBe(map);
    expect(overlay?.attrs.get('style')).toContain(`z-index:${LOOK_OVERLAY_Z_IN_MAP}`);
    // With no overlay active it is a no-op and creates nothing.
    applyLook(null);
    rehomeLookOverlay();
    expect(doc.getElementById(LOOK_OVERLAY_ID)).toBeNull();
  });

  it('targets the MapLibre container by its own class', () => {
    expect(LOOK_MAP_SELECTOR).toBe('.maplibregl-map');
  });
});
