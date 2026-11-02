'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Sunrise, X } from 'lucide-react';
import { sunriseCameras, type SunriseCamera } from '@/lib/sunrise-chaser';
import type { WallCamera } from '@/lib/theater-wall';

const RIDE_DWELL_MS = 30_000;

interface PanelProps {
  cameras: WallCamera[];
  onClose: () => void;
  /** Fly to the camera and open it in the viewer (the roulette's contract). */
  onWatch: (cam: WallCamera) => void;
}

function timingLabel(entry: SunriseCamera): string {
  const m = entry.minutesToSunrise;
  if (m === null) return 'sun on the horizon';
  if (m > 1) return `sunrise in ~${Math.round(m)} min`;
  if (m >= -1) return 'sunrise right now';
  return `rose ~${Math.round(-m)} min ago`;
}

/**
 * Sunrise Chaser (pipeline #14): the catalogue cameras on the dawn line,
 * recomputed from the app's own solar model every minute. "Ride the
 * sunrise" hops the viewer along the list; the panel stays open so the
 * ride can be stopped, and the list keeps following the terminator west.
 */
export default function SunriseChaserPanel({ cameras, onClose, onWatch }: PanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const [riding, setRiding] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const rideIndexRef = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const list = useMemo(() => sunriseCameras(cameras, now), [cameras, now]);
  const listRef = useRef(list);
  useEffect(() => { listRef.current = list; }, [list]);

  /* The ride: open the next dawn camera every dwell interval. The list is
     read through a ref so a refreshed ranking mid-ride doesn't restart
     the timer — the hop after a refresh simply uses the fresher list. */
  useEffect(() => {
    if (!riding) return;
    const hop = () => {
      const current = listRef.current;
      if (!current.length) return;
      const entry = current[rideIndexRef.current % current.length];
      rideIndexRef.current += 1;
      setCurrentId(String(entry.cam.id));
      onWatch(entry.cam);
    };
    hop();
    const iv = setInterval(hop, RIDE_DWELL_MS);
    return () => clearInterval(iv);
  }, [riding, onWatch]);

  const stopRide = () => setRiding(false);

  return (
    <div className="fixed bottom-0 right-0 top-0 z-[940] flex w-[min(430px,100vw)] flex-col border-l border-white/10 bg-[#0a0a0a]/[0.98] shadow-2xl" data-testid="sunrise-chaser-panel">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Sunrise className="h-4 w-4 text-[#FFB74D]" />
        <span className="font-mono text-[12px] font-bold tracking-[0.25em] text-white">SUNRISE CHASER</span>
        <button onClick={onClose} className="ml-auto rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close sunrise chaser panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-white/5 px-3 py-2 font-mono text-[9px] leading-relaxed text-white/40">
        Cameras where the sun is rising <span className="text-white/70">right now</span> — the dawn line sweeps west
        and this list follows it, recomputed every minute from the app’s solar model.
      </div>

      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <button
          onClick={() => (riding ? stopRide() : setRiding(true))}
          disabled={!list.length}
          className="flex items-center gap-2 rounded border border-white/20 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          {riding ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {riding ? 'Stop the ride' : 'Ride the sunrise'}
        </button>
        <span className="font-mono text-[9px] text-white/40">
          {list.length} {list.length === 1 ? 'camera' : 'cameras'} on the dawn line
          {riding ? ' · hopping every 30 s' : ''}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cameras.length === 0 && (
          <div className="px-3 py-6 font-mono text-[11px] leading-relaxed text-white/40">
            The camera catalogue is still loading — the dawn line appears as soon as it lands.
          </div>
        )}
        {cameras.length > 0 && list.length === 0 && (
          <div className="px-3 py-6 font-mono text-[11px] leading-relaxed text-white/40">
            No catalogue cameras are on the dawn line at this moment. The terminator is always moving — check back in a few minutes.
          </div>
        )}
        {list.map(entry => {
          const cam = entry.cam;
          const isCurrent = currentId === String(cam.id);
          return (
            <div key={String(cam.id)} className={`border-b border-white/5 px-3 py-2.5 ${isCurrent ? 'bg-white/5' : ''}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium leading-snug text-white">{cam.name ?? 'Camera'}</div>
                  <div className="mt-0.5 text-[10px] text-white/50">
                    {[cam.city, cam.country].filter(Boolean).join(' · ') || cam.source || ''}
                  </div>
                  <div className="mt-1 font-mono text-[8px] uppercase tracking-wider text-[#FFB74D]">
                    {timingLabel(entry)} · sun {entry.elevationDeg >= 0 ? '+' : ''}{entry.elevationDeg.toFixed(1)}°
                    {isCurrent && riding ? ' · riding' : ''}
                  </div>
                </div>
                <button
                  onClick={() => { setCurrentId(String(cam.id)); onWatch(cam); }}
                  className="shrink-0 rounded border border-white/20 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-white transition-colors hover:bg-white/10"
                >
                  Watch
                </button>
              </div>
            </div>
          );
        })}
        <div className="px-3 py-3 font-mono text-[9px] leading-relaxed text-white/30">
          Sun angles come from the same solar model that shades Live Clouds; times marked ~ are that model’s estimate.
          A camera whose feed has died shows its UNAVAILABLE badge in the viewer, as everywhere in Glass Earth.
        </div>
      </div>
    </div>
  );
}
