'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { smoothAngleDeg } from '@/lib/cockpit';
import { cardinalFor } from '@/lib/cockpit-osd';
import {
  ALT_TAPE_LABEL_FT,
  ALT_TAPE_PX_PER_FT,
  ALT_TAPE_TICK_FT,
  BAND_DIM_OPACITY,
  EMPTY_PFD_SAMPLE,
  SPEED_TAPE_LABEL_KT,
  SPEED_TAPE_PX_PER_KT,
  SPEED_TAPE_TICK_KT,
  bandDimmed,
  bankEstimateAvailable,
  deriveVerticalSpeedFpm,
  estimateBankDeg,
  formatAltBox,
  formatSpeedBox,
  formatVsReadout,
  mergePfdSample,
  tapeAnchorFor,
  tapeStripOffsetPx,
  tapeTicks,
  turnRateDegPerSec,
  type PfdSample,
} from '@/lib/cockpit-pfd';
import { toFeet } from './FlightWatchPanel';
import type { CockpitFlightRecord } from './CockpitOSD';

/* ═══════════════════════════════════════════════════════════════
   OSIRIS — Cockpit glass PFD (pipeline #20)
   Rick asked for the ride's telemetry as aircraft instruments —
   "kinda like you're in the cockpit" — and picked the modern glass
   layout: speed tape left, attitude ball centre, altitude tape
   right, on the BOTTOM of the screen. His refinement is the design
   law here: the satellite view is the hero and the focal point; the
   instruments are secondary — low-profile, translucent glass the
   earth shows through, never a slab across the view. While the ride
   simply cruises, the band even fades back a little; a feed gap, a
   grabbed map, a hop, or any touch brings it to full strength.

   The numbers are the feed's own (speed, altitude, heading). Two
   are derived, and say so by their nature: vertical speed is the
   slope of real altitude reports, and the ball's bank is ESTIMATED
   from turn rate + ground speed (coordinated-turn math) — the feed
   carries no pitch or roll, so pitch is never drawn: the ladder is
   fixed at zero. Plain CSS/SVG shapes only — no filter references
   anywhere near this chrome (the iOS sensor-looks lesson), and like
   the rest of the OSD it is DOM outside the map, so sensor looks
   never wash it.

   Motion: a rAF loop chases the latest report with the same
   exponential blend the follow camera uses, writing transforms and
   text straight to the DOM — the tapes glide between the feed's
   30 s reports instead of jumping, and React never re-renders per
   frame. Through a feed gap the targets stop moving and the glass
   simply holds its last readings. A field the feed has never
   reported on this ride draws dashes, never 0 — zero is a reading
   (0 kt, 0 ft, 000°), not an absence.
   ═══════════════════════════════════════════════════════════════ */

interface CockpitPFDProps {
  flight: CockpitFlightRecord | null;
  flightHeld?: boolean;
  lock: 'follow' | 'free';
  targetIcao: string;
}

const GLASS: CSSProperties = {
  background: 'rgba(5,8,14,0.42)',
  backdropFilter: 'blur(4px)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
};
const TAPE_LABEL: CSSProperties = {
  color: 'rgba(232,230,224,0.55)', fontSize: 8, letterSpacing: '0.16em', textAlign: 'center',
};
const BOX: CSSProperties = {
  background: 'rgba(3,5,9,0.82)',
  border: '1.5px solid #FFB454',
  borderRadius: 4,
  color: '#FFB454',
  fontWeight: 700,
};

interface DisplayState {
  speed: number | null;
  altFt: number | null;
  heading: number | null;
  turnRate: number;
  bank: number;
  vs: number;
}

const chase = (current: number, target: number, dtMs: number, tauMs: number) =>
  current + (target - current) * (1 - Math.exp(-dtMs / tauMs));

export default function CockpitPFD({ flight, flightHeld = false, lock, targetIcao }: CockpitPFDProps) {
  const initSpeed = flight && typeof flight.speed_knots === 'number' ? flight.speed_knots : null;
  const initAltFt = flight && typeof flight.alt === 'number' ? toFeet(flight.alt) : null;
  const initHeading = flight ? flight.heading : null;

  /* Tape anchors step at feed cadence; the strips animate between them.
     Adjusted during render (React's previous-props pattern, the same
     one the OSD's observed trail uses) — an effect would lag a frame
     behind the report that moved them. */
  const [anchors, setAnchors] = useState(() => ({
    speed: initSpeed !== null ? tapeAnchorFor(initSpeed, SPEED_TAPE_TICK_KT) : 0,
    alt: initAltFt !== null ? tapeAnchorFor(initAltFt, ALT_TAPE_TICK_FT) : 0,
  }));
  const [anchorSrc, setAnchorSrc] = useState({ speed: initSpeed, alt: initAltFt });
  if (anchorSrc.speed !== initSpeed || anchorSrc.alt !== initAltFt) {
    setAnchorSrc({ speed: initSpeed, alt: initAltFt });
    setAnchors({
      speed: initSpeed !== null ? tapeAnchorFor(initSpeed, SPEED_TAPE_TICK_KT) : anchors.speed,
      alt: initAltFt !== null ? tapeAnchorFor(initAltFt, ALT_TAPE_TICK_FT) : anchors.alt,
    });
  }
  const anchorSpeed = anchors.speed;
  const anchorAlt = anchors.alt;

  /* The ride's sample: what each instrument has EVER been told on this
     ride. Records report per-field — a position-only sweep carries no
     altitude, no speed, no track — so each record folds into the
     sample (lib mergePfdSample): a reported field updates it (a
     reported 0 included), an unreported one holds its last value, and
     a never-reported one stays null, which is what draws dashes
     instead of a false 0. A hop starts over from the new target's own
     first record. Same render-adjust pattern as the anchors above. */
  const recordSample: PfdSample = { speed: initSpeed, altFt: initAltFt, heading: initHeading };
  const [heldSample, setHeldSample] = useState<PfdSample>(recordSample);
  const [heldSrc, setHeldSrc] = useState<{ target: string; sample: PfdSample }>({
    target: targetIcao, sample: recordSample,
  });
  if (
    heldSrc.target !== targetIcao
    || heldSrc.sample.speed !== recordSample.speed
    || heldSrc.sample.altFt !== recordSample.altFt
    || heldSrc.sample.heading !== recordSample.heading
  ) {
    const base = heldSrc.target === targetIcao ? heldSample : EMPTY_PFD_SAMPLE;
    setHeldSrc({ target: targetIcao, sample: recordSample });
    setHeldSample(mergePfdSample(base, recordSample));
  };

  const speedTicks = useMemo(
    () => tapeTicks(anchorSpeed, SPEED_TAPE_TICK_KT, SPEED_TAPE_LABEL_KT, SPEED_TAPE_PX_PER_KT),
    [anchorSpeed],
  );
  const altTicks = useMemo(
    () => tapeTicks(anchorAlt, ALT_TAPE_TICK_FT, ALT_TAPE_LABEL_FT, ALT_TAPE_PX_PER_FT),
    [anchorAlt],
  );

  /* The smoothed display state + the machinery that chases it. The
     chase targets ARE the held sample: once a field has been seen it
     never goes null again mid-ride, so a quiet record cannot pull a
     held reading back to dashes. */
  const dispRef = useRef<DisplayState>({
    speed: heldSample.speed, altFt: heldSample.altFt, heading: heldSample.heading,
    turnRate: 0, bank: 0, vs: 0,
  });
  const tgtRef = useRef<PfdSample>({ ...heldSample });
  const anchorRef = useRef({ speed: anchorSpeed, alt: anchorAlt });
  useEffect(() => {
    tgtRef.current = { speed: heldSample.speed, altFt: heldSample.altFt, heading: heldSample.heading };
    anchorRef.current = { speed: anchorSpeed, alt: anchorAlt };
  });
  const sampleRef = useRef<{ heading: number; atMs: number } | null>(null);
  const turnTargetRef = useRef(0);

  /* A new target starts the glass over from its own first report. */
  useEffect(() => {
    dispRef.current = {
      speed: tgtRef.current.speed, altFt: tgtRef.current.altFt, heading: tgtRef.current.heading,
      turnRate: 0, bank: 0, vs: 0,
    };
    sampleRef.current = null;
    turnTargetRef.current = 0;
  }, [targetIcao]);

  /* Each new report re-aims the turn-rate estimate. A record without
     a heading carries no turn information — it neither re-aims the
     estimate nor poisons the sample clock. */
  useEffect(() => {
    if (!flight || typeof flight.heading !== 'number') return;
    const now = performance.now();
    const prev = sampleRef.current;
    if (prev) {
      turnTargetRef.current = turnRateDegPerSec(prev.heading, flight.heading, now - prev.atMs);
    }
    sampleRef.current = { heading: flight.heading, atMs: now };
  }, [flight]);

  /* DOM handles the rAF loop writes to. */
  const speedStripRef = useRef<HTMLDivElement>(null);
  const altStripRef = useRef<HTMLDivElement>(null);
  const speedBoxRef = useRef<HTMLSpanElement>(null);
  const altBoxRef = useRef<HTMLSpanElement>(null);
  const vsRef = useRef<HTMLDivElement>(null);
  const rotorRef = useRef<HTMLDivElement>(null);
  const bankPointerRef = useRef<HTMLDivElement>(null);
  const hdgBoxRef = useRef<HTMLSpanElement>(null);
  const writtenRef = useRef({ speed: '', alt: '', vs: '', hdg: '' });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let prevAlt: number | null = null;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(Math.max(now - last, 1), 100);
      last = now;
      const d = dispRef.current;
      if (!d) return;
      const t = tgtRef.current;
      if (t.speed !== null) d.speed = d.speed === null ? t.speed : chase(d.speed, t.speed, dt, 1100);
      if (t.altFt !== null) d.altFt = d.altFt === null ? t.altFt : chase(d.altFt, t.altFt, dt, 1100);
      if (t.heading !== null) {
        d.heading = d.heading === null ? t.heading : smoothAngleDeg(d.heading, t.heading, 1 - Math.exp(-dt / 1100));
      }
      /* Turn rate decays when reports stop arriving altogether; while
         they flow, each new one re-aims it (the effect above). */
      const sample = sampleRef.current;
      const turnGoal = sample && now - sample.atMs > 60_000 ? 0 : turnTargetRef.current;
      d.turnRate = chase(d.turnRate, turnGoal, dt, 1600);
      /* No bank estimate exists until speed AND heading have both
         been reported this ride — the goal is then neutral, never a
         fabricated level-flight reading drawn from nothing. */
      const bankGoal = bankEstimateAvailable(t) ? estimateBankDeg(d.turnRate, d.speed ?? 0) : 0;
      d.bank = chase(d.bank, bankGoal, dt, 1300);
      /* Vertical speed is the slope of the displayed altitude itself —
         arithmetic on the same reports, smoothed like everything else. */
      if (d.altFt !== null && prevAlt !== null) {
        const inst = deriveVerticalSpeedFpm(prevAlt, d.altFt, dt);
        d.vs = chase(d.vs, inst, dt, 2200);
      } else if (t.altFt === null) {
        d.vs = chase(d.vs, 0, dt, 2200);
      }
      prevAlt = d.altFt;

      if (speedStripRef.current && d.speed !== null) {
        speedStripRef.current.style.transform =
          `translateY(${tapeStripOffsetPx(d.speed, anchorRef.current.speed, SPEED_TAPE_PX_PER_KT).toFixed(2)}px)`;
      }
      if (altStripRef.current && d.altFt !== null) {
        altStripRef.current.style.transform =
          `translateY(${tapeStripOffsetPx(d.altFt, anchorRef.current.alt, ALT_TAPE_PX_PER_FT).toFixed(2)}px)`;
      }
      const w = writtenRef.current;
      const speedText = formatSpeedBox(d.speed);
      if (speedBoxRef.current && w.speed !== speedText) { w.speed = speedText; speedBoxRef.current.textContent = speedText; }
      const altText = formatAltBox(d.altFt);
      if (altBoxRef.current && w.alt !== altText) { w.alt = altText; altBoxRef.current.textContent = altText; }
      /* The VS slope exists only once altitude has been seen this
         ride (the held target says so); before that, "VS —". */
      const vsText = formatVsReadout(d.vs, t.altFt !== null);
      if (vsRef.current && w.vs !== vsText) { w.vs = vsText; vsRef.current.textContent = vsText; }
      const hdgText = d.heading === null ? '—' : `${Math.round(((d.heading % 360) + 360) % 360)}° ${cardinalFor(d.heading)}`;
      if (hdgBoxRef.current && w.hdg !== hdgText) { w.hdg = hdgText; hdgBoxRef.current.textContent = hdgText; }
      if (rotorRef.current) rotorRef.current.style.transform = `rotate(${(-d.bank).toFixed(2)}deg)`;
      if (bankPointerRef.current) bankPointerRef.current.style.transform = `rotate(${d.bank.toFixed(2)}deg)`;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ── Cruise dim: fade back while simply cruising; any touch, a gap,
     a grab or a fresh target restores full strength. ── */
  const [dimmed, setDimmed] = useState(false);
  const cruiseStartRef = useRef(0);
  const interactRef = useRef<number | null>(null);
  useEffect(() => {
    cruiseStartRef.current = Date.now();
    interactRef.current = null;
  }, [targetIcao]);
  useEffect(() => {
    const onPointer = () => { interactRef.current = Date.now(); setDimmed(false); };
    window.addEventListener('pointerdown', onPointer, { passive: true });
    const iv = setInterval(() => {
      setDimmed(bandDimmed({
        lock, flightHeld, hasFlight: !!flight,
        nowMs: Date.now(), cruiseStartMs: cruiseStartRef.current, lastInteractMs: interactRef.current,
      }));
    }, 1000);
    return () => { window.removeEventListener('pointerdown', onPointer); clearInterval(iv); };
  }, [lock, flightHeld, flight]);

  /* A tape exists once its field has been reported on this ride — and
     never un-exists mid-ride when a later record goes quiet on it. */
  const hasSpeed = heldSample.speed !== null;
  const hasAlt = heldSample.altFt !== null;
  const bankAvailable = bankEstimateAvailable(heldSample);

  return (
    <div
      data-cockpit-band
      className="absolute left-2 right-2 md:left-4 md:right-4 h-[104px] md:h-[120px] flex items-stretch justify-between gap-2"
      style={{
        bottom: 'max(8px, env(safe-area-inset-bottom))',
        opacity: dimmed ? BAND_DIM_OPACITY : 1,
        transition: 'opacity 700ms ease',
      }}
      aria-label="Flight instruments"
    >
      {/* ── LEFT — speed tape ── */}
      <div className="flex flex-col w-[62px] md:w-[72px]">
        <div style={TAPE_LABEL}>SPD · KT</div>
        <div className="relative flex-1 overflow-hidden" style={GLASS}>
          {hasSpeed && (
            <div ref={speedStripRef} className="absolute inset-0 will-change-transform">
              {speedTicks.map((tick) => (
                <div
                  key={tick.value}
                  className="absolute left-0 right-0 flex items-center justify-between pl-1.5 pr-1"
                  style={{ top: `calc(50% + ${tick.yPx}px)`, transform: 'translateY(-50%)' }}
                >
                  <span className="text-[9px] tabular-nums" style={{ color: 'rgba(232,230,224,0.85)' }}>
                    {tick.label ? tick.value : ''}
                  </span>
                  <span style={{
                    display: 'block', height: 1, width: tick.label ? 12 : 7,
                    background: 'rgba(232,230,224,0.6)',
                  }} />
                </div>
              ))}
            </div>
          )}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
            <span ref={speedBoxRef} style={{ ...BOX, fontSize: 14, padding: '1px 7px' }} className="tabular-nums">
              {formatSpeedBox(heldSample.speed)}
            </span>
          </div>
        </div>
      </div>

      {/* ── CENTRE — attitude ball + heading ── */}
      <div className="relative flex-1 flex items-center justify-center">
        <div
          className="relative w-[88px] h-[88px] md:w-[104px] md:h-[104px] rounded-full overflow-hidden flex-shrink-0"
          style={{ ...GLASS, borderRadius: '50%' }}
          role="img"
          aria-label="Attitude indicator — bank estimated from turn rate"
        >
          {/* The horizon rotor: sky over ground, rolling with the
              estimated bank. Pitch stays at zero — no pitch data
              exists to draw, so the ladder is fixed to the horizon. */}
          <div ref={rotorRef} className="absolute will-change-transform" style={{
            width: '220%', height: '220%', left: '-60%', top: '-60%',
          }}>
            <div className="absolute left-0 right-0 top-0" style={{
              height: '50%', background: 'linear-gradient(to bottom, #3A7BD5, #2B5EA6)',
            }} />
            <div className="absolute left-0 right-0 bottom-0" style={{
              height: '50%', background: 'linear-gradient(to bottom, #8A5A2B, #67431F)',
            }} />
            <div className="absolute left-0 right-0" style={{ top: 'calc(50% - 1px)', height: 2, background: '#fff' }} />
            <div className="absolute" style={{ left: '33%', width: '34%', top: 'calc(50% - 14px)', height: 1.5, background: 'rgba(255,255,255,0.85)' }} />
            <div className="absolute" style={{ left: '33%', width: '34%', top: 'calc(50% + 12px)', height: 1.5, background: 'rgba(255,255,255,0.85)' }} />
            <div className="absolute" style={{ left: '39%', width: '22%', top: 'calc(50% - 27px)', height: 1.5, background: 'rgba(255,255,255,0.7)' }} />
            <div className="absolute" style={{ left: '39%', width: '22%', top: 'calc(50% + 25px)', height: 1.5, background: 'rgba(255,255,255,0.7)' }} />
          </div>
          {/* Bank arc — fixed scale across the top. */}
          {[-45, -30, -20, -10, 0, 10, 20, 30, 45].map((a) => (
            <div key={a} className="absolute inset-0" style={{ transform: `rotate(${a}deg)` }}>
              <div style={{
                position: 'absolute', left: '50%', top: 3, width: 2, marginLeft: -1,
                height: a === 0 || Math.abs(a) === 30 || Math.abs(a) === 45 ? 9 : 6,
                background: 'rgba(255,255,255,0.75)',
              }} />
            </div>
          ))}
          {/* Bank pointer — rolls with the estimate. */}
          <div ref={bankPointerRef} className="absolute inset-0 will-change-transform">
            <div style={{
              position: 'absolute', left: '50%', top: 11, transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
              borderTop: '8px solid #FFB454',
            }} />
          </div>
          {/* The fixed aircraft symbol — wings and a centre dot, the
              classic W without the fuss. */}
          <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <div className="relative" style={{ width: 24, height: 4, background: '#FFB454' }}>
              <div style={{ position: 'absolute', left: 0, top: 4, width: 4, height: 7, background: '#FFB454' }} />
            </div>
            <div className="rounded-full flex-shrink-0" style={{ width: 7, height: 7, background: '#FFB454', margin: '0 3px' }} />
            <div className="relative" style={{ width: 24, height: 4, background: '#FFB454' }}>
              <div style={{ position: 'absolute', right: 0, top: 4, width: 4, height: 7, background: '#FFB454' }} />
            </div>
          </div>
          {/* The estimate's label exists only when an estimate does:
              with no speed/heading ever reported there is nothing to
              label, and the ball just sits neutral. */}
          {bankAvailable && (
            <div className="absolute left-0 right-0 text-center" style={{
              bottom: 7, fontSize: 7, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.75)',
            }}>
              BANK EST
            </div>
          )}
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none" style={{ bottom: 0 }}>
          <span ref={hdgBoxRef} style={{ ...BOX, fontSize: 12, padding: '1px 8px' }} className="tabular-nums whitespace-nowrap">
            {heldSample.heading === null ? '—' : `${Math.round(((heldSample.heading % 360) + 360) % 360)}° ${cardinalFor(heldSample.heading)}`}
          </span>
        </div>
      </div>

      {/* ── RIGHT — altitude tape + derived vertical speed ── */}
      <div className="flex flex-col w-[62px] md:w-[72px]">
        <div style={TAPE_LABEL}>ALT · FT</div>
        <div className="relative flex-1 overflow-hidden" style={GLASS}>
          {hasAlt && (
            <div ref={altStripRef} className="absolute inset-0 will-change-transform">
              {altTicks.map((tick) => (
                <div
                  key={tick.value}
                  className="absolute left-0 right-0 flex items-center justify-between pl-1 pr-1.5"
                  style={{ top: `calc(50% + ${tick.yPx}px)`, transform: 'translateY(-50%)' }}
                >
                  <span style={{
                    display: 'block', height: 1, width: tick.label ? 12 : 7,
                    background: 'rgba(232,230,224,0.6)',
                  }} />
                  <span className="text-[9px] tabular-nums" style={{ color: 'rgba(232,230,224,0.85)' }}>
                    {tick.label ? tick.value.toLocaleString('en-US') : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
            <span ref={altBoxRef} style={{ ...BOX, fontSize: 12, padding: '1px 6px' }} className="tabular-nums">
              {formatAltBox(heldSample.altFt)}
            </span>
          </div>
        </div>
        <div ref={vsRef} className="text-center tabular-nums" style={{
          color: 'rgba(232,230,224,0.75)', fontSize: 9, letterSpacing: '0.08em', marginTop: 2,
        }}>
          {formatVsReadout(0, hasAlt)}
        </div>
      </div>
    </div>
  );
}
