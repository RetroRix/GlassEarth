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
  buildLookCss,
  lookPlan,
  parseLookId,
  applyLook,
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
  textContent = '';
  innerHTML = '';
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
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

function makeDocument() {
  const body = new FakeEl('body');
  const head = new FakeEl('head');
  const find = (el: FakeEl, id: string): FakeEl | null => {
    if (el.id === id) return el;
    for (const c of el.children) { const hit = find(c, id); if (hit) return hit; }
    return null;
  };
  return {
    body,
    head,
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => find(body, id) ?? find(head, id),
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
