'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Check, ListChecks, LocateFixed, Plane, Radio, Satellite, Video, X,
} from 'lucide-react';
import {
  MISSIONS, applyMissionEvent, dismissMissions, isMissionComplete, missionProgress,
  readMissionsState, shouldAutoOpenMissions, writeMissionsState,
  type MissionEvent, type MissionId, type MissionsState,
} from '@/lib/missions';

/**
 * Glass Earth — the first-run missions card.
 *
 * A compact, non-modal introduction: it can sit over a corner of the map
 * while the visitor still pans and zooms, it leaves in one tap, and once
 * dismissed it never opens itself again. The Missions entry in the layer
 * panel can reopen it whenever the visitor asks.
 *
 * This component does not decide what counts as doing a mission. The
 * page translates its real state into the signals below — a ride really
 * started, the camera badge really said LIVE VIDEO, the audio element
 * really played a tuner landing, the compare divider really moved, a
 * flight really joined the watch list — and lib/missions turns those
 * events into completions. “Take me there” only navigates.
 */

export interface MissionSignals {
  /** The page's cockpit state is in a ride right now. */
  cockpitActive: boolean;
  /** How many flights the page is currently watching. */
  watchedFlightCount: number;
  /** The camera viewer reported a LIVE VIDEO badge, stamped per report. */
  liveVideo: { cameraId: string; at: number } | null;
  /** The radio audio element started playing, with the source that chose
   *  the station — only a tuner landing completes the radio mission. */
  radioPlaying: { uuid: string; at: number; source: 'tuner' | 'stations' | null } | null;
  /** The Date Compare divider moved under the visitor's hand. */
  dateCompareSwipedAt: number | null;
}

interface MissionsCardProps {
  /** The splash has gone: the card never fights the boot sequence. */
  active: boolean;
  /** A cockpit ride owns the screen — the card and its guide step aside. */
  suspended?: boolean;
  /** Increment to reopen the card from the permanent Missions entry. */
  openSignal: number;
  signals: MissionSignals;
  /** Drive the real app for a mission (layers, flights, panels). */
  onAction: (id: MissionId) => void;
}

const MISSION_ICONS: Record<MissionId, React.ComponentType<{ className?: string }>> = {
  cockpit: Plane,
  camera: Video,
  radio: Radio,
  compare: Satellite,
  track: LocateFixed,
};

export default function MissionsCard({
  active,
  suspended = false,
  openSignal,
  signals,
  onAction,
}: MissionsCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [stored, setStored] = useState(false);
  const [state, setState] = useState<MissionsState>({ dismissed: false, completed: [] });
  const [open, setOpen] = useState(false);
  const [guideId, setGuideId] = useState<MissionId | null>(null);

  const dirtyRef = useRef(false);
  const autoOpenedRef = useRef(false);
  const lastOpenSignalRef = useRef(openSignal);
  const wasRidingRef = useRef<boolean | null>(null);
  const lastLiveVideoAtRef = useRef(0);
  const lastRadioAtRef = useRef(0);
  const lastSwipeAtRef = useRef(0);

  /* Load once, on the client. Nothing is written back until the visitor
     actually dismisses the card or completes something — merely having
     been shown the card must not quietly use up the first run. */
  useEffect(() => {
    const record = readMissionsState();
    setState(record.state);
    setStored(record.stored);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || !dirtyRef.current) return;
    writeMissionsState(state);
  }, [loaded, state]);

  const applyEvent = useCallback((event: MissionEvent) => {
    setState(prev => {
      const next = applyMissionEvent(prev, event);
      if (next !== prev) dirtyRef.current = true;
      return next;
    });
  }, []);

  /* ── Honest completion signals, one per mission ───────────────────── */

  // A ride completes the cockpit mission on the transition into riding,
  // not when the mission button arms the flights layer.
  useEffect(() => {
    if (!loaded) return;
    if (wasRidingRef.current === false && signals.cockpitActive) {
      applyEvent({ type: 'cockpit-started' });
    }
    wasRidingRef.current = signals.cockpitActive;
  }, [loaded, signals.cockpitActive, applyEvent]);

  // Joining the watch list completes the tracking mission — including a
  // target re-found from a shared link, which joins the same list.
  useEffect(() => {
    if (loaded && signals.watchedFlightCount > 0) {
      applyEvent({ type: 'flight-watch-started' });
    }
  }, [loaded, signals.watchedFlightCount, applyEvent]);

  useEffect(() => {
    const signal = signals.liveVideo;
    if (!loaded || !signal || signal.at === lastLiveVideoAtRef.current) return;
    lastLiveVideoAtRef.current = signal.at;
    applyEvent({ type: 'live-video-camera' });
  }, [loaded, signals.liveVideo, applyEvent]);

  useEffect(() => {
    const signal = signals.radioPlaying;
    if (!loaded || !signal || signal.at === lastRadioAtRef.current) return;
    lastRadioAtRef.current = signal.at;
    applyEvent({ type: 'radio-playing', source: signal.source });
  }, [loaded, signals.radioPlaying, applyEvent]);

  useEffect(() => {
    const at = signals.dateCompareSwipedAt;
    if (!loaded || !at || at === lastSwipeAtRef.current) return;
    lastSwipeAtRef.current = at;
    applyEvent({ type: 'date-compare-swiped' });
  }, [loaded, signals.dateCompareSwipedAt, applyEvent]);

  /* ── Opening and dismissal ────────────────────────────────────────── */

  useEffect(() => {
    if (!loaded || !active || suspended || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    if (shouldAutoOpenMissions({ state, stored })) setOpen(true);
  }, [loaded, active, suspended, state, stored]);

  useEffect(() => {
    if (openSignal === lastOpenSignalRef.current) return;
    lastOpenSignalRef.current = openSignal;
    setGuideId(null);
    setOpen(true);
  }, [openSignal]);

  // A ride takes the whole screen; a card left open simply closes. That
  // is not a dismissal — the stored record is untouched by it.
  useEffect(() => {
    if (suspended) setOpen(false);
  }, [suspended]);

  const dismiss = useCallback(() => {
    dirtyRef.current = true;
    setStored(true);
    setState(prev => dismissMissions(prev));
    setOpen(false);
    setGuideId(null);
  }, []);

  const takeMeThere = useCallback((id: MissionId) => {
    onAction(id);
    setGuideId(id);
    setOpen(false);
  }, [onAction]);

  if (!loaded || !active) return null;

  const progress = missionProgress(state);
  const guide = guideId ? MISSIONS.find(m => m.id === guideId) ?? null : null;
  const guideComplete = guide ? isMissionComplete(state, guide.id) : false;

  if (!open) {
    if (!guide || suspended) return null;
    const GuideIcon = MISSION_ICONS[guide.id];
    return (
      <div
        className="fixed inset-x-2 bottom-[68px] z-[450] md:left-20 md:right-auto md:bottom-24 md:w-[410px]"
        data-testid="missions-guide"
      >
        <div className="glass-panel flex items-start gap-3 p-3">
          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${guideComplete ? 'bg-emerald-400/15 text-emerald-300' : 'bg-[var(--gold-primary)]/10 text-[var(--gold-primary)]'}`}>
            {guideComplete ? <Check className="h-4 w-4" /> : <GuideIcon className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-primary)]">
              {guideComplete ? 'Done — ' : ''}{guide.title}
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">{guide.guide}</p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--gold-primary)] hover:text-[var(--gold-light)]"
            >
              Missions · {progress.done} of {progress.total}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setGuideId(null)}
            aria-label="Hide this guidance"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (suspended) return null;

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label="First-run missions"
      data-testid="missions-card"
      className="fixed inset-x-2 bottom-[68px] z-[940] md:left-20 md:right-auto md:bottom-24 md:w-[410px]"
    >
      {/* A bottom sheet on a phone, not a full-screen takeover: the sheet
          is capped, the mission list scrolls inside it, and the header
          and the Skip button stay put at its top and bottom edges. */}
      <div className="glass-panel flex max-h-[68dvh] flex-col p-4 md:max-h-[min(760px,calc(100dvh-136px))]">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--gold-primary)]/10 text-[var(--gold-primary)]">
            <ListChecks className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)]">First steps</div>
            <h2 className="mt-0.5 text-[15px] font-semibold leading-tight text-[var(--text-primary)]">Try five real things</h2>
            <p className="mt-1 text-[11px] leading-snug text-[var(--text-secondary)]">
              Short introductions to what Glass Earth does. Each one finishes when you have actually done it.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-[var(--border-primary)] px-2 py-1 font-mono text-[9px] tabular-nums text-[var(--text-secondary)]" aria-label={`${progress.done} of ${progress.total} missions complete`}>
              {progress.done} of {progress.total}
            </span>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss missions"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <ol className="styled-scrollbar mt-2 min-h-0 flex-1 divide-y divide-[var(--border-secondary)] overflow-y-auto">
          {MISSIONS.map(mission => {
            const done = isMissionComplete(state, mission.id);
            const Icon = MISSION_ICONS[mission.id];
            return (
              <li key={mission.id} className="flex gap-3 py-3">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/[0.04] text-[var(--text-secondary)]'}`}>
                  {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className={`text-[12px] font-semibold leading-tight ${done ? 'text-[var(--text-muted)] line-through decoration-emerald-300/60' : 'text-[var(--text-primary)]'}`}>
                    {mission.title}
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">{mission.why}</p>
                  {done ? (
                    <span className="mt-1 inline-block font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-300">Done</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => takeMeThere(mission.id)}
                      className="mt-1.5 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border-primary)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--gold-primary)] transition-colors hover:border-[var(--border-active)] hover:text-[var(--gold-light)]"
                    >
                      {mission.actionLabel}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-1 border-t border-[var(--border-secondary)] pt-3">
          {progress.allComplete ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300" role="status">
              All missions complete — nice exploring.
            </p>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              className="min-h-9 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              Skip — just explore
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
