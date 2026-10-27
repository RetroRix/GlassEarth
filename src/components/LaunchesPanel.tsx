'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, MapPin, Rocket, X } from 'lucide-react';
import {
  countdownTo, formatCountdown, isProvisional, type LaunchRecord,
} from '@/lib/launches';

/**
 * OSIRIS — the Launches panel: the next launches soonest-first with
 * LIVE countdowns ticking every second from the NET the feed carries,
 * plus the last 7 days underneath. A launch expands into its detail
 * card — status verbatim from Launch Library 2, provider, vehicle,
 * pad, mission, webcast when the feed carries one.
 *
 * Honesty: NET means No Earlier Than, and the panel says so up top.
 * A TBC/TBD status makes the countdown provisional, and the card says
 * that too — no time here is ever sharper than the feed made it.
 */

interface LaunchesBody { launches: LaunchRecord[]; generatedAt: string }

function statusChipClass(abbrev: string): string {
  switch (abbrev.trim().toUpperCase()) {
    case 'GO': return 'bg-emerald-400/15 text-emerald-300 border-emerald-300/30';
    case 'TBC': case 'TBD': return 'bg-amber-400/15 text-amber-300 border-amber-300/30';
    case 'HOLD': return 'bg-red-400/15 text-red-300 border-red-300/30';
    case 'SUCCESS': return 'bg-teal-400/15 text-teal-300 border-teal-300/30';
    case 'FAILURE': case 'PARTIAL FAILURE': return 'bg-red-400/15 text-red-300 border-red-300/30';
    case 'IN FLIGHT': return 'bg-sky-400/15 text-sky-300 border-sky-300/30';
    default: return 'bg-white/10 text-white/70 border-white/20';
  }
}

function fmtNet(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function DetailCard({ launch, now, onLocate }: { launch: LaunchRecord; now: number; onLocate: (lat: number, lng: number, zoom: number) => void }) {
  const cd = countdownTo(launch.net, now);
  const provisional = isProvisional(launch.statusAbbrev);
  return (
    <div className="border-b border-white/10 bg-white/[0.03] px-3 py-3" data-testid="launch-detail">
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-[13px] font-bold leading-snug text-white">{launch.name}</div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${statusChipClass(launch.statusAbbrev)}`}>
          {launch.status}
        </span>
      </div>
      {cd && (
        <div className="mt-2 font-mono text-[22px] font-bold tabular-nums tracking-wider text-[#FFB74D]">
          {formatCountdown(cd)} <span className="text-[11px] text-white/50">NET</span>
        </div>
      )}
      <div className="mt-0.5 font-mono text-[10px] text-white/45">NET {fmtNet(launch.net)} (your time) · {launch.net.replace('T', ' ').slice(0, 16)} UTC</div>
      {provisional && (
        <div className="mt-1.5 font-mono text-[10px] leading-relaxed text-amber-300/90">
          Provisional — the feed marks this time {launch.statusAbbrev} (not yet confirmed), so the countdown can move.
        </div>
      )}
      {launch.holdReason && (
        <div className="mt-1.5 font-mono text-[10px] leading-relaxed text-red-300/90">Hold reason (feed): {launch.holdReason}</div>
      )}
      <dl className="mt-2 space-y-1 font-mono text-[11px] text-white/70">
        {launch.provider && <div className="flex gap-2"><dt className="w-16 shrink-0 text-white/35">PROVIDER</dt><dd>{launch.provider}</dd></div>}
        {launch.vehicle && <div className="flex gap-2"><dt className="w-16 shrink-0 text-white/35">VEHICLE</dt><dd>{launch.vehicle}</dd></div>}
        {(launch.padName || launch.siteName) && (
          <div className="flex gap-2"><dt className="w-16 shrink-0 text-white/35">PAD</dt><dd>{[launch.padName, launch.siteName].filter(Boolean).join(' · ')}</dd></div>
        )}
        {launch.missionName && launch.missionName !== launch.name && (
          <div className="flex gap-2"><dt className="w-16 shrink-0 text-white/35">MISSION</dt><dd>{launch.missionName}</dd></div>
        )}
      </dl>
      {launch.missionDescription && (
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-white/60">{launch.missionDescription}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onLocate(launch.lat, launch.lng, 7)}
          className="flex items-center gap-1.5 rounded border border-white/15 bg-white/[0.06] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white/80 transition-colors hover:bg-white/[0.12]"
        >
          <MapPin className="h-3 w-3" /> Fly to site
        </button>
        {launch.webcastUrl && (
          <a
            href={launch.webcastUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded border border-[#FF6D00]/30 bg-[#FF6D00]/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-[#FFB74D] transition-colors hover:bg-[#FF6D00]/20"
          >
            <ExternalLink className="h-3 w-3" /> Webcast
          </a>
        )}
      </div>
    </div>
  );
}

function LaunchRow({ launch, now, selected, onSelect }: {
  launch: LaunchRecord; now: number; selected: boolean;
  onSelect: () => void;
}) {
  const cd = countdownTo(launch.net, now);
  const done = ['SUCCESS', 'FAILURE', 'PARTIAL FAILURE'].includes(launch.statusAbbrev.trim().toUpperCase());
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
      aria-expanded={selected}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12px] font-semibold text-white">{launch.name}</div>
        <div className="truncate font-mono text-[10px] text-white/40">
          {[launch.siteName, fmtNet(launch.net)].filter(Boolean).join(' · ')}
        </div>
      </div>
      <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${statusChipClass(launch.statusAbbrev)}`}>
        {launch.statusAbbrev || launch.status}
      </span>
      <span className="w-[104px] shrink-0 text-right font-mono text-[11px] tabular-nums text-[#FFB74D]">
        {cd ? (done && cd.past ? fmtNet(launch.net).split(',')[0] : `${formatCountdown(cd)}`) : '—'}
      </span>
    </button>
  );
}

export default function LaunchesPanel({ onClose, onLocate }: {
  onClose: () => void;
  onLocate: (lat: number, lng: number, zoom: number) => void;
}) {
  const [launches, setLaunches] = useState<LaunchRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch('/api/launches')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: LaunchesBody) => {
        if (cancelled) return;
        if (Array.isArray(body?.launches)) { setLaunches(body.launches); setFailed(false); }
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    load();
    const iv = setInterval(load, 10 * 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const { upcoming, recent, selected } = useMemo(() => {
    const all = launches ?? [];
    const upcoming = all.filter(l => Date.parse(l.net) >= now - 60_000);
    const recent = all.filter(l => Date.parse(l.net) < now - 60_000).reverse();
    const selected = all.find(l => l.id === selectedId) ?? null;
    return { upcoming, recent, selected };
  }, [launches, now, selectedId]);

  const renderRow = (l: LaunchRecord) => (
    <div key={l.id}>
      <LaunchRow
        launch={l} now={now} selected={selectedId === l.id}
        onSelect={() => setSelectedId(prev => (prev === l.id ? null : l.id))}
      />
      {selectedId === l.id && selected && <DetailCard launch={selected} now={now} onLocate={onLocate} />}
    </div>
  );

  return (
    <div className="fixed bottom-0 right-0 top-0 z-[940] flex w-[min(430px,100vw)] flex-col border-l border-white/10 bg-[#0a0a0a]/[0.98] shadow-2xl" data-testid="launches-panel">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Rocket className="h-4 w-4 text-[#FF6D00]" />
        <span className="font-mono text-[12px] font-bold tracking-[0.25em] text-white">LAUNCHES</span>
        <span className="hidden font-mono text-[8px] uppercase tracking-wider text-white/35 md:block">Next 30 days · NET = No Earlier Than</span>
        <button onClick={onClose} className="ml-auto rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close launches panel">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {launches === null && !failed && (
          <div className="px-3 py-6 font-mono text-[11px] text-white/40">Loading launches…</div>
        )}
        {failed && launches === null && (
          <div className="px-3 py-6 font-mono text-[11px] text-white/40">Launch data unavailable right now — the feed is throttled; try again shortly.</div>
        )}
        {launches !== null && upcoming.length === 0 && recent.length === 0 && (
          <div className="px-3 py-6 font-mono text-[11px] text-white/40">No launches in the window.</div>
        )}
        {upcoming.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-3 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/35">Upcoming · soonest first</div>
            {upcoming.map(renderRow)}
          </>
        )}
        {recent.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-4 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/35">Recent · last 7 days</div>
            {recent.map(renderRow)}
          </>
        )}
        <div className="px-3 py-3 font-mono text-[9px] leading-relaxed text-white/30">
          Times are NET (No Earlier Than) from Launch Library 2 / The Space Devs; statuses are shown exactly as the feed reports them.
        </div>
      </div>
    </div>
  );
}
