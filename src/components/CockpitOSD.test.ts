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

describe('CockpitOSD — the FPV layout with the glass PFD', () => {
  it('puts identity in the top corners and the telemetry in the bottom band', () => {
    const html = render();
    expect(html).toContain('SKW5109'); // callsign, top-left
    expect(html).toContain('ABC123'); // ICAO, beside it
    expect(html).toContain('HDG'); // heading, top-centre
    expect(html).toContain('304° NW'); // digits + cardinal
    expect(html).toContain('SPD · KT'); // the speed tape, bottom-left of the band
    expect(html).toContain('450'); // the boxed ground speed
    expect(html).toContain('ALT · FT'); // the altitude tape, bottom-right
    expect(html).toContain('32,800'); // toFeet(10 000 m), boxed on the tape
    expect(html).toContain('BANK EST'); // the attitude ball, honestly labelled
    expect(html).toContain('VS 0'); // derived vertical speed under the alt tape
    expect(html).toContain('LEAVE'); // the way out, a corner button
  });

  it('the old corner pills are gone — the band replaced them', () => {
    const html = render();
    expect(html).not.toContain('GND SPEED');
    expect(html).not.toContain('32,800 ft'); // the value lives on the tape now, not a pill
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

  it('before the first report, the corner carries the feed-gap note — there is nothing to hold yet', () => {
    const html = render({ flight: null, flights: [] });
    expect(html).toContain('FEED GAP — NO REPORT YET');
    expect(html).not.toContain('Waiting for the next position report'); // retired wording
    expect(html).toContain('SKW5109'); // the target still names the corner
    expect(html).not.toContain('NEARBY');
  });
});

/* ── The 2026-10-26 fixes: a gap in the sweep must not blank the ride ──
   Round 1: a partial sweep is no-new-data. Round 2: the same rule for
   complete-sweep misses and stale-served records — the page holds the
   last record seen and passes it with flightHeld set; the OSD keeps
   every value on screen under the FEED GAP note, instead of blanking
   the readouts to "—" the way the gauntlet watched it do. */
describe('CockpitOSD — riding through a gap in the feed', () => {
  it('a held record keeps its values and is flagged as a feed gap', () => {
    const html = render({ flight, flightHeld: true });
    expect(html).toContain('FEED GAP — SHOWING LAST REPORT');
    expect(html).toContain('32,800'); // held altitude, on the tape
    expect(html).toContain('450'); // held ground speed, boxed
    expect(html).toContain('304° NW');
    expect(html).not.toContain('Waiting for the next position report');
    expect(html).not.toContain('NO REPORT YET');
  });

  it('a fresh record shows no gap note', () => {
    const html = render({ flight, flightHeld: false });
    expect(html).not.toContain('FEED GAP');
  });

  it('the no-report state is only for having no record at all', () => {
    const html = render({ flight: null, flightHeld: true, flights: [] });
    expect(html).toContain('FEED GAP — NO REPORT YET');
    expect(html).not.toContain('SHOWING LAST REPORT');
  });
});
