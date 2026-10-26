import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CockpitOSD, { type CockpitFlightRecord } from './CockpitOSD';
import type { CockpitTarget, ContactFlight } from '@/lib/cockpit';

// No JSX here on purpose: the repo's vitest include is *.test.ts only,
// so the component is exercised via createElement + renderToStaticMarkup.
// Effects (the airframe lookups) do not run under SSR — what is asserted
// is the OSD's rendered state from its props, which is the contract the
// FPV rework makes: corners carry the ride, the centre stays empty.

const target: CockpitTarget = { icao24: 'abc123', callsign: 'SKW5109' };
const flight: CockpitFlightRecord = {
  icao24: 'abc123', callsign: 'SKW5109',
  lat: 39.9, lng: -105.1, alt: 10_000, speed_knots: 450, heading: 304, grounded: false,
};
const near: ContactFlight = {
  icao24: 'def456', callsign: 'UAL900', lat: 40.1, lng: -105.0, alt: 9500, model: 'B739',
};
const noop = () => {};

const render = (over: Partial<Parameters<typeof CockpitOSD>[0]> = {}) =>
  renderToStaticMarkup(createElement(CockpitOSD, {
    target,
    flight,
    lock: 'follow',
    flights: [flight, near],
    onHop: noop,
    onRecenter: noop,
    onExit: noop,
    onRouteGeometry: noop,
    ...over,
  }));

describe('CockpitOSD — the FPV corner layout', () => {
  it('puts the ride in the corners: callsign top-left, heading top-centre, alt and speed at the bottom', () => {
    const html = render();
    expect(html).toContain('SKW5109'); // callsign, top-left
    expect(html).toContain('ABC123'); // ICAO, beside it
    expect(html).toContain('HDG'); // heading, top-centre
    expect(html).toContain('304° NW'); // digits + cardinal
    expect(html).toContain('ALT');
    expect(html).toContain('32,800 ft'); // formatAlt(10 000 m)
    expect(html).toContain('GND SPEED');
    expect(html).toContain('450 kt');
    expect(html).toContain('LEAVE'); // the way out, a corner button
  });

  it('has no centre panel and none of the old strip chrome', () => {
    const html = render();
    expect(html).not.toContain('glass-panel');
    expect(html).not.toContain('RIDING ALONG'); // the old strip's badge
    expect(html).not.toContain('NEARBY FLIGHTS'); // the old panel's roster heading
    expect(html).not.toContain('Identifying airframe'); // no panel body copy
  });

  it('the contacts roster starts collapsed into its right-edge chip', () => {
    const html = render();
    expect(html).toContain('NEARBY · 1'); // the chip, with the count
    expect(html).not.toContain('UAL900'); // the list itself stays shut
    expect(html).not.toContain('TAP TO HOP');
  });

  it('no contacts, no chip', () => {
    const html = render({ flights: [flight] });
    expect(html).not.toContain('NEARBY');
  });

  it('a grabbed map reads as an OSD warning, with the way back in the corner', () => {
    const html = render({ lock: 'free' });
    expect(html).toContain('FOLLOW PAUSED');
    expect(html).toContain('RE-CENTRE');
  });

  it('following again, the paused chrome is gone', () => {
    const html = render({ lock: 'follow' });
    expect(html).not.toContain('FOLLOW PAUSED');
    expect(html).not.toContain('RE-CENTRE');
  });

  it('a feed gap says so in the corner and blanks the readouts honestly', () => {
    const html = render({ flight: null, flights: [] });
    expect(html).toContain('Waiting for the next position report');
    expect(html).toContain('SKW5109'); // the target still names the corner
    expect(html).not.toContain('NEARBY');
  });
});

/* ── The 2026-10-26 fix: a partial sweep must not blank the ride ──
   The page holds the last complete-payload record and passes it with
   flightHeld set; the OSD keeps every value on screen and says so,
   instead of switching to the waiting state with blank readouts. */
describe('CockpitOSD — riding through a partial sweep', () => {
  it('a held record keeps its values and is flagged as a feed gap', () => {
    const html = render({ flight, flightHeld: true });
    expect(html).toContain('FEED GAP');
    expect(html).toContain('32,800 ft');
    expect(html).toContain('450 kt');
    expect(html).toContain('304° NW');
    expect(html).not.toContain('Waiting for the next position report');
  });

  it('a fresh record shows no gap note', () => {
    const html = render({ flight, flightHeld: false });
    expect(html).not.toContain('FEED GAP');
  });

  it('the waiting state is only for having no record at all', () => {
    const html = render({ flight: null, flightHeld: true, flights: [] });
    expect(html).toContain('Waiting for the next position report');
    expect(html).not.toContain('FEED GAP');
  });
});
