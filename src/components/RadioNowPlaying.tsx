'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Radio, Square, Volume2, X } from 'lucide-react';
import { isMixedContent, type RadioStation } from '@/lib/stations';

/**
 * Glass Earth — the radio, pinned.
 *
 * Rendered by the page, not by the Stations panel, so closing the panel
 * never stops the music: this bar owns the one <audio> element, keyed by
 * station. Plain-http streams are refused up front and said so — on the
 * https app the browser would block them as mixed content anyway, and
 * silently spinning would be a lie. Nothing is proxied to work around it.
 */

interface RadioNowPlayingProps {
  station: RadioStation;
  onStop: () => void;
}

export default function RadioNowPlaying({ station, onStop }: RadioNowPlayingProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [failed, setFailed] = useState(false);
  const blocked = isMixedContent(station.url);

  /* A station change is a fresh element (keyed below), but the click that
     picked it is a user gesture — register it with Radio Browser, their
     popularity signal, fire-and-forget. */
  useEffect(() => {
    setFailed(false);
    setPlaying(false);
    fetch(`/api/stations/radio?click=${encodeURIComponent(station.uuid)}`).catch(() => {});
  }, [station.uuid]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el || blocked) return;
    if (el.paused) el.play().catch(() => setFailed(true));
    else el.pause();
  };

  return (
    <div className="fixed bottom-16 left-1/2 z-[930] w-[min(520px,calc(100vw-16px))] -translate-x-1/2 md:bottom-10">
      <div className="flex items-center gap-2.5 border border-white/15 bg-[#0a0a0a]/95 px-3 py-2 shadow-2xl backdrop-blur-sm">
        <Radio className="h-4 w-4 shrink-0 text-[#00E5FF]" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] font-bold uppercase tracking-wider text-white">{station.name}</div>
          <div className="truncate font-mono text-[8px] uppercase tracking-wider text-white/40">
            {blocked
              ? 'Unavailable — this station streams over http, blocked on the secure app'
              : failed
                ? 'Stream unavailable — the station did not answer'
                : `${station.country}${station.state ? ` · ${station.state}` : ''}${station.codec ? ` · ${station.codec}` : ''}${station.bitrate ? ` ${station.bitrate}k` : ''} · Radio Browser`}
          </div>
        </div>

        {!blocked && !failed && (
          <>
            <button onClick={toggle} className="rounded-sm border border-white/15 p-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white" title={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <div className="hidden items-center gap-1.5 sm:flex">
              <Volume2 className="h-3.5 w-3.5 text-white/45" />
              <input
                type="range" min={0} max={1} step={0.05} value={volume}
                onChange={e => setVolume(parseFloat(e.target.value))}
                className="h-1 w-20 accent-[#00E5FF]"
                aria-label="Radio volume"
              />
            </div>
            <button onClick={onStop} className="rounded-sm border border-white/15 p-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white" title="Stop">
              <Square className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {(blocked || failed) && (
          <button onClick={onStop} className="rounded-sm border border-white/15 p-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white" title="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {!blocked && (
          <audio
            key={station.uuid}
            ref={audioRef}
            src={station.url}
            autoPlay
            preload="none"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  );
}
