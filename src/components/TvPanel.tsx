'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ExternalLink, LayoutGrid, Maximize2, MonitorPlay, PictureInPicture2, Tv, X,
} from 'lucide-react';
import { embedUrl } from './LiveNewsPreviews';
import type { FastService } from '@/lib/tv-services';

/**
 * Glass Earth — TV.
 *
 * The live-news desk, grown into a television panel. Three honest tiers,
 * because the services' own terms decide what a third-party page may do:
 *
 *  1. The YouTube-live news channels — the ones whose channel owners allow
 *     embedding (`embed_allowed` in /api/live-news) play right here, singly
 *     or four at a time in multiview. Channels that forbid embedding stay
 *     link-outs, exactly as they were on the map.
 *  2. Picture-in-picture for the single player, via the Document
 *     Picture-in-Picture API: the live player node moves into a small
 *     always-on-top window so the map stays usable while the news runs.
 *     Chrome/Edge only — the button explains itself where unsupported.
 *  3. The FAST services (Pluto, Tubi, Roku Channel, Xumo, Sling Freestream)
 *     as launchers. None publishes a third-party embed program, so they open
 *     the official service in a new tab. No scraped streams, no ripped HLS.
 *
 * A YouTube player that has gone dark (channel stopped the stream, embed
 * withdrawn) reports its error by postMessage — the handshake LiveNewsPreviews
 * established — and its tile swaps to a "watch on the channel" card rather
 * than sitting black.
 */

export interface TvFeed {
  name: string;
  network: string;
  url: string;
  embed_allowed: boolean;
  category?: string;
}

interface TvPanelProps {
  feeds: TvFeed[];
  services: FastService[];
  onClose: () => void;
}

const MAX_MULTIVIEW = 4;

/** The page a viewer would land on: for a channel-embed URL, the channel's
    live page; for everything else, the feed URL itself. */
function watchUrl(feed: TvFeed): string {
  const m = feed.url.match(/live_stream\?channel=([\w-]+)/);
  return m ? `https://www.youtube.com/channel/${m[1]}/live` : feed.url;
}

export default function TvPanel({ feeds: feedsProp, services: servicesProp, onClose }: TvPanelProps) {
  const [local, setLocal] = useState<{ feeds: TvFeed[]; services: FastService[] } | null>(null);
  const feeds = feedsProp.length ? feedsProp : local?.feeds ?? [];
  const services = servicesProp.length ? servicesProp : local?.services ?? [];

  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [selected, setSelected] = useState<string | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const [dead, setDead] = useState<ReadonlySet<string>>(new Set());
  const [pipSupported, setPipSupported] = useState(false);

  const iframeOwners = useRef(new Map<object, string>());
  const playerSlotRef = useRef<HTMLDivElement>(null);
  const playerBoxRef = useRef<HTMLDivElement>(null);
  const pipWindowRef = useRef<Window | null>(null);

  /* Self-sufficiency: if the map's live-news layer never fetched (it only
     loads with the layer on), fetch the same endpoint directly. */
  useEffect(() => {
    if (feedsProp.length) return;
    let cancelled = false;
    fetch('/api/live-news')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setLocal({ feeds: d.feeds ?? [], services: d.services ?? [] }); })
      .catch(() => { /* the panel simply stays empty, with its note */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setPipSupported('documentPictureInPicture' in window); }, []);

  /* Defaults once feeds exist: first embeddable channel on the single
     player, and the first four queued for multiview. */
  const embeddable = useMemo(() => feeds.filter(f => f.embed_allowed), [feeds]);
  useEffect(() => {
    if (!embeddable.length) return;
    setSelected(prev => prev ?? embeddable[0].name);
    setMulti(prev => (prev.length ? prev : embeddable.slice(0, MAX_MULTIVIEW).map(f => f.name)));
  }, [embeddable]);

  const selectedFeed = feeds.find(f => f.name === selected) ?? null;

  /* — Dead-player detection: the YouTube iframe API handshake, as in
       LiveNewsPreviews. Players post onReady (which lets us map a window to
       its channel) and onError (which retires the tile to a link-out card). */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string' || !e.origin.includes('youtube')) return;
      let parsed: { event?: string; info?: number };
      try { parsed = JSON.parse(e.data); } catch { return; }
      /* The ref callbacks below map each player's window to its channel;
         all the handshake has to do here is listen for the error. */
      if (parsed.event === 'onError' && e.source) {
        const name = iframeOwners.current.get(e.source as object);
        if (name) setDead(prev => new Set(prev).add(name));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const registerIframe = useCallback((name: string) => (el: HTMLIFrameElement | null) => {
    if (el?.contentWindow) iframeOwners.current.set(el.contentWindow as object, name);
  }, []);

  /* — Document Picture-in-Picture ————————————————————————————————
     The player node itself moves into the PiP window, so the stream never
     restarts. Stylesheets are copied across (the iframe inherits page CSS
     for its frame; Tailwind classes live on ancestors that stay behind). */
  const closePip = useCallback(() => {
    pipWindowRef.current?.close();
    pipWindowRef.current = null;
  }, []);

  const openPip = useCallback(async () => {
    const slot = playerSlotRef.current;
    const node = slot?.firstElementChild as HTMLElement | null;
    const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture;
    if (!slot || !node || !dpip || pipWindowRef.current) return;
    try {
      const pipWin = await dpip.requestWindow({ width: 480, height: 270 });
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = Array.from(sheet.cssRules).map(r => r.cssText).join('');
          const style = pipWin.document.createElement('style');
          style.textContent = rules;
          pipWin.document.head.appendChild(style);
        } catch {
          if (sheet.href) {
            const link = pipWin.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            pipWin.document.head.appendChild(link);
          }
        }
      }
      pipWin.document.body.style.margin = '0';
      pipWin.document.body.style.background = '#000';
      node.style.width = '100%';
      node.style.height = '100%';
      pipWin.document.body.appendChild(node);
      pipWindowRef.current = pipWin;
      pipWin.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        node.style.width = '';
        node.style.height = '';
        slot.appendChild(node);
      }, { once: true });
    } catch { /* the user dismissed the PiP picker — nothing to do */ }
  }, []);

  /* Changing channel or mode while PiP is open would strand the player:
     bring it home first. */
  useEffect(() => { closePip(); }, [selected, mode, closePip]);
  useEffect(() => () => closePip(), [closePip]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else playerBoxRef.current?.requestFullscreen().catch(() => {});
  };

  const toggleMulti = (name: string) => {
    setMulti(prev => {
      if (prev.includes(name)) return prev.filter(n => n !== name);
      return prev.length >= MAX_MULTIVIEW ? prev : [...prev, name];
    });
  };

  const playerFor = (feed: TvFeed, register: boolean) => {
    if (dead.has(feed.name)) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#050505] px-4 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">This stream is not playing here</span>
          <button onClick={() => window.open(watchUrl(feed), '_blank', 'noopener')} className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-[var(--gold-primary)] hover:underline">
            Watch on the channel <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      );
    }
    return (
      <iframe
        ref={register ? registerIframe(feed.name) : undefined}
        src={embedUrl(feed.url, true) ?? feed.url}
        title={feed.name}
        className="h-full w-full border-0"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    );
  };

  const chip = 'shrink-0 px-2.5 py-1.5 rounded-sm border font-mono text-[9px] tracking-[0.12em] uppercase transition-colors';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed bottom-0 right-0 top-0 z-[940] flex w-[min(700px,100vw)] flex-col border-l border-white/10 bg-[#0a0a0a]/[0.98] shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Tv className="h-4 w-4 text-[var(--gold-primary)]" />
        <span className="font-mono text-[12px] font-bold tracking-[0.25em] text-white">TELEVISION</span>
        <span className="hidden font-mono text-[8px] uppercase tracking-wider text-white/35 md:block">Live news · multiview · free streaming</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-sm border border-white/15">
            <button onClick={() => setMode('single')} className={`flex items-center gap-1.5 px-2 py-1.5 font-mono text-[9px] tracking-widest transition-colors ${mode === 'single' ? 'bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]' : 'text-white/55 hover:bg-white/10'}`}>
              <MonitorPlay className="h-3 w-3" /> SINGLE
            </button>
            <button onClick={() => setMode('multi')} className={`flex items-center gap-1.5 px-2 py-1.5 font-mono text-[9px] tracking-widest transition-colors ${mode === 'multi' ? 'bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]' : 'text-white/55 hover:bg-white/10'}`}>
              <LayoutGrid className="h-3 w-3" /> MULTIVIEW
            </button>
          </div>
          <button onClick={onClose} className="rounded-sm border border-white/15 p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white" title="Close TV">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="styled-scrollbar flex-1 overflow-y-auto">
        {mode === 'single' ? (
          <div className="p-3">
            {/* Channel chips */}
            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
              {feeds.map(feed => (
                feed.embed_allowed ? (
                  <button
                    key={feed.name}
                    onClick={() => setSelected(feed.name)}
                    className={`${chip} flex items-center gap-1.5 ${selected === feed.name ? 'border-[var(--gold-primary)]/60 bg-[var(--gold-primary)]/15 text-[var(--gold-primary)]' : 'border-white/15 text-white/60 hover:bg-white/10 hover:text-white'}`}
                  >
                    <span className="h-1 w-1 rounded-full bg-red-500" />
                    {feed.name}
                  </button>
                ) : (
                  <button
                    key={feed.name}
                    onClick={() => window.open(watchUrl(feed), '_blank', 'noopener')}
                    className={`${chip} flex items-center gap-1.5 border-white/10 text-white/40 hover:bg-white/5 hover:text-white/70`}
                    title={`${feed.name} does not allow embedding — opens on its own site`}
                  >
                    {feed.name} <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                )
              ))}
              {!feeds.length && (
                <span className="font-mono text-[9px] uppercase tracking-widest text-white/35">Linking the news desk…</span>
              )}
            </div>

            {/* The player */}
            <div ref={playerBoxRef} className="relative aspect-video w-full overflow-hidden bg-black" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
              <div ref={playerSlotRef} className="h-full w-full">
                {selectedFeed?.embed_allowed && (
                  /* Keyed by channel: a channel change mounts a fresh player
                     (and the PiP effect above has already brought any PiP
                     player home, so nothing is stranded mid-move). */
                  <div key={selectedFeed.name} className="h-full w-full">
                    {playerFor(selectedFeed, true)}
                  </div>
                )}
                {!selectedFeed && (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/30">No channel selected</span>
                  </div>
                )}
              </div>
            </div>

            {/* Player bar */}
            {selectedFeed && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] font-bold uppercase tracking-wider text-white">{selectedFeed.name}</div>
                  <div className="font-mono text-[8px] uppercase tracking-wider text-white/40">{selectedFeed.network} · Live</div>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={openPip}
                    disabled={!pipSupported}
                    className="flex items-center gap-1.5 rounded-sm border border-white/15 px-2 py-1.5 font-mono text-[9px] uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    title={pipSupported ? 'Pop the player into a floating window (Document Picture-in-Picture)' : 'Picture-in-picture needs Chrome or Edge'}
                  >
                    <PictureInPicture2 className="h-3 w-3" /> PiP
                  </button>
                  <button onClick={toggleFullscreen} className="flex items-center gap-1.5 rounded-sm border border-white/15 px-2 py-1.5 font-mono text-[9px] uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10 hover:text-white">
                    <Maximize2 className="h-3 w-3" /> Fullscreen
                  </button>
                  <button onClick={() => window.open(watchUrl(selectedFeed), '_blank', 'noopener')} className="flex items-center gap-1.5 rounded-sm border border-white/15 px-2 py-1.5 font-mono text-[9px] uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10 hover:text-white">
                    <ExternalLink className="h-3 w-3" /> On YouTube
                  </button>
                </div>
              </div>
            )}
            {!pipSupported && (
              <p className="mt-2 font-mono text-[8px] uppercase tracking-wider text-white/30">
                Picture-in-picture is unavailable in this browser — it needs Chrome or Edge.
              </p>
            )}
          </div>
        ) : (
          <div className="p-3">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-white/45">
              Pick up to {MAX_MULTIVIEW} channels — {multi.length} on the wall
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {embeddable.map(feed => {
                const on = multi.includes(feed.name);
                return (
                  <button
                    key={feed.name}
                    onClick={() => toggleMulti(feed.name)}
                    disabled={!on && multi.length >= MAX_MULTIVIEW}
                    className={`${chip} ${on ? 'border-[var(--gold-primary)]/60 bg-[var(--gold-primary)]/15 text-[var(--gold-primary)]' : 'border-white/15 text-white/60 hover:bg-white/10 hover:text-white'} disabled:cursor-not-allowed disabled:opacity-35`}
                  >
                    {feed.name}
                  </button>
                );
              })}
            </div>
            <div className={`grid gap-1.5 ${multi.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {multi.map(name => {
                const feed = feeds.find(f => f.name === name);
                if (!feed) return null;
                return (
                  <div key={name} className="relative aspect-video overflow-hidden bg-black" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
                    {playerFor(feed, true)}
                    <span className="pointer-events-none absolute bottom-1 left-1.5 font-mono text-[8px] font-bold uppercase tracking-wider text-white/85" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>
                      {feed.name}
                    </span>
                    <button onClick={() => toggleMulti(name)} className="absolute right-1 top-1 rounded-sm bg-black/70 p-1 text-white/60 transition-colors hover:text-white" title={`Remove ${feed.name}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              {!multi.length && (
                <div className="flex aspect-video items-center justify-center border border-dashed border-white/15">
                  <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/30">Nothing on the wall yet</span>
                </div>
              )}
            </div>
            <p className="mt-2 font-mono text-[8px] uppercase tracking-wider text-white/30">
              Multiview players start muted by YouTube&apos;s embed rules — click a tile to hear it.
            </p>
          </div>
        )}

        {/* FAST services — launchers to the official services */}
        <div className="border-t border-white/10 p-3">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="font-mono text-[10px] font-bold tracking-[0.25em] text-white">FREE STREAMING TV</span>
            <span className="font-mono text-[8px] uppercase tracking-wider text-white/35">FAST services · open the official apps</span>
          </div>
          <p className="mb-3 font-mono text-[8px] leading-relaxed tracking-wider text-white/30">
            Pluto, Tubi and friends don&apos;t offer embeds for other sites, so these open the real service in a new tab — free, and it always works.
          </p>
          <div className="flex flex-col gap-1.5">
            {services.map(service => (
              <button
                key={service.id}
                onClick={() => window.open(service.url, '_blank', 'noopener')}
                className="group flex items-center gap-3 border border-white/10 bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-[var(--gold-primary)]/40 hover:bg-white/[0.05]"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-white">{service.name}</div>
                  <div className="truncate font-mono text-[8px] uppercase tracking-wider text-white/40">{service.tagline}</div>
                </div>
                <span className="shrink-0 border border-white/15 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-white/50">{service.note}</span>
                <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-[var(--gold-primary)]">
                  Watch <ExternalLink className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            ))}
            {!services.length && (
              <span className="font-mono text-[9px] uppercase tracking-widest text-white/35">Loading services…</span>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
