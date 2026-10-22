'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ExternalLink, LayoutGrid, Maximize2, Minimize2, MonitorPlay, Pause, Play,
  Search, Star, SwitchCamera, X,
} from 'lucide-react';
import { loadCameraCatalog, mergeCameraCatalog } from '@/lib/camera-catalog';
import {
  MAX_PLAYING_VIDEO_TILES, WALL_LAYOUTS, cameraKey, isVideoWallCamera, isWallPlayable,
  loadAssignments, loadFavorites, loadLayout, rotateWindow, saveAssignments, saveFavorites,
  saveLayout, texasPreset, type WallCamera, type WallLayout,
} from '@/lib/theater-wall';
import CameraTileMedia from './CameraTileMedia';

/**
 * Glass Earth — CAMERA THEATER.
 *
 * A wall of live cameras on a 2×2, 3×3 or 4×4 grid, built from the same
 * catalogue the map draws. It opens on the Texas / El Paso preset — home
 * base first — and from there the operator can fill any tile from any camera
 * in the world, star favourites, and let the wall rotate through a pool on
 * its own.
 *
 * Two rationing rules keep a 16-up wall honest. Snapshot tiles re-request on
 * their kind's cadence (cheap), but video tiles are capped at
 * MAX_PLAYING_VIDEO_TILES simultaneous decoders; the rest hold as snapshots
 * until focused. And the wall loads the catalogue itself rather than
 * depending on the map's CCTV layer being on — opening the theater is intent
 * enough.
 *
 * Portalled to document.body for the same reason SpaceCam's expanded view
 * is: ancestors with transforms would trap a fixed overlay inside the HUD.
 */

type PoolMode = 'texas' | 'favorites' | 'world';

const ROTATE_SECONDS = 30;

interface TheaterWallProps {
  /** Whatever the map has already loaded; the wall tops this up itself. */
  cameras: WallCamera[];
  onClose: () => void;
  /** Hand a camera to the full viewer (which has the resolver and analysis). */
  onOpenCamera: (cam: WallCamera) => void;
  /** Switch to Ambient TV, the lean-back mode built on the same catalogue. */
  onAmbient: () => void;
}

export default function TheaterWall({ cameras, onClose, onOpenCamera, onAmbient }: TheaterWallProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [catalog, setCatalog] = useState<WallCamera[]>(cameras);
  const [layout, setLayoutState] = useState<WallLayout>(() => loadLayout());
  const [slots, setSlots] = useState<(string | null)[]>(() => loadAssignments() ?? []);
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  const [poolMode, setPoolMode] = useState<PoolMode>('texas');
  const [rotating, setRotating] = useState(false);
  const [tick, setTick] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const [picker, setPicker] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [isFs, setIsFs] = useState(false);

  const count = layout * layout;

  /* The wall tops up the catalogue itself: the map only loads cameras when
     its CCTV layer is on, and the theater should not care whether it is. */
  useEffect(() => {
    return loadCameraCatalog(
      batch => setCatalog(prev => mergeCameraCatalog(prev, batch as WallCamera[])),
      () => { /* a failed region retries inside the loader; tiles show what arrived */ },
    );
  }, []);

  const byId = useMemo(() => new Map(catalog.map(c => [cameraKey(c), c])), [catalog]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const pools = useMemo<Record<PoolMode, WallCamera[]>>(() => {
    const playable = catalog.filter(isWallPlayable);
    return {
      texas: texasPreset(catalog),
      favorites: playable.filter(c => favoriteSet.has(cameraKey(c))),
      world: playable,
    };
  }, [catalog, favoriteSet]);
  const pool = pools[poolMode];
  const poolRef = useRef(pool);
  useEffect(() => { poolRef.current = pool; }, [pool]);

  /** Fill every slot from a pool, in pool order, wrapping if it runs short. */
  const fill = (from: WallCamera[], size: number) => {
    if (!from.length) return;
    setSlots(rotateWindow(from, size, 0).map(cameraKey));
  };

  /* The slots as rendered: what the operator stored, completed to grid size
     from the current pool. Stored slots change only through operator action
     (picking a camera, choosing a preset, rotation), so the first fill and
     any size mismatch resolve here, derivatively: a fresh wall fills from
     the Texas preset as soon as TxDOT cameras land, and a restored wall
     keeps its picks exactly. */
  const viewSlots = useMemo(() => {
    const base = slots.slice(0, count);
    if (base.length >= count) return base;
    const used = new Set(base.filter((s): s is string => s !== null));
    const next = [...base];
    for (const cam of pool) {
      if (next.length >= count) break;
      const key = cameraKey(cam);
      if (!used.has(key)) { next.push(key); used.add(key); }
    }
    while (next.length < count) next.push(null);
    return next;
  }, [slots, count, pool]);

  useEffect(() => { saveAssignments(viewSlots); }, [viewSlots]);
  useEffect(() => { saveFavorites(favorites); }, [favorites]);

  /* Rotation pages the whole wall through the current pool. It only makes
     sense when the pool has more cameras than the wall has tiles. */
  useEffect(() => {
    if (!rotating) return;
    const iv = setInterval(() => setTick(t => t + 1), ROTATE_SECONDS * 1000);
    return () => clearInterval(iv);
  }, [rotating]);
  useEffect(() => {
    if (!rotating || tick === 0) return;
    const current = poolRef.current;
    if (current.length > count) setSlots(rotateWindow(current, count, tick).map(cameraKey));
  }, [tick, rotating, count]);

  const setLayout = (next: WallLayout) => {
    setLayoutState(next);
    saveLayout(next);
    setFocus(null);
  };

  const choosePool = (mode: PoolMode) => {
    setPoolMode(mode);
    setRotating(false);
    setTick(0);
    fill(pools[mode], count);
  };

  const toggleFavorite = (key: string) => {
    setFavorites(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else rootRef.current?.requestFullscreen().catch(() => {});
  };
  useEffect(() => {
    const onFs = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  /* Escape unwinds one level at a time: picker, then focus, then the wall. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (picker !== null) setPicker(null);
      else if (focus !== null) setFocus(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker, focus, onClose]);

  /* Which slots may run a decoder: the first MAX_PLAYING_VIDEO_TILES video
     cameras in slot order. A focused tile always plays. */
  const playingVideo = useMemo(() => {
    const allowed = new Set<number>();
    let videos = 0;
    viewSlots.forEach((id, i) => {
      const cam = id ? byId.get(id) : undefined;
      if (cam && isVideoWallCamera(cam)) {
        if (videos < MAX_PLAYING_VIDEO_TILES) allowed.add(i);
        videos++;
      }
    });
    return allowed;
  }, [viewSlots, byId]);

  const pickerList = useMemo(() => {
    if (picker === null) return [];
    const q = query.trim().toLowerCase();
    const source = poolMode === 'texas' ? pools.texas : poolMode === 'favorites' ? pools.favorites : pools.world;
    return source
      .filter(c => !q || `${c.name ?? ''} ${c.city ?? ''} ${c.country ?? ''} ${c.source ?? ''}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [picker, query, poolMode, pools]);

  const btn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border font-mono text-[9px] tracking-[0.15em] uppercase transition-colors';
  const btnIdle = 'border-white/15 text-white/60 hover:bg-white/10 hover:text-white';
  const btnActive = 'border-[var(--gold-primary)]/60 bg-[var(--gold-primary)]/15 text-[var(--gold-primary)]';

  const renderTile = (slotIndex: number, big: boolean) => {
    const id = viewSlots[slotIndex];
    const cam = id ? byId.get(id) : undefined;
    const isFav = id ? favoriteSet.has(id) : false;
    return (
      <div
        key={slotIndex}
        className="group relative overflow-hidden bg-black"
        style={{ border: '1px solid rgba(255,255,255,0.09)' }}
      >
        {cam ? (
          <button
            className="absolute inset-0 h-full w-full cursor-pointer"
            onClick={() => setFocus(big ? null : slotIndex)}
            title={big ? 'Back to the wall' : 'Focus this camera'}
          >
            <CameraTileMedia cam={cam} playVideo={big || playingVideo.has(slotIndex)} />
          </button>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/25">
              {catalog.length ? 'Empty tile' : 'Linking cameras…'}
            </span>
          </div>
        )}

        {/* Label bar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 pb-1.5 pt-5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cam && isVideoWallCamera(cam) ? 'bg-red-500 animate-pulse' : 'bg-emerald-400/80'}`} />
          <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-white">
            {cam?.name ?? '—'}
          </span>
          <span className="hidden truncate font-mono text-[8px] uppercase tracking-wider text-white/45 md:block">
            {cam ? `${cam.city ?? ''}${cam.country ? `, ${cam.country}` : ''} · ${cam.source ?? ''}` : ''}
          </span>
        </div>

        {/* Tile controls — visible on hover, always reachable on touch. */}
        <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={() => id && toggleFavorite(id)}
            className="rounded-sm border border-white/15 bg-black/70 p-1.5 text-white/70 transition-colors hover:text-[var(--gold-primary)]"
            title={isFav ? 'Remove from favourites' : 'Add to favourites'}
          >
            <Star className="h-3 w-3" fill={isFav ? 'var(--gold-primary)' : 'none'} stroke={isFav ? 'var(--gold-primary)' : 'currentColor'} />
          </button>
          <button
            onClick={() => { setQuery(''); setPicker(slotIndex); }}
            className="rounded-sm border border-white/15 bg-black/70 p-1.5 text-white/70 transition-colors hover:text-white"
            title="Change this camera"
          >
            <SwitchCamera className="h-3 w-3" />
          </button>
          <button
            onClick={() => setFocus(big ? null : slotIndex)}
            className="rounded-sm border border-white/15 bg-black/70 p-1.5 text-white/70 transition-colors hover:text-white"
            title={big ? 'Back to the wall' : 'Focus this camera'}
          >
            {big ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
          {cam && (
            <button
              onClick={() => onOpenCamera(cam)}
              className="rounded-sm border border-white/15 bg-black/70 p-1.5 text-white/70 transition-colors hover:text-white"
              title="Open in the full viewer (analysis, source links)"
            >
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[950] flex flex-col bg-black">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/90 px-3 py-2">
        <div className="flex items-center gap-2 pr-1">
          <LayoutGrid className="h-4 w-4 text-[var(--gold-primary)]" />
          <span className="font-mono text-[12px] font-bold tracking-[0.25em] text-white">CAMERA THEATER</span>
          <span className="hidden font-mono text-[9px] tracking-wider text-white/35 lg:block">
            {catalog.length.toLocaleString()} CAMERAS IN CATALOGUE
          </span>
        </div>

        <div className="mx-1 hidden h-4 w-px bg-white/10 md:block" />

        {/* Pool presets */}
        <button onClick={() => choosePool('texas')} className={`${btn} ${poolMode === 'texas' ? btnActive : btnIdle}`}>Texas · El Paso</button>
        <button onClick={() => choosePool('favorites')} className={`${btn} ${poolMode === 'favorites' ? btnActive : btnIdle}`}>
          <Star className="h-3 w-3" /> Favourites ({favorites.length})
        </button>
        <button onClick={() => choosePool('world')} className={`${btn} ${poolMode === 'world' ? btnActive : btnIdle}`}>World</button>

        <button
          onClick={() => { setRotating(r => !r); setTick(0); }}
          className={`${btn} ${rotating ? btnActive : btnIdle}`}
          title={pool.length > count ? `Rotate the wall through the ${poolMode} pool every ${ROTATE_SECONDS}s` : 'Rotation needs a pool bigger than the wall'}
        >
          {rotating ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} Rotate
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* Layout switch */}
          <div className="flex overflow-hidden rounded-sm border border-white/15">
            {WALL_LAYOUTS.map(l => (
              <button
                key={l}
                onClick={() => setLayout(l)}
                className={`px-2 py-1.5 font-mono text-[9px] tracking-widest transition-colors ${layout === l ? 'bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]' : 'text-white/55 hover:bg-white/10'}`}
              >
                {l}×{l}
              </button>
            ))}
          </div>
          <button onClick={onAmbient} className={`${btn} ${btnIdle}`} title="Ambient TV — scenic cameras, fullscreen, hands-off">
            <MonitorPlay className="h-3 w-3" /> Ambient TV
          </button>
          <button onClick={toggleFullscreen} className={`${btn} ${btnIdle}`} title="Fullscreen">
            {isFs ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            <span className="hidden lg:inline">Fullscreen</span>
          </button>
          <button onClick={onClose} className="rounded-sm border border-red-500/30 bg-red-900/20 p-1.5 text-red-300 transition-colors hover:bg-red-500/25" title="Close the theater (Esc)">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* The wall */}
      {focus !== null ? (
        <div className="relative flex-1 p-1.5">{renderTile(focus, true)}</div>
      ) : (
        <div
          className="grid flex-1 gap-1.5 p-1.5"
          style={{
            gridTemplateColumns: `repeat(${layout}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: count }, (_, i) => renderTile(i, false))}
        </div>
      )}

      {/* Camera picker */}
      {picker !== null && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setPicker(null)}>
          <div
            className="flex max-h-[80vh] w-full max-w-[560px] flex-col border border-white/15 bg-[#0a0a0a] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
              <Search className="h-3.5 w-3.5 text-white/40" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search the ${poolMode} pool — name, city, source…`}
                className="flex-1 bg-transparent font-mono text-[11px] text-white placeholder:text-white/30 focus:outline-none"
              />
              <button onClick={() => setPicker(null)} className="p-1 text-white/50 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="styled-scrollbar flex-1 overflow-y-auto">
              {pickerList.map(cam => {
                const key = cameraKey(cam);
                return (
                  <div key={key} className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-2 transition-colors hover:bg-white/5">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setSlots(viewSlots.map((s, i) => (i === picker ? key : s)));
                        setRotating(false);
                        setPicker(null);
                      }}
                    >
                      <span className="block truncate font-mono text-[11px] text-white">{cam.name}</span>
                      <span className="block truncate font-mono text-[8px] uppercase tracking-wider text-white/40">
                        {cam.city ?? ''}{cam.country ? `, ${cam.country}` : ''} · {cam.source ?? ''} · {(cam.stream_type ?? 'jpg').toUpperCase()}
                      </span>
                    </button>
                    <button
                      onClick={() => toggleFavorite(key)}
                      className="p-1.5 text-white/50 transition-colors hover:text-[var(--gold-primary)]"
                      title="Toggle favourite"
                    >
                      <Star className="h-3.5 w-3.5" fill={favoriteSet.has(key) ? 'var(--gold-primary)' : 'none'} stroke={favoriteSet.has(key) ? 'var(--gold-primary)' : 'currentColor'} />
                    </button>
                  </div>
                );
              })}
              {!pickerList.length && (
                <div className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-white/35">
                  {catalog.length ? 'No cameras match' : 'Catalogue still loading…'}
                </div>
              )}
              {pickerList.length >= 200 && (
                <div className="px-3 py-2 text-center font-mono text-[8px] uppercase tracking-widest text-white/30">
                  Showing the first 200 matches — keep typing to narrow it down
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
