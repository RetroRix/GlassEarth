import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PumpkinGlobe from './PumpkinGlobe';

// No JSX here on purpose: the repo's vitest include is *.test.ts only,
// so the component is exercised via createElement + renderToStaticMarkup.
describe('PumpkinGlobe', () => {
  const html = renderToStaticMarkup(
    createElement(PumpkinGlobe, { className: 'w-52 h-52', title: 'Glass Earth Halloween logo' }),
  );

  it('exposes the accessible name and the layered structure', () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('Glass Earth Halloween logo');
    for (const layer of ['pumpkin-globe__disc', 'pumpkin-globe__strip', 'pumpkin-globe__tint', 'pumpkin-globe__ribs', 'pumpkin-globe__shade', 'pumpkin-globe__stem', 'pumpkin-globe__face']) {
      expect(html).toContain(layer);
    }
  });

  it('carries a complete carved face: two eyes, a nose, a jagged grin', () => {
    expect(html).toContain('<polygon points="28,34 46,39 36,50"');
    expect(html).toContain('<polygon points="72,34 54,39 64,50"');
    expect(html).toContain('<polygon points="50,54 44,63 56,63"');
    expect(html).toContain('M22,66 L29,60 L35,67 L42,60 L50,67');
  });

  it('passes a custom className through to the outer mark', () => {
    expect(html).toContain('pumpkin-globe w-52 h-52');
  });
});
