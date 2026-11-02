/**
 * Glass Earth — notable-aircraft watchlist (Globe Command scout, picked
 * by Rick 2026-11-02; rides the Smart Alerts surface from #5).
 *
 * A small curated watchlist — the E-4B, RC-135 family, U-2, B-52, B-2,
 * P-8, RQ-4, the tankers, and the Air Force One / SAM callsigns —
 * matched against the flights feed the app already carries (adsb.lol
 * via /api/flights). A match becomes a Smart Alert.
 *
 * Sighting-honest by construction: every alert states exactly what the
 * feed broadcast (callsign, type code, registration) and what rule it
 * matched, and the panel copy says the rest — many such flights never
 * broadcast at all, fly filtered, or use ordinary callsigns, so a
 * sighting is a sighting and silence never means none are flying.
 * Nothing here claims tracking coverage.
 */

import type { SmartAlert } from './smart-alerts';

/** A flights-feed row, as /api/flights classifies it. */
export interface FlightLike {
  icao24: string;
  callsign: string;
  model: string;
  registration?: string;
  lat: number;
  lng: number;
  /** Metres, null when the feed has no altitude for this report. */
  alt: number | null;
  grounded?: boolean;
}

export interface NotableMatch {
  /** What to call it — basis-qualified wherever the match is suggestive. */
  label: string;
  /** How it matched, in plain words, printed on the alert. */
  basis: string;
}

/** The four E-4B Nightwatch airframes, by the serial they broadcast. */
const E4B_REGISTRATIONS = new Set(['73-1676', '73-1677', '74-0787', '75-0125']);

/** Type codes that are unambiguous on their own — the code names one
    military type, never a civilian airframe. */
const TYPE_LABELS: Record<string, string> = {
  B2: 'B-2 Spirit',
  U2: 'U-2',
  B52: 'B-52 Stratofortress',
  Q4: 'RQ-4 Global Hawk',
  P8: 'P-8 Poseidon',
  K35R: 'KC-135 Stratotanker',
};

/** Military airlift/tanker callsign families — used only to qualify
    types that civilians also fly (KC-46 / KC-10 airframes). */
const MIL_CALLSIGN = /^(RCH|REACH|SAM|GOLD|TEAM)\d/;

export function matchNotable(f: FlightLike): NotableMatch | null {
  const cs = (f.callsign || '').replace(/\s+/g, '').toUpperCase();
  const type = (f.model || '').toUpperCase();
  const reg = (f.registration || '').toUpperCase();

  if (cs === 'AF1') return { label: 'Air Force One', basis: 'callsign AF1, as broadcast' };
  if (cs === 'AF2') return { label: 'Air Force Two', basis: 'callsign AF2, as broadcast' };
  if (/^VENUS\d/.test(cs)) return { label: 'VC-25 trainer (VENUS callsign)', basis: `callsign ${cs}` };
  if (E4B_REGISTRATIONS.has(reg)) return { label: 'E-4B Nightwatch', basis: `registration ${reg} — an E-4B airframe` };
  if (/^JAKE\d/.test(cs) || /^OLIVE\d/.test(cs)) {
    return { label: 'RC-135 signals aircraft', basis: `callsign ${cs} — the RC-135 fleet's working callsign` };
  }
  if (type && TYPE_LABELS[type]) return { label: TYPE_LABELS[type], basis: `type ${type}, as broadcast` };
  if (type === 'B762' && MIL_CALLSIGN.test(cs)) {
    return { label: 'KC-46 Pegasus', basis: `tanker type B762 on military callsign ${cs}` };
  }
  if (type === 'DC10' && MIL_CALLSIGN.test(cs)) {
    return { label: 'KC-10 Extender', basis: `tanker type DC10 on military callsign ${cs}` };
  }
  if (type === 'B742' && /^SAM\d/.test(cs)) {
    return { label: 'Air Force 747 on a Special Air Mission', basis: `type B742, callsign ${cs}` };
  }
  if (/^SAM\d/.test(cs)) {
    return { label: 'Special Air Mission flight', basis: `callsign ${cs} — the Air Force VIP airlift fleet` };
  }
  return null;
}

const HONESTY_LINE = 'Spotted on the ADS-B feed — many such flights never broadcast at all, so no sighting never means none are flying.';

/** One alert per matched aircraft per UTC day (the fired-id record in
    lib/smart-alerts then keeps it to once, like every other kind). */
export function evaluateNotableAircraft(flights: FlightLike[], now: number): SmartAlert[] {
  const day = new Date(now).toISOString().slice(0, 10);
  const out: SmartAlert[] = [];
  for (const f of flights) {
    if (!f.icao24 || f.grounded) continue;
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) continue;
    const match = matchNotable(f);
    if (!match) continue;
    const alt = typeof f.alt === 'number' && Number.isFinite(f.alt)
      ? ` · ${Math.round(f.alt * 3.28084).toLocaleString()} ft`
      : '';
    out.push({
      id: `aircraft:${f.icao24.toLowerCase()}:${day}`,
      kind: 'aircraft',
      title: `Notable aircraft spotted — ${match.label}`,
      body: `Callsign ${f.callsign || '—'} · type ${f.model || '—'}${alt}. Matched: ${match.basis}. ${HONESTY_LINE}`,
      at: now,
      firedAt: now,
      lat: f.lat,
      lng: f.lng,
    });
  }
  return out;
}
