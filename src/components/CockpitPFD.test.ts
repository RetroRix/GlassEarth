import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CockpitPFD from './CockpitPFD';
import type { CockpitFlightRecord } from './CockpitOSD';

// SSR per the repo's component-test pattern: effects (the rAF chase,
// the cruise-dim clock) do not run — what is asserted is the band's
// rendered state from its props, the contract the glass makes.

const flight: CockpitFlightRecord = {
  icao24: 'abc123', callsign: 'SKW5109',
  lat: 39.9, lng: -105.1, alt: 10_000, speed_knots: 450, heading: 304, grounded: false,
};
const noopProps = { lock: 'follow' as const, targetIcao: 'abc123' };

const render = (over: Partial<Parameters<typeof CockpitPFD>[0]> = {}) =>
  renderToStaticMarkup(createElement(CockpitPFD, { flight, ...noopProps, ...over }));

describe('CockpitPFD — the glass band', () => {
  it('carries the three instruments: speed tape, attitude ball, altitude tape', () => {
    const html = render();
    expect(html).toContain('data-cockpit-band');
    expect(html).toContain('SPD · KT');
    expect(html).toContain('ALT · FT');
    expect(html).toContain('BANK EST'); // the estimate, labelled on the glass
    expect(html).toContain('VS 0'); // derived vertical speed starts at the slope it has: none
  });

  it('boxes the live values at the tape centres', () => {
    const html = render();
    expect(html).toContain('>450<'); // ground speed, boxed
    expect(html).toContain('>32,800<'); // altitude in feet, boxed
    expect(html).toContain('304° NW'); // heading, boxed beneath the ball
  });

  it('draws tape ticks around the live values', () => {
    const html = render();
    expect(html).toContain('>440<'); // a labelled speed tick near 450
    expect(html).toContain('>32,500<'); // a labelled altitude tick near 32 800
  });

  it('before the first report the boxes dash and the band still stands', () => {
    const html = render({ flight: null });
    expect(html).toContain('data-cockpit-band');
    expect(html).toContain('BANK EST');
    expect(html).not.toContain('>450<');
  });

  it('a record without a speed dashes only the speed box', () => {
    const html = render({ flight: { ...flight, speed_knots: null } });
    expect(html).toContain('>32,800<'); // altitude still reads
    expect(html).not.toContain('>450<');
  });

  it('uses no SVG filter references and no sensor-look hooks', () => {
    const html = render();
    expect(html).not.toContain('url('); // the iOS lesson: no filter refs in chrome
    expect(html).not.toContain('ge-look-media'); // instruments are never look-treated
    expect(html).not.toContain('<filter');
  });
});
