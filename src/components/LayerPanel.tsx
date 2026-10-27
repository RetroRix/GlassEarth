'use client';

import { memo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane, Satellite, Sun, Moon, AlertTriangle, Camera,
  CloudLightning, CloudSun, Ship, Network, Database, Ghost,
  Flame, Tv, Radio, Mountain, Anchor, Megaphone, SlidersHorizontal, Bus,
  Pin, PinOff
} from 'lucide-react';
import StyleStudio from './StyleStudio';
import BarEdgeHandle from './BarEdgeHandle';
import { useHideableBar } from '@/lib/hideable-bars';
import { TERRAIN_MIN_ZOOM, type TerrainStatus } from '@/lib/map-terrain';

interface LayerPanelProps {
  data: any;
  activeLayers: any;
  setActiveLayers: React.Dispatch<React.SetStateAction<any>>;
  isMobile?: boolean;
  theme?: 'core' | 'ghost' | 'day';
  setTheme?: (theme: 'core' | 'ghost' | 'day') => void;
  /** Server-side capabilities, e.g. { cloudflare: true }. Layers declaring a
   *  `requires` key stay hidden until the matching capability is present. */
  capabilities?: Record<string, boolean>;
  terrainStatus?: TerrainStatus;
  onTerrainRetry?: () => void;
  onTerrainFocus?: () => void;
  on3DModeSelected?: () => void;
  /** False while the splash is up; the rail slides in when it turns true. */
  revealed?: boolean;
  /** A cockpit ride owns the screen: the rail auto-hides for the ride
   *  (hover / edge-tap still reveals it temporarily). */
  rideActive?: boolean;
  /** A layer's live state in a line, shown under its name in place of its description. */
  liveStatus?: Record<string, string>;
}

interface LayerDef {
  key: string;
  label: string;
  dataKey: string;
  description?: string;
  /** Reads a bucket out of data.category_counts instead of a top-level array. */
  catKey?: string;
  /** Capability that must be configured server-side for this layer to appear. */
  requires?: string;
  /** Key of the layer this one modifies. Renders indented beneath it, and reads
   *  as inert while that parent is off — it has nothing to act on. */
  parent?: string;
}

interface LayerGroupDef {
  label: string;
  fullLabel: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  layers: LayerDef[];
}

const LAYER_GROUPS: LayerGroupDef[] = [
  {
    label: 'WEATHER',
    fullLabel: 'WEATHER',
    icon: CloudSun,
    layers: [
      { key: 'live_clouds', label: 'Live Clouds', description: 'NOAA satellites · lit in 3D · hourly', dataKey: '' },
      { key: 'wind', label: 'Wind', description: 'NOAA GFS · surface wind · 6-hourly', dataKey: '' },
      { key: 'wind_controls', label: 'Time Controls', description: '3 days back · 5 ahead', dataKey: '', parent: 'wind' },
      { key: 'wind_particles', label: 'Particles', description: 'The classic look · coloured by speed', dataKey: '', parent: 'wind' },
      { key: 'rain', label: 'Rain', description: 'RainViewer radar · every 10 min', dataKey: '' },
      { key: 'rain_controls', label: 'Time Controls', description: 'Last 2 hours · loop', dataKey: '', parent: 'rain' },
      { key: 'noaa_radar', label: 'NOAA Radar', description: 'nowCOAST MRMS mosaic · CONUS · ~4 min', dataKey: '' },
      { key: 'goes_ir', label: 'Satellite IR', description: 'NOAA GOES longwave IR · nowCOAST · 5 min', dataKey: '' },
      { key: 'lightning', label: 'Lightning', description: 'Strike density · NLDN / GLD360 · 15 min', dataKey: '' },
      { key: 'date_compare', label: 'Date Compare', description: 'NASA HLS satellite · before/after swipe · last 30 days', dataKey: '' },
    ],
  },
  {
    label: 'AVIATION',
    fullLabel: 'AVIATION',
    icon: Plane,
    layers: [
      { key: 'flights', label: 'Commercial', dataKey: 'commercial_flights' },
      { key: 'private', label: 'Private', dataKey: 'private_flights' },
      { key: 'jets', label: 'Private Jets', dataKey: 'private_jets' },
      { key: 'military', label: 'Military', dataKey: 'military_flights' },
    ],
  },
  {
    label: 'MARITIME',
    fullLabel: 'MARITIME',
    icon: Ship,
    layers: [
      { key: 'maritime', label: 'Maritime / Naval', dataKey: 'maritime_ships,maritime_ports,maritime_chokepoints' },
      { key: 'sdk_sea', label: 'Maritime Lines', dataKey: 'sdk_entities' },
    ],
  },
  {
    label: 'TRANSIT',
    fullLabel: 'GROUND TRANSIT',
    icon: Bus,
    layers: [
      { key: 'transit', label: 'Live Buses & Transit', description: 'Operator GPS feeds · every 20 s', dataKey: '' },
    ],
  },
  {
    label: 'SPACE',
    fullLabel: 'SPACE TRACKING',
    icon: Satellite,
    layers: [
      { key: 'satellites', label: 'All Satellites', dataKey: 'satellites' },
      { key: 'sat_comms', label: 'Starlink / Comms', dataKey: 'satellites', catKey: 'comms' },
      { key: 'sat_military', label: 'Military / Intel', dataKey: 'satellites', catKey: 'military' },
      { key: 'sat_navigation', label: 'GPS / Navigation', dataKey: 'satellites', catKey: 'navigation' },
      { key: 'sat_earth', label: 'Earth Observation', dataKey: 'satellites', catKey: 'earth_obs' },
      { key: 'sat_science', label: 'Stations / Telescopes', dataKey: 'satellites', catKey: 'science' },
      { key: 'launches', label: 'Rocket Launches', description: 'Launch Library 2 · next 30 days · NET countdowns', dataKey: '' },
    ],
  },
  {
    label: 'SURVEIL',
    fullLabel: 'SURVEILLANCE',
    icon: Camera,
    layers: [
      { key: 'cctv', label: 'CCTV Cameras', dataKey: 'cameras' },
      { key: 'cctv_previews', label: 'Live Previews', dataKey: '', parent: 'cctv' },
      { key: 'live_news', label: 'Live News Feeds', dataKey: 'live_feeds' },
    ],
  },
  {
    label: 'HAZARD',
    fullLabel: 'NATURAL HAZARDS',
    icon: CloudLightning,
    layers: [
      { key: 'earthquakes', label: 'Earthquakes', dataKey: 'earthquakes' },
      { key: 'fires', label: 'Active Fires', dataKey: 'fires' },
      { key: 'weather', label: 'Severe Weather', dataKey: 'weather_events' },
      { key: 'cyclones', label: 'Tropical Cyclones', description: 'NHC / CPHC · forecast cone + track', dataKey: '' },
      { key: 'fire_perimeters', label: 'Wildfire Perimeters', description: 'WFIGS / NIFC · reported perimeters + incidents', dataKey: '' },
    ],
  },
  {
    label: 'THREAT',
    fullLabel: 'THREATS & INTEL',
    icon: AlertTriangle,
    layers: [
      { key: 'infrastructure', label: 'Nuclear Facilities', dataKey: 'infrastructure' },
      { key: 'global_incidents', label: 'Global Incidents', dataKey: 'gdelt' },
      { key: 'alert_pins', label: 'Live Alert Pins', dataKey: 'alert_pins' },
      { key: 'gdelt_events', label: 'GDELT Events', dataKey: 'gdelt_events' },
    ],
  },
  {
    label: 'NETWORK',
    fullLabel: 'NETWORK INTEL',
    icon: Network,
    layers: [
      { key: 'malware', label: 'Live Malware', dataKey: 'malware_threats' },
      { key: 'cyber_attacks', label: 'Botnet C2 Servers', dataKey: 'cyber_attacks' },
    ],
  },
  {
    label: 'NETINTEL',
    fullLabel: 'NET & EVENT INTEL',
    icon: Megaphone,
    layers: [
      { key: 'cf_outages', label: 'Internet Outages', dataKey: 'cf_outages', requires: 'cloudflare' },
      { key: 'cf_attacks', label: 'Attack Origins', dataKey: 'cf_attack_origins', requires: 'cloudflare' },
    ],
  },
  {
    label: 'DISPLAY',
    fullLabel: 'DISPLAY',
    icon: Sun,
    layers: [
      { key: 'day_night', label: 'Day / Night Cycle', dataKey: '' },
      { key: 'state_borders', label: 'US State Borders', dataKey: '' },
      { key: 'terrain_3d', label: '3D Buildings', description: 'City detail · zoom 14.5+', dataKey: '' },
      { key: 'terrain_elevation', label: '3D Terrain', description: 'Mountains · zoom 10+', dataKey: '' },
    ],
  },
];

/* ── Minimal Toggle Switch ── */
/**
 * Presentational only. The row around it is the button, and a button inside a
 * button is invalid HTML — the browser reparents it, which breaks hydration and
 * silently drops the click handler on the inner control.
 */
function ToggleSwitch({ active }: { active: boolean }) {
  return (
    <span
      role="presentation"
      className="relative flex-shrink-0 block"
      style={{ width: 28, height: 14 }}
    >
      <div
        className="absolute inset-0 rounded-full transition-all duration-300"
        style={{
          background: active ? 'var(--tg-track-on)' : 'transparent',
          border: active ? '1px solid var(--tg-border-on)' : '1px solid var(--tg-border-off)',
          boxShadow: active ? '0 0 8px var(--tg-trackglow-on)' : 'none',
        }}
      />
      <motion.div
        className="absolute top-[2px] rounded-full"
        style={{
          width: 10,
          height: 10,
          background: active ? 'var(--tg-knob-on)' : 'var(--tg-knob-off)',
          boxShadow: active ? '0 0 6px var(--tg-glow-on)' : 'none',
        }}
        animate={{ left: active ? 16 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </span>
  );
}

/**
 * The elbow that ties a sub-layer row to the layer above it. Indentation alone
 * reads as a typo at this size; the line is what says "this belongs to that".
 */
function SubLayerStem() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-[6px] top-0 h-1/2 w-[8px] rounded-bl-[3px] border-b border-l border-[var(--lp-border-stem)]"
    />
  );
}

function LayerPanel({ data, activeLayers, setActiveLayers, isMobile, theme = 'core', setTheme, capabilities = {}, terrainStatus = 'idle', onTerrainRetry, onTerrainFocus, on3DModeSelected, revealed = true, liveStatus, rideActive = false }: LayerPanelProps) {
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  /**
   * A pinned group stays open when the pointer leaves. Hover-only flyouts are
   * fine to glance at and impossible to work in — reaching for a toggle at the
   * far edge closes the thing you were reaching for.
   */
  const [pinnedGroup, setPinnedGroup] = useState<string | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);

  /* Hideable rail (desktop only; the mobile layout has no side bar). A
     flyout pinned open from the rail, or the Style Studio it launched,
     holds the rail on screen — it never hides out from under its own
     panel. Destructured: the compiler tracks each binding on its own. */
  const {
    pinned: barPinned,
    visible: barVisibleNow,
    tapStuck: barTapStuck,
    rootRef: barRootRef,
    togglePinned: barTogglePinned,
    noteEnter: barNoteEnter,
    noteLeave: barNoteLeave,
    noteFocus: barNoteFocus,
    noteBlur: barNoteBlur,
    toggleTap: barToggleTap,
  } = useHideableBar('left', {
    panelOpen: pinnedGroup !== null || studioOpen,
    riding: rideActive,
  });

  useEffect(() => {
    if (!pinnedGroup) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinnedGroup(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinnedGroup]);

  const toggle = (key: string) => {
    if ((key === 'terrain_elevation' || key === 'terrain_3d') && !activeLayers[key]) on3DModeSelected?.();
    setActiveLayers((prev: any) => ({ ...prev, [key]: !prev[key] }));
  };
  const terrainDetails = activeLayers.terrain_elevation ? (
    <div className="mt-2 rounded-lg border border-[var(--lp-border-med)] bg-[var(--lp-fill)] p-2.5 text-[10px] text-[var(--lp-fg-body)]">
      <p role="status">{terrainStatus === 'idle' ? `Terrain at zoom ${TERRAIN_MIN_ZOOM}+ · zoom in` : terrainStatus === 'waiting' ? 'Terrain starts when you stop moving' : terrainStatus === 'loading' ? 'Loading nearby terrain…' : terrainStatus === 'error' ? 'Terrain unavailable; the map is still usable.' : 'Terrain on'}</p>
      {terrainStatus === 'idle' && <button type="button" onClick={onTerrainFocus} className="mt-2 min-h-8 rounded border border-[var(--lp-border-btn)] px-2 text-[var(--gold-primary)] hover:bg-[var(--lp-hover-strong)]">Zoom to terrain</button>}
      {terrainStatus === 'error' && <button type="button" onClick={onTerrainRetry} className="mt-2 min-h-8 rounded border border-[var(--lp-border-btn)] px-2 text-[var(--gold-primary)] hover:bg-[var(--lp-hover-strong)]">Retry terrain</button>}
      <p className="mt-2 text-[var(--lp-fg-faint)]">Nearby detail only · cached tiles</p>
      <a className="mt-1 inline-block underline underline-offset-2" href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener noreferrer">Terrain credits</a>
    </div>
  ) : null;

  /** Switch a whole group at once — off if any are on, otherwise all on.
   *  Sub-layers keep their setting: they only say how their parent shows. */
  const toggleGroup = (layers: LayerDef[]) => {
    const top = layers.filter(l => !l.parent);
    const anyOn = top.some(l => activeLayers[l.key]);
    if (!anyOn && top.some(l => l.key === 'terrain_elevation' || l.key === 'terrain_3d')) on3DModeSelected?.();
    setActiveLayers((prev: any) => {
      const next = { ...prev };
      for (const l of top) next[l.key] = !anyOn;
      return next;
    });
  };

  /* Drop layers whose backing capability is not configured, then drop any group
     left with nothing to show. */
  const visibleGroups = LAYER_GROUPS.map(g => ({
    ...g,
    layers: g.layers.filter(l => !l.requires || capabilities[l.requires]),
  })).filter(g => g.layers.length > 0);

  const getCount = (dk: string, catKey?: string): number | null => {
    if (!dk) return null;
    if (catKey && data.category_counts) {
      return data.category_counts[catKey] || 0;
    }
    let total = 0;
    let found = false;
    for (const k of dk.split(',')) {
      if (data[k] && Array.isArray(data[k])) {
        total += data[k].length;
        found = true;
      }
    }
    return found ? total : null;
  };

  /* ── MOBILE ── */
  if (isMobile) {
    return (
      <div className="flex flex-col gap-5 py-2">
        {visibleGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-2">
            <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-[var(--lp-fg-head)] border-b border-[var(--lp-border)] pb-1.5">
              {group.fullLabel}
            </div>
            <div className="flex flex-col gap-1">
              {group.layers.map((layer) => {
                const isLayerActive = activeLayers[layer.key];
                const count = getCount(layer.dataKey, layer.catKey);
                const dormant = !!layer.parent && !activeLayers[layer.parent];
                return (
                  <button
                    key={layer.key}
                    onClick={() => toggle(layer.key)}
                    aria-pressed={!!isLayerActive}
                    aria-label={layer.label}
                    className={`relative w-full flex items-center gap-3 py-2 rounded-md text-left hover:bg-[var(--lp-hover)] transition-colors ${layer.parent ? 'pl-[22px] pr-1' : 'px-1'} ${dormant ? 'opacity-40' : ''}`}
                  >
                    {layer.parent && <SubLayerStem />}
                    <ToggleSwitch active={!!isLayerActive} />
                    <span className={`text-[11px] font-mono uppercase tracking-wider flex-1 transition-colors ${isLayerActive ? 'text-[var(--lp-fg-strong)]' : 'text-[var(--lp-fg-soft)]'}`}>
                      {layer.label}
                      {(liveStatus?.[layer.key] ?? layer.description) && <span className={`block mt-0.5 text-[9px] normal-case tracking-normal ${liveStatus?.[layer.key] ? 'text-[var(--lp-fg-mid)]' : 'text-[var(--lp-fg-faint)]'}`}>{liveStatus?.[layer.key] ?? layer.description}</span>}
                    </span>
                    {count !== null && (
                      <span className="text-[10px] font-mono tabular-nums text-[var(--lp-fg-mute)]">
                        {count.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}
              {group.label === 'DISPLAY' && terrainDetails}
            </div>
          </div>
        ))}

        {/* MOBILE STYLE STUDIO */}
        <div className="flex items-center justify-between mt-2 pt-3 border-t border-[var(--lp-border)] px-1">
          <span className="text-[10px] font-mono tracking-[0.2em] text-[var(--lp-fg-mute)] uppercase">Style Studio</span>
          <button
            onClick={() => setStudioOpen(o => !o)}
            aria-pressed={studioOpen}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
            style={{
              background: studioOpen ? 'var(--hover-accent)' : 'transparent',
              boxShadow: studioOpen ? '0 0 12px var(--gold-glow)' : 'none',
            }}
          >
            <SlidersHorizontal className="w-4 h-4" style={{ color: studioOpen ? 'var(--gold-primary)' : 'var(--lp-fg-mute)' }} />
          </button>
        </div>
        <AnimatePresence>
          {studioOpen && <StyleStudio isMobile onClose={() => setStudioOpen(false)} />}
        </AnimatePresence>

        {/* MOBILE DAY / NIGHT TOGGLE — the same base-theme switch as the
            desktop tool strip's sun/moon button. */}
        {setTheme && (
          <div className="flex items-center justify-between pt-3 border-t border-[var(--lp-border)] px-1">
            <span className="text-[10px] font-mono tracking-[0.2em] text-[var(--lp-fg-mute)] uppercase">Day / Night</span>
            <button
              onClick={() => setTheme(theme === 'day' ? 'core' : 'day')}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{
                background: theme === 'day' ? 'rgba(212, 175, 55, 0.15)' : 'transparent',
                boxShadow: theme === 'day' ? '0 0 12px rgba(212, 175, 55, 0.3)' : 'none',
              }}
              title="Day / Night — switch between the light day theme and the dark theme"
              aria-label="Toggle day and night mode"
              aria-pressed={theme === 'day'}
            >
              {theme === 'day'
                ? <Sun className="w-4 h-4" style={{ color: 'var(--gold-primary)' }} />
                : <Moon className="w-4 h-4" style={{ color: 'var(--lp-fg-mute)' }} />}
            </button>
          </div>
        )}

        {/* MOBILE GHOST TOGGLE */}
        {setTheme && (
          <div className="flex items-center justify-between pt-3 border-t border-[var(--lp-border)] px-1">
            <span className="text-[10px] font-mono tracking-[0.2em] text-[var(--lp-fg-mute)] uppercase">Ghost Protocol</span>
            <button
              onClick={() => setTheme(theme === 'core' ? 'ghost' : 'core')}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{
                background: theme === 'ghost' ? 'rgba(179, 136, 255, 0.15)' : 'transparent',
                boxShadow: theme === 'ghost' ? '0 0 12px rgba(179, 136, 255, 0.3)' : 'none',
              }}
            >
              <Ghost className="w-4 h-4" style={{ color: theme === 'ghost' ? '#B388FF' : 'var(--lp-fg-mute)' }} />
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── DESKTOP ── */
  return (
    <div ref={barRootRef} className="absolute top-0 left-0 h-full w-[64px] z-50 pointer-events-none">
      {/* The rail and its flyouts ride this slider: tucked off the left
          edge when hidden, flush when shown. visibility flips with the
          slide so a hidden rail leaves the tab order too. */}
      <div
        onMouseEnter={barNoteEnter}
        onMouseLeave={barNoteLeave}
        onFocus={barNoteFocus}
        onBlur={barNoteBlur}
        className="absolute top-0 left-0 h-full pointer-events-none"
        style={{
          /* 'none', not translateX(0), while shown: any transform at all
             becomes the containing block for fixed-position descendants. */
          transform: barVisibleNow ? 'none' : 'translateX(-110%)',
          opacity: barVisibleNow ? 1 : 0,
          visibility: barVisibleNow ? 'visible' : 'hidden',
          transition: barVisibleNow
            ? 'transform 300ms cubic-bezier(0.22,1,0.36,1), opacity 220ms ease, visibility 0s'
            : 'transform 300ms cubic-bezier(0.22,1,0.36,1), opacity 220ms ease, visibility 0s 300ms',
        }}
      >
    <motion.div
      initial={{ x: -60, opacity: 0 }}
      animate={revealed ? { x: 0, opacity: 1 } : { x: -60, opacity: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 200, delay: 0.25 }}
      className="lp-darkscope relative h-full w-[48px] flex flex-col items-center pt-24 pb-6 pointer-events-auto"
      style={{
        background: 'var(--lp-rail-bg)',
        backdropFilter: 'blur(24px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.2)',
      }}
    >
      <div className="flex-1 flex flex-col items-center gap-1">
        {visibleGroups.map((group, index) => {
          /* Sub-layers modify a parent rather than draw anything of their own,
             so they do not count towards the rail's reading. */
          const counted = group.layers.filter(l => !l.parent);
          const groupActive = counted.some(l => activeLayers[l.key]);
          const isHovered = hoveredGroup === group.label;
          const Icon = group.icon;

          const activeCount = counted.filter(l => activeLayers[l.key]).length;
          const isPinned = pinnedGroup === group.label;
          const isOpen = isHovered || isPinned;

          return (
            <div
              key={group.label}
              className="relative flex items-center justify-center"
              onMouseEnter={() => setHoveredGroup(group.label)}
              onMouseLeave={() => setHoveredGroup(null)}
            >
              {/* A real button, not a div: this is keyboard reachable, focusable
                  and announced. Clicking pins the flyout open so it can be
                  worked in rather than only glanced at. */}
              <button
                onClick={() => setPinnedGroup(isPinned ? null : group.label)}
                aria-expanded={isOpen}
                aria-label={`${group.fullLabel}${activeCount ? ` — ${activeCount} active` : ''}`}
                title={group.fullLabel}
                className="relative w-10 h-10 flex items-center justify-center cursor-pointer rounded-lg transition-all duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                style={{
                  background: isPinned
                    ? 'rgba(255,255,255,0.10)'
                    : isHovered ? 'rgba(255,255,255,0.05)' : 'transparent',
                }}
              >
                <Icon
                  className="transition-all duration-300"
                  style={{
                    width: 16,
                    height: 16,
                    color: groupActive
                      ? 'rgba(255,255,255,0.75)'
                      : isOpen
                        ? 'rgba(255,255,255,0.45)'
                        : 'rgba(255,255,255,0.22)',
                    filter: groupActive ? 'drop-shadow(0 0 4px rgba(255,255,255,0.3))' : 'none',
                  }}
                />

                {/* How many layers in this group are live. Without it the rail
                    gives no reading at all until each icon is hovered in turn. */}
                {activeCount > 0 && (
                  <span
                    className="absolute top-1 right-1 min-w-[13px] h-[13px] px-[3px] rounded-full flex items-center justify-center text-[9px] font-mono tabular-nums leading-none"
                    style={{
                      background: 'rgba(0,229,255,0.9)',
                      color: '#04040A',
                      boxShadow: '0 0 6px rgba(0,229,255,0.5)',
                    }}
                  >
                    {activeCount}
                  </span>
                )}
              </button>

              {/* Flyout (LEFT side). Centred on its icon, but the first hangs
                  down from it: the top of the rail leaves no room above. */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0, x: -8, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, x: -4, filter: 'blur(2px)' }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className={`absolute left-[52px] ${index === 0 ? 'top-0' : 'top-1/2 -translate-y-1/2'} min-w-[220px] rounded-xl p-3 z-[100] pointer-events-auto`}
                    style={{
                      background: 'rgba(0,0,0,0.6)',
                      backdropFilter: 'blur(40px) saturate(1.5)',
                      WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2.5 pb-1.5 border-b border-white/[0.04]">
                      <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/35 flex-1">
                        {group.fullLabel}
                      </span>
                      {/* Switching eight satellite layers one at a time is the
                          kind of thing that makes a panel feel unfinished. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleGroup(group.layers); }}
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wider text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        {activeCount > 0 ? 'NONE' : 'ALL'}
                      </button>
                      {isPinned && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPinnedGroup(null); }}
                          aria-label="Close"
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {group.layers.map((layer) => {
                        const isLayerActive = activeLayers[layer.key];
                        const count = getCount(layer.dataKey, layer.catKey);
                        const dormant = !!layer.parent && !activeLayers[layer.parent];

                        return (
                          <button
                            key={layer.key}
                            onClick={() => toggle(layer.key)}
                            aria-pressed={!!isLayerActive}
                            aria-label={layer.label}
                            title={dormant ? 'Turn the layer above on to use this' : undefined}
                            className={`relative w-full flex items-center gap-3 py-1.5 rounded-md hover:bg-white/[0.05] transition-colors cursor-pointer text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${layer.parent ? 'pl-[22px] pr-1' : 'px-1'} ${dormant ? 'opacity-40' : ''}`}
                          >
                            {layer.parent && <SubLayerStem />}
                            <ToggleSwitch active={!!isLayerActive} />
                            <span className={`text-[11px] font-mono uppercase tracking-wider flex-1 transition-colors duration-200 ${isLayerActive ? 'text-white/70' : 'text-white/35'}`}>
                              {layer.label}
                              {(liveStatus?.[layer.key] ?? layer.description) && <span className={`block mt-0.5 text-[9px] normal-case tracking-normal ${liveStatus?.[layer.key] ? 'text-white/55' : 'text-white/35'}`}>{liveStatus?.[layer.key] ?? layer.description}</span>}
                            </span>
                            {count !== null && (
                              <span className={`text-[10px] font-mono tabular-nums transition-colors ${isLayerActive ? 'text-white/45' : 'text-white/20'}`}>
                                {count.toLocaleString()}
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {group.label === 'DISPLAY' && terrainDetails}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Subtle separator */}
      <div className="w-5 h-px bg-white/[0.06] my-2" />

      {/* Style Studio */}
      <button
        onClick={() => setStudioOpen(o => !o)}
        aria-pressed={studioOpen}
        className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-500 cursor-pointer"
        style={{ background: studioOpen ? 'var(--hover-accent)' : 'transparent' }}
        title="Style Studio"
      >
        <SlidersHorizontal
          className="transition-all duration-500"
          style={{
            width: 15,
            height: 15,
            color: studioOpen ? 'var(--gold-primary)' : 'rgba(255,255,255,0.15)',
            filter: studioOpen ? 'drop-shadow(0 0 6px var(--gold-glow))' : 'none',
          }}
        />
      </button>
      <AnimatePresence>
        {studioOpen && <StyleStudio onClose={() => setStudioOpen(false)} />}
      </AnimatePresence>

      {/* Ghost Protocol Toggle */}
      {setTheme && (
        <button
          onClick={() => setTheme(theme === 'core' ? 'ghost' : 'core')}
          className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-500 cursor-pointer"
          style={{
            background: theme === 'ghost' ? 'rgba(179, 136, 255, 0.1)' : 'transparent',
          }}
          title="Ghost Protocol"
        >
          <Ghost
            className="transition-all duration-500"
            style={{
              width: 15,
              height: 15,
              color: theme === 'ghost' ? '#B388FF' : 'rgba(255,255,255,0.15)',
              filter: theme === 'ghost' ? 'drop-shadow(0 0 6px rgba(179, 136, 255, 0.5))' : 'none',
            }}
          />
        </button>
      )}

      {/* Pin toggle — lock the rail on screen, or hand it to auto-hide.
          The choice is remembered per visitor (lib/hideable-bars). */}
      <button
        onClick={barTogglePinned}
        aria-pressed={barPinned}
        className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-500 cursor-pointer"
        style={{ background: barPinned ? 'var(--hover-accent)' : 'transparent' }}
        title={barPinned ? 'Rail pinned — tap to let it tuck away' : 'Rail auto-hides — tap to pin it on screen'}
      >
        {barPinned ? (
          <Pin
            className="transition-all duration-500"
            style={{
              width: 15,
              height: 15,
              color: 'var(--gold-primary)',
              filter: 'drop-shadow(0 0 6px var(--gold-glow))',
            }}
          />
        ) : (
          <PinOff
            className="transition-all duration-500"
            style={{ width: 15, height: 15, color: 'rgba(255,255,255,0.15)' }}
          />
        )}
      </button>
    </motion.div>
      </div>

      {/* Edge zone + handle, only while the rail is tucked away: hovering
          the screen edge reveals the rail; on touch the handle is the tap
          target. A tap-stuck rail keeps a hide-mode handle instead. */}
      {!barVisibleNow && (
        <div
          className="absolute left-0 top-0 h-full w-[16px] pointer-events-auto"
          onMouseEnter={barNoteEnter}
          onMouseLeave={barNoteLeave}
        >
          <BarEdgeHandle side="left" mode="show" label="layers toolbar" onTap={barToggleTap} />
        </div>
      )}
      {barVisibleNow && barTapStuck && (
        <BarEdgeHandle side="left" mode="hide" label="layers toolbar" onTap={barToggleTap} />
      )}
    </div>
  );
}

export default memo(LayerPanel);
