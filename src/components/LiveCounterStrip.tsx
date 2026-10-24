'use client';

import { useEffect, useState } from 'react';
import { Activity, Plane, Satellite, Video } from 'lucide-react';
import { counterMetricStates, deriveLiveCounts, type LiveCounts, type LiveCountsData } from '@/lib/live-counts';
import type { FlightFeedStatus } from '@/lib/flight-load';

/**
 * Glass Earth — the live counter strip under the header.
 *
 * "The planet right now": how many aircraft are in the air, satellites are
 * being tracked, cameras are in the catalogue, quakes shook the last day.
 * Every number is derived from the data the app already loaded for its own
 * layers (lib/live-counts) — a metric whose data has not arrived is simply
 * not shown, and if none has, the strip is not shown either — except AIR:
 * while the flight feed is loading or retrying, AIR shows a loading spinner
 * or a retrying dash instead of vanishing, so the bar never reads as
 * "aviation is broken". flightsStatus is the feed's own state, reported by
 * the page's flight loader.
 *
 * The numbers are read off the page's data ref on a beat, never during
 * render: feeds land in bursts (the camera catalogue alone arrives in
 * regional batches), and a counter that twitches with every batch reads as
 * noise. The strip commits a new set of numbers at most once per
 * UPDATE_MS, and only when the numbers actually changed.
 */

const UPDATE_MS = 10_000;

const METRICS: Array<{
  key: keyof LiveCounts;
  label: string;
  short: string;
  icon: typeof Plane;
  title: string;
}> = [
  { key: 'aircraft', label: 'AIRCRAFT', short: 'AIR', icon: Plane, title: 'Aircraft in the air right now (all tracked flight feeds)' },
  { key: 'satellites', label: 'SATELLITES', short: 'SAT', icon: Satellite, title: 'Satellites being tracked' },
  { key: 'cameras', label: 'CAMERAS', short: 'CAM', icon: Video, title: 'Cameras in the catalogue' },
  { key: 'quakes24h', label: 'QUAKES · 24H', short: 'QUAKES 24H', icon: Activity, title: 'Earthquakes in the last 24 hours (USGS M2.5+)' },
];

function sameCounts(a: LiveCounts | null, b: LiveCounts): boolean {
  return a !== null
    && a.aircraft === b.aircraft
    && a.satellites === b.satellites
    && a.cameras === b.cameras
    && a.quakes24h === b.quakes24h;
}

export default function LiveCounterStrip({ dataRef, flightsStatus = 'idle' }: { dataRef: { current: LiveCountsData }; flightsStatus?: FlightFeedStatus }) {
  const [shown, setShown] = useState<LiveCounts | null>(null);

  useEffect(() => {
    const commit = () => {
      const next = deriveLiveCounts(dataRef.current, Date.now());
      setShown(prev => (sameCounts(prev, next) ? prev : next));
    };
    commit();
    /* The first feeds land a few seconds in — one early beat so the strip
       arrives with them instead of waiting out the full cadence. */
    const early = setTimeout(commit, 2500);
    const iv = setInterval(commit, UPDATE_MS);
    return () => { clearTimeout(early); clearInterval(iv); };
  }, [dataRef]);

  const counts: LiveCounts = shown ?? { aircraft: null, satellites: null, cameras: null, quakes24h: null };
  const states = counterMetricStates(counts, flightsStatus);
  const visible = METRICS.filter(m => states[m.key] !== 'hidden');
  if (!visible.length) return null;

  return (
    <div
      role="status"
      aria-label="Live counts: aircraft in the air, satellites tracked, cameras in the catalogue, earthquakes in the last 24 hours"
      className="pointer-events-none flex items-center gap-2.5 sm:gap-3.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-panel)] px-3 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
    >
      {visible.map((metric, i) => {
        const state = states[metric.key];
        const title = metric.key === 'aircraft' && state === 'loading'
          ? 'Aircraft in the air right now — flights still loading'
          : metric.key === 'aircraft' && state === 'error'
            ? 'Flights unavailable — retrying'
            : metric.title;
        return (
        <span key={metric.key} className="flex items-center gap-2.5 sm:gap-3.5">
          {i > 0 && <span aria-hidden="true" className="h-3 w-px bg-[var(--border-secondary)]" />}
          <span className="flex items-center gap-1.5" title={title}>
            <metric.icon className="h-3 w-3 shrink-0 text-[var(--gold-primary)]" aria-hidden="true" />
            {state === 'loading' ? (
              <span aria-hidden="true" className="block h-2.5 w-2.5 rounded-full border border-[var(--text-muted)] border-t-transparent animate-spin" />
            ) : state === 'error' ? (
              <span className="font-mono text-[10px] font-bold tabular-nums text-[var(--text-primary)]">—</span>
            ) : (
              <span className="font-mono text-[10px] font-bold tabular-nums text-[var(--text-primary)]">
                {(counts[metric.key] as number).toLocaleString()}
              </span>
            )}
            <span className="hidden font-mono text-[8px] tracking-[0.18em] text-[var(--text-muted)] min-[420px]:inline">
              {metric.label}
            </span>
            <span className="font-mono text-[8px] tracking-[0.18em] text-[var(--text-muted)] min-[420px]:hidden">
              {metric.short}
            </span>
          </span>
        </span>
        );
      })}
    </div>
  );
}
