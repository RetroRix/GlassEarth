'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crosshair, ExternalLink, Headphones, Plane, X } from 'lucide-react';
import {
  SPOTTING_AIRPORTS, liveAtcUrl, youtubeChannelUrl, youtubeEmbedUrl, youtubeWatchUrl,
  type SpottingAirport,
} from '@/lib/plane-spotting';

/**
 * Glass Earth — PLANE SPOTTING.
 *
 * The great airport cameras of the world, curated in lib/plane-spotting:
 * LAX's rooftop, Heathrow's Myrtle Avenue, Maho Beach. Each plays in a
 * YouTube embed its owner permits — Flightradar24's with their required
 * attribution sentence rendered, verbatim, directly under the player — and
 * each carries a LiveATC button for the tower audio, which is a link out
 * because LiveATC permits nothing else.
 *
 * Streams restart and video ids change. When a player reports an error
 * (the YouTube postMessage handshake), the panel swaps it for a
 * watch-on-YouTube card instead of leaving a black box — and the fix is a
 * one-line id update in the catalogue.
 */

interface PlaneSpottingPanelProps {
  onClose: () => void;
  onFlyTo: (lat: number, lng: number) => void;
}

export default function PlaneSpottingPanel({ onClose, onFlyTo }: PlaneSpottingPanelProps) {
  const [selected, setSelected] = useState<SpottingAirport>(SPOTTING_AIRPORTS[0]);
  const [dead, setDead] = useState<ReadonlySet<string>>(new Set());
  const iframeOwners = useRef(new Map<object, string>());

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string' || !e.origin.includes('youtube')) return;
      let parsed: { event?: string };
      try { parsed = JSON.parse(e.data); } catch { return; }
      if (parsed.event === 'onError' && e.source) {
        const icao = iframeOwners.current.get(e.source as object);
        if (icao) setDead(prev => new Set(prev).add(icao));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const isDead = dead.has(selected.icao);
  const btn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border font-mono text-[9px] tracking-[0.15em] uppercase transition-colors';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed bottom-0 right-0 top-0 z-[940] flex w-[min(660px,100vw)] flex-col border-l border-white/10 bg-[#0a0a0a]/[0.98] shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Plane className="h-4 w-4 text-[var(--gold-primary)]" />
        <span className="font-mono text-[12px] font-bold tracking-[0.25em] text-white">PLANE SPOTTING</span>
        <span className="hidden font-mono text-[8px] uppercase tracking-wider text-white/35 md:block">24/7 airport cameras + tower audio</span>
        <button onClick={onClose} className="ml-auto rounded-sm border border-white/15 p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white" title="Close plane spotting">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="styled-scrollbar flex-1 overflow-y-auto p-3">
        {/* Airport selector */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SPOTTING_AIRPORTS.map(a => (
            <button
              key={a.icao}
              onClick={() => setSelected(a)}
              className={`px-2.5 py-1.5 rounded-sm border font-mono text-[9px] tracking-[0.12em] uppercase transition-colors ${selected.icao === a.icao ? 'border-[var(--gold-primary)]/60 bg-[var(--gold-primary)]/15 text-[var(--gold-primary)]' : 'border-white/15 text-white/60 hover:bg-white/10 hover:text-white'}`}
            >
              {a.iata} · {a.city}
            </button>
          ))}
        </div>

        {/* Player */}
        <div className="relative aspect-video w-full overflow-hidden bg-black" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
          {isDead ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">This stream has gone quiet here</span>
              <span className="max-w-[420px] font-mono text-[8px] uppercase leading-relaxed tracking-wider text-white/35">
                Live streams restart and their addresses change. The camera itself is still broadcasting:
              </span>
              <button
                onClick={() => window.open(youtubeWatchUrl(selected.videoId), '_blank', 'noopener')}
                className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-[var(--gold-primary)] hover:underline"
              >
                Watch on YouTube <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <iframe
              key={selected.icao}
              ref={el => { if (el?.contentWindow) iframeOwners.current.set(el.contentWindow as object, selected.icao); }}
              src={youtubeEmbedUrl(selected.videoId)}
              title={`${selected.airport} live camera — ${selected.operator}`}
              className="h-full w-full border-0"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          )}
        </div>

        {/* Operator attribution — required verbatim, immediately adjacent to
            the player, for the Flightradar24 streams. Do not paraphrase. */}
        {selected.attribution && (
          <p className="mt-1.5 font-mono text-[8px] leading-relaxed tracking-wider text-white/45">
            {selected.attribution.replace('Flightradar24 YouTube channel', '')}
            <button onClick={() => window.open(youtubeChannelUrl(selected.channelId), '_blank', 'noopener')} className="text-[var(--gold-primary)] hover:underline">
              Flightradar24 YouTube channel
            </button>
            .
          </p>
        )}

        {/* About this camera */}
        <div className="mt-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-[13px] font-bold uppercase tracking-wider text-white">{selected.iata} — {selected.airport}</span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-white/40">{selected.city}, {selected.country} · {selected.icao}</span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-white/70">{selected.view}</p>
          {selected.note && <p className="mt-1 font-mono text-[9px] leading-relaxed tracking-wider text-white/40">{selected.note}</p>}
          <p className="mt-1 font-mono text-[8px] uppercase tracking-wider text-white/30">Stream: {selected.operator} via YouTube</p>
        </div>

        {/* Actions */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => window.open(liveAtcUrl(selected.icao), '_blank', 'noopener')}
            className={`${btn} border-[var(--gold-primary)]/50 bg-[var(--gold-primary)]/10 text-[var(--gold-primary)] hover:bg-[var(--gold-primary)]/20`}
            title="LiveATC carries the tower, ground and approach feeds for this airport. It opens on their site — they do not allow embedding."
          >
            <Headphones className="h-3 w-3" /> Listen: LiveATC {selected.icao}
          </button>
          <button onClick={() => window.open(youtubeWatchUrl(selected.videoId), '_blank', 'noopener')} className={`${btn} border-white/15 text-white/60 hover:bg-white/10 hover:text-white`}>
            <ExternalLink className="h-3 w-3" /> On YouTube
          </button>
          <button onClick={() => { onFlyTo(selected.lat, selected.lng); onClose(); }} className={`${btn} border-white/15 text-white/60 hover:bg-white/10 hover:text-white`}>
            <Crosshair className="h-3 w-3" /> Fly to the airport
          </button>
          {selected.links.map(link => (
            <button key={link.url} onClick={() => window.open(link.url, '_blank', 'noopener')} className={`${btn} border-white/15 text-white/60 hover:bg-white/10 hover:text-white`}>
              <ExternalLink className="h-3 w-3" /> {link.label}
            </button>
          ))}
        </div>

        <p className="mt-4 border-t border-white/10 pt-3 font-mono text-[8px] leading-relaxed uppercase tracking-wider text-white/30">
          Every camera here was verified live and embed-permitted when catalogued, and the catalogue is one
          small file (lib/plane-spotting) — a new airport is one entry. LiveATC audio always opens on
          LiveATC&apos;s own site: they forbid hotlinking, and their rules are the rules.
        </p>
      </div>
    </div>,
    document.body,
  );
}
