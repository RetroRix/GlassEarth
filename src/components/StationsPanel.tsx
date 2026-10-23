'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutGrid, Play, Radio, RotateCcw, Search, SkipForward, Star, Tv, X,
} from 'lucide-react';
import {
  RADIO_TAGS, TV_CATEGORIES, TV_COUNTRIES, isMixedContent, loadRadioFavorites,
  loadTvFavorites, saveRadioFavorites, saveTvFavorites,
  type RadioStation, type TvChannel,
} from '@/lib/stations';
import HlsPlayer from './HlsPlayer';

/**
 * Glass Earth — STATIONS.
 *
 * The second television door, next to the news-desk TV panel: a browsable
 * directory of live TV channels (IPTV-org community playlists, one country
 * or category slice at a time) and internet radio stations (Radio Browser).
 * Playback is always direct from the broadcaster's own server — the panel
 * never proxies a stream — so a channel that refuses in-browser playback
 * degrades to an honest unavailable card rather than a black box.
 *
 * Radio playback lives in the page (RadioNowPlaying): picking a station
 * here starts it there, and it keeps playing after this panel closes.
 */

interface StationsPanelProps {
  onClose: () => void;
  onPlayRadio: (station: RadioStation) => void;
  currentRadioUuid: string | null;
  onOpenTvWall: (channels: TvChannel[], favorites: TvChannel[]) => void;
}

const chip = 'shrink-0 px-2.5 py-1.5 rounded-sm border font-mono text-[9px] tracking-[0.12em] uppercase transition-colors';
const chipIdle = 'border-white/15 text-white/60 hover:bg-white/10 hover:text-white';
const chipActive = 'border-[var(--gold-primary)]/60 bg-[var(--gold-primary)]/15 text-[var(--gold-primary)]';
const selectCls = 'bg-[#111] border border-white/15 rounded-sm px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white/80 focus:outline-none focus:border-[var(--gold-primary)]/50';

function Logo({ src, name, className }: { src: string; name: string; className?: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) {
    return (
      <span className={`flex shrink-0 items-center justify-center bg-white/[0.06] font-mono text-[10px] font-bold text-white/50 ${className ?? 'h-8 w-8'}`}>
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- remote station logos, no loader */
    <img src={src} alt="" className={`shrink-0 object-contain ${className ?? 'h-8 w-8'}`} onError={() => setBad(true)} loading="lazy" />
  );
}

export default function StationsPanel({ onClose, onPlayRadio, currentRadioUuid, onOpenTvWall }: StationsPanelProps) {
  const [tab, setTab] = useState<'tv' | 'radio'>('tv');

  /* ── TV state ── */
  const [sliceMode, setSliceMode] = useState<'country' | 'category'>('country');
  const [country, setCountry] = useState('US');
  const [category, setCategory] = useState<string>('news');
  /* Picker lists start from the lib snapshot and are replaced by the
     directory's own lists when the first slice response carries them. */
  const [tvCountries, setTvCountries] = useState(TV_COUNTRIES);
  const [tvCategories, setTvCategories] = useState<readonly string[]>(TV_CATEGORIES);
  const [channels, setChannels] = useState<TvChannel[]>([]);
  const [tvLoading, setTvLoading] = useState(false);
  const [tvError, setTvError] = useState<string | null>(null);
  const [tvQuery, setTvQuery] = useState('');
  const [active, setActive] = useState<TvChannel | null>(null);
  const [playerFailed, setPlayerFailed] = useState(false);
  const [playerNonce, setPlayerNonce] = useState(0);
  const [tvFavsOnly, setTvFavsOnly] = useState(false);
  const [tvFavorites, setTvFavorites] = useState<TvChannel[]>(() => loadTvFavorites());

  /* ── Radio state ── */
  const [radioMode, setRadioMode] = useState<'top' | 'country' | 'tag' | 'search'>('top');
  const [radioCountry, setRadioCountry] = useState('US');
  const [radioTag, setRadioTag] = useState<string>('news');
  const [radioQuery, setRadioQuery] = useState('');
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioError, setRadioError] = useState<string | null>(null);
  const [radioFavsOnly, setRadioFavsOnly] = useState(false);
  const [radioFavorites, setRadioFavorites] = useState<RadioStation[]>(() => loadRadioFavorites());

  useEffect(() => { saveTvFavorites(tvFavorites); }, [tvFavorites]);
  useEffect(() => { saveRadioFavorites(radioFavorites); }, [radioFavorites]);

  /* TV slice loading — one slice at a time, on demand. */
  useEffect(() => {
    let cancelled = false;
    setTvLoading(true);
    setTvError(null);
    const qs = sliceMode === 'country' ? `country=${country}` : `category=${category}`;
    fetch(`/api/stations/tv?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setChannels(Array.isArray(d.channels) ? d.channels : []);
        if (Array.isArray(d.countries) && d.countries.length) setTvCountries(d.countries);
        if (Array.isArray(d.categories) && d.categories.length) setTvCategories(d.categories);
        if (d.error) setTvError(d.error);
      })
      .catch(() => { if (!cancelled) setTvError('TV directory unavailable'); })
      .finally(() => { if (!cancelled) setTvLoading(false); });
    return () => { cancelled = true; };
  }, [sliceMode, country, category]);

  /* Radio loading. Search waits for a query; the rest fire on mode change. */
  useEffect(() => {
    if (radioMode === 'search' && !radioQuery.trim()) { setStations([]); return; }
    let cancelled = false;
    setRadioLoading(true);
    setRadioError(null);
    const q = radioMode === 'country' ? radioCountry : radioMode === 'tag' ? radioTag : radioQuery.trim();
    fetch(`/api/stations/radio?mode=${radioMode}&q=${encodeURIComponent(q)}&limit=80`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setStations(Array.isArray(d.stations) ? d.stations : []);
        if (d.error) setRadioError(d.error);
      })
      .catch(() => { if (!cancelled) setRadioError('Radio directory unavailable'); })
      .finally(() => { if (!cancelled) setRadioLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radioMode, radioCountry, radioTag]);

  const tvFavIds = useMemo(() => new Set(tvFavorites.map(c => c.id)), [tvFavorites]);
  const radioFavUuids = useMemo(() => new Set(radioFavorites.map(s => s.uuid)), [radioFavorites]);

  const visibleChannels = useMemo(() => {
    const base = tvFavsOnly ? tvFavorites : channels;
    const q = tvQuery.trim().toLowerCase();
    return q ? base.filter(c => `${c.name} ${c.category} ${c.country}`.toLowerCase().includes(q)) : base;
  }, [channels, tvFavorites, tvFavsOnly, tvQuery]);

  const visibleStations = useMemo(() => (radioFavsOnly ? radioFavorites : stations), [stations, radioFavorites, radioFavsOnly]);

  const playChannel = (ch: TvChannel) => {
    setActive(ch);
    setPlayerFailed(false);
    setPlayerNonce(n => n + 1);
  };

  const playNext = () => {
    if (!active) return;
    const i = visibleChannels.findIndex(c => c.id === active.id);
    const next = visibleChannels[(i + 1) % Math.max(visibleChannels.length, 1)];
    if (next) playChannel(next);
  };

  const toggleTvFav = (ch: TvChannel) =>
    setTvFavorites(prev => (prev.some(c => c.id === ch.id) ? prev.filter(c => c.id !== ch.id) : [ch, ...prev]));
  const toggleRadioFav = (s: RadioStation) =>
    setRadioFavorites(prev => (prev.some(x => x.uuid === s.uuid) ? prev.filter(x => x.uuid !== s.uuid) : [s, ...prev]));

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed bottom-0 right-0 top-0 z-[940] flex w-[min(700px,100vw)] flex-col border-l border-white/10 bg-[#0a0a0a]/[0.98] shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Radio className="h-4 w-4 text-[#00E5FF]" />
        <span className="font-mono text-[12px] font-bold tracking-[0.25em] text-white">STATIONS</span>
        <span className="hidden font-mono text-[8px] uppercase tracking-wider text-white/35 md:block">Live TV channels · internet radio</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-sm border border-white/15">
            <button onClick={() => setTab('tv')} className={`flex items-center gap-1.5 px-2 py-1.5 font-mono text-[9px] tracking-widest transition-colors ${tab === 'tv' ? 'bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]' : 'text-white/55 hover:bg-white/10'}`}>
              <Tv className="h-3 w-3" /> TV
            </button>
            <button onClick={() => setTab('radio')} className={`flex items-center gap-1.5 px-2 py-1.5 font-mono text-[9px] tracking-widest transition-colors ${tab === 'radio' ? 'bg-[#00E5FF]/20 text-[#00E5FF]' : 'text-white/55 hover:bg-white/10'}`}>
              <Radio className="h-3 w-3" /> RADIO
            </button>
          </div>
          <button onClick={onClose} className="rounded-sm border border-white/15 p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white" title="Close Stations">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {tab === 'tv' ? (
        <div className="styled-scrollbar flex-1 overflow-y-auto">
          <div className="p-3">
            {/* Player */}
            <div className="relative aspect-video w-full overflow-hidden bg-black" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
              {active && !playerFailed && (
                <div key={`${active.id}-${playerNonce}`} className="h-full w-full">
                  <HlsPlayer url={active.url} onFatal={() => setPlayerFailed(true)} className="h-full w-full bg-black object-contain" />
                </div>
              )}
              {active && playerFailed && (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
                  <Logo src={active.logo} name={active.name} className="h-10 w-10" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/70">{active.name} — unavailable</span>
                  <span className="max-w-[420px] font-mono text-[8px] uppercase leading-relaxed tracking-wider text-white/35">
                    This stream would not play in the browser (offline, region-locked, or blocked for embedding). Nothing is proxied to force it.
                  </span>
                  <div className="mt-1 flex gap-1.5">
                    <button onClick={() => playChannel(active)} className={`${chip} ${chipIdle} flex items-center gap-1.5`}><RotateCcw className="h-3 w-3" /> Retry</button>
                    <button onClick={playNext} className={`${chip} ${chipIdle} flex items-center gap-1.5`}><SkipForward className="h-3 w-3" /> Next channel</button>
                  </div>
                </div>
              )}
              {!active && (
                <div className="flex h-full w-full items-center justify-center px-4 text-center">
                  <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/30">Pick a channel below to watch</span>
                </div>
              )}
            </div>
            {active && (
              <div className="mt-2 flex items-center gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] font-bold uppercase tracking-wider text-white">{active.name}</div>
                  <div className="font-mono text-[8px] uppercase tracking-wider text-white/40">{active.category || 'General'} · {active.country} · IPTV-org</div>
                </div>
                <button
                  onClick={() => onOpenTvWall(visibleChannels.length ? visibleChannels : channels, tvFavorites)}
                  className="ml-auto flex shrink-0 items-center gap-1.5 rounded-sm border border-[var(--gold-primary)]/40 px-2 py-1.5 font-mono text-[9px] uppercase tracking-widest text-[var(--gold-primary)] transition-colors hover:bg-[var(--gold-primary)]/10"
                >
                  <LayoutGrid className="h-3 w-3" /> TV Wall
                </button>
              </div>
            )}

            {/* Slice controls */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button onClick={() => setSliceMode('country')} className={`${chip} ${sliceMode === 'country' ? chipActive : chipIdle}`}>By country</button>
              <button onClick={() => setSliceMode('category')} className={`${chip} ${sliceMode === 'category' ? chipActive : chipIdle}`}>By category</button>
              {sliceMode === 'country' ? (
                <select value={country} onChange={e => setCountry(e.target.value)} className={selectCls} aria-label="TV country">
                  {tvCountries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              ) : (
                <select value={category} onChange={e => setCategory(e.target.value)} className={selectCls} aria-label="TV category">
                  {tvCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              <button onClick={() => setTvFavsOnly(v => !v)} className={`${chip} flex items-center gap-1.5 ${tvFavsOnly ? chipActive : chipIdle}`}>
                <Star className="h-3 w-3" fill={tvFavsOnly ? 'var(--gold-primary)' : 'none'} /> Favourites ({tvFavorites.length})
              </button>
              <button
                onClick={() => onOpenTvWall(visibleChannels.length ? visibleChannels : channels, tvFavorites)}
                className={`${chip} ${chipIdle} flex items-center gap-1.5`}
                title="Open the TV wall with this slice"
              >
                <LayoutGrid className="h-3 w-3" /> TV Wall
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-white/35" />
              <input
                value={tvQuery} onChange={e => setTvQuery(e.target.value)}
                placeholder={tvFavsOnly ? 'Search your favourites…' : 'Search this slice — channel, category…'}
                className="w-full bg-transparent font-mono text-[11px] text-white placeholder:text-white/30 focus:outline-none"
              />
              <span className="shrink-0 font-mono text-[8px] uppercase tracking-wider text-white/35">
                {tvLoading ? 'Loading…' : `${visibleChannels.length} channels`}
              </span>
            </div>
            {tvError && <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-red-300/80">{tvError}</p>}

            {/* Channel list */}
            <div className="mt-2 flex flex-col">
              {visibleChannels.slice(0, 300).map(ch => {
                const isFav = tvFavIds.has(ch.id);
                const isActive = active?.id === ch.id;
                return (
                  <div key={ch.id} className={`flex items-center gap-2.5 border-b border-white/5 px-2 py-2 transition-colors ${isActive ? 'bg-[var(--gold-primary)]/[0.07]' : 'hover:bg-white/[0.04]'}`}>
                    <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => playChannel(ch)}>
                      <Logo src={ch.logo} name={ch.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[11px] text-white">{ch.name}</span>
                        <span className="block truncate font-mono text-[8px] uppercase tracking-wider text-white/40">
                          {ch.category || 'General'} · {ch.country}
                        </span>
                      </span>
                      {isActive && <Play className="h-3 w-3 shrink-0 text-[var(--gold-primary)]" fill="currentColor" />}
                    </button>
                    <button onClick={() => toggleTvFav(ch)} className="p-1.5 text-white/50 transition-colors hover:text-[var(--gold-primary)]" title={isFav ? 'Remove favourite' : 'Add favourite'}>
                      <Star className="h-3.5 w-3.5" fill={isFav ? 'var(--gold-primary)' : 'none'} stroke={isFav ? 'var(--gold-primary)' : 'currentColor'} />
                    </button>
                  </div>
                );
              })}
              {!tvLoading && !visibleChannels.length && (
                <div className="px-2 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-white/35">
                  {tvFavsOnly ? 'No favourites yet — star a channel' : 'No channels in this slice'}
                </div>
              )}
              {visibleChannels.length > 300 && (
                <div className="px-2 py-2 text-center font-mono text-[8px] uppercase tracking-widest text-white/30">Showing the first 300 — search to narrow it down</div>
              )}
            </div>
          </div>
          <PanelFooter />
        </div>
      ) : (
        <div className="styled-scrollbar flex-1 overflow-y-auto">
          <div className="p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setRadioMode('top')} className={`${chip} ${radioMode === 'top' ? chipActive : chipIdle}`}>Top stations</button>
              <button onClick={() => setRadioMode('country')} className={`${chip} ${radioMode === 'country' ? chipActive : chipIdle}`}>By country</button>
              <button onClick={() => setRadioMode('tag')} className={`${chip} ${radioMode === 'tag' ? chipActive : chipIdle}`}>By genre</button>
              <button onClick={() => setRadioMode('search')} className={`${chip} ${radioMode === 'search' ? chipActive : chipIdle}`}>Search</button>
              {radioMode === 'country' && (
                <select value={radioCountry} onChange={e => setRadioCountry(e.target.value)} className={selectCls} aria-label="Radio country">
                  {tvCountries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              )}
              {radioMode === 'tag' && (
                <select value={radioTag} onChange={e => setRadioTag(e.target.value)} className={selectCls} aria-label="Radio genre">
                  {RADIO_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              <button onClick={() => setRadioFavsOnly(v => !v)} className={`${chip} flex items-center gap-1.5 ${radioFavsOnly ? chipActive : chipIdle}`}>
                <Star className="h-3 w-3" fill={radioFavsOnly ? 'var(--gold-primary)' : 'none'} /> Favourites ({radioFavorites.length})
              </button>
            </div>
            {radioMode === 'search' && (
              <div className="mt-2 flex items-center gap-2 border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-white/35" />
                <input
                  value={radioQuery}
                  onChange={e => setRadioQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { const q = radioQuery.trim(); if (q) { setRadioMode('search'); fetchSearch(q); } } }}
                  placeholder="Station name — press Enter to search the world"
                  className="w-full bg-transparent font-mono text-[11px] text-white placeholder:text-white/30 focus:outline-none"
                />
              </div>
            )}
            <p className="mt-2 font-mono text-[8px] uppercase tracking-wider text-white/35">
              {radioLoading ? 'Tuning…' : `${visibleStations.length} stations`} · playback keeps going after this panel closes · stations marked HTTP cannot play on the secure app
            </p>
            {radioError && <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-red-300/80">{radioError}</p>}

            <div className="mt-1 flex flex-col">
              {visibleStations.slice(0, 300).map(s => {
                const isFav = radioFavUuids.has(s.uuid);
                const isCurrent = currentRadioUuid === s.uuid;
                const blocked = isMixedContent(s.url);
                return (
                  <div key={s.uuid} className={`flex items-center gap-2.5 border-b border-white/5 px-2 py-2 transition-colors ${isCurrent ? 'bg-[#00E5FF]/[0.07]' : 'hover:bg-white/[0.04]'}`}>
                    <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => onPlayRadio(s)}>
                      <Logo src={s.favicon} name={s.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[11px] text-white">{s.name}</span>
                        <span className="block truncate font-mono text-[8px] uppercase tracking-wider text-white/40">
                          {s.country}{s.state ? ` · ${s.state}` : ''}{s.tags ? ` · ${s.tags.split(',').slice(0, 3).join(', ')}` : ''}{s.codec ? ` · ${s.codec}` : ''}{s.bitrate ? ` ${s.bitrate}k` : ''}
                        </span>
                      </span>
                      {blocked && <span className="shrink-0 border border-amber-400/40 px-1 py-0.5 font-mono text-[7px] uppercase tracking-wider text-amber-300/90">http only</span>}
                      {isCurrent && <Play className="h-3 w-3 shrink-0 text-[#00E5FF]" fill="currentColor" />}
                    </button>
                    <button onClick={() => toggleRadioFav(s)} className="p-1.5 text-white/50 transition-colors hover:text-[var(--gold-primary)]" title={isFav ? 'Remove favourite' : 'Add favourite'}>
                      <Star className="h-3.5 w-3.5" fill={isFav ? 'var(--gold-primary)' : 'none'} stroke={isFav ? 'var(--gold-primary)' : 'currentColor'} />
                    </button>
                  </div>
                );
              })}
              {!radioLoading && !visibleStations.length && (
                <div className="px-2 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-white/35">
                  {radioFavsOnly ? 'No favourites yet — star a station' : radioMode === 'search' ? 'Type a name and press Enter' : 'No stations found'}
                </div>
              )}
            </div>
          </div>
          <PanelFooter />
        </div>
      )}
    </div>,
    document.body,
  );

  function fetchSearch(q: string) {
    setRadioLoading(true);
    setRadioError(null);
    fetch(`/api/stations/radio?mode=search&q=${encodeURIComponent(q)}&limit=80`)
      .then(r => r.json())
      .then(d => {
        setStations(Array.isArray(d.stations) ? d.stations : []);
        if (d.error) setRadioError(d.error);
      })
      .catch(() => setRadioError('Radio directory unavailable'))
      .finally(() => setRadioLoading(false));
  }
}

function PanelFooter() {
  return (
    <div className="border-t border-white/10 px-3 py-2.5">
      <p className="font-mono text-[8px] uppercase leading-relaxed tracking-wider text-white/30">
        TV directory: IPTV-org community · Radio directory: Radio Browser · Streams play directly from each broadcaster — Glass Earth hosts and proxies nothing.
      </p>
    </div>
  );
}
