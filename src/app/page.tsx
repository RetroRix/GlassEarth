'use client';

import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, BarChart3, Newspaper, Search, X, Globe, MapPinned, Route, Satellite, Moon, Sun, ExternalLink, AlertTriangle, Activity, Database, Wifi, Play, Network, Crosshair, Bluetooth, Pentagon, Radio , PenLine, Orbit, LayoutGrid, Tv, Plane, RadioTower, Dices, Home, ArrowLeft } from 'lucide-react';
import { type TerrainStatus } from '@/lib/map-terrain';
import { loadCameraCatalog, mergeCameraCatalog } from '@/lib/camera-catalog';
import { pickRouletteCamera, rouletteControlState, shouldShowRouletteFab, type WallCamera } from '@/lib/theater-wall';
import { FLIGHT_STALE_REFETCH_ATTEMPTS, FLIGHT_STALE_REFETCH_MS, hasFlightData, isPartialFlightPayload, isStaleFlightPayload, nextFlightRetryDelay, normalizeFlightPayload, type FlightFeedStatus } from '@/lib/flight-load';
import { decodeShareView, type SharedView } from '@/lib/share-view';
import { HOME_BASE, isValidLatLon, parseGeoResponse, readLastView, resolveOpeningTarget, writeLastView, type GeoLocation, type LastView } from '@/lib/opening-view';
import { isHalloweenWindow, hasSpookyPreview, SPLASH_FAILSAFE_MS, SPOOKY_SPLASH_FAILSAFE_MS, SPLASH_STAGE3_HOLD_MS, SPOOKY_STAGE3_HOLD_MS } from '@/lib/seasonal';
import { createViewHistory } from '@/lib/view-history';
import LiveCounterStrip from '@/components/LiveCounterStrip';
import IntelFeed from '@/components/IntelFeed';
import MarketsPanel from '@/components/MarketsPanel';
import ScmPanel from '@/components/ScmPanel';
import SearchBar from '@/components/SearchBar';
import DirectionsBar, { type RouteResult, type LiveLocation, type TripPlan } from '@/components/DirectionsBar';
import NavigationView from '@/components/NavigationView';
import FlightWatchPanel, { type WatchedFlight, type FlightTelemetry, type AircraftDetail, type Airport } from '@/components/FlightWatchPanel';
import { stopsAhead, type NavProgress } from '@/lib/navigation';
import type { TransitStatus } from '@/lib/transit-layer';
import type { LiveDetection } from '@/lib/malware-intel';
import ScaleBar from '@/components/ScaleBar';
import ErrorBoundary from '@/components/ErrorBoundary';
import { applySettings, loadSavedSettings } from '@/lib/style-tokens';
import SharePanel from '@/components/SharePanel';
import ViewPresets from '@/components/ViewPresets';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import GlobalStatusBar from '@/components/GlobalStatusBar';
import LiveAlerts from '@/components/LiveAlerts';
import WorldRemote from '@/components/WorldRemote';
import BrandGlobe from '@/components/BrandGlobe';
import PumpkinGlobe from '@/components/PumpkinGlobe';
import ArcGISPanel from '@/components/ArcGISPanel';
import TvPanel from '@/components/TvPanel';
import PlaneSpottingPanel from '@/components/PlaneSpottingPanel';
import StationsPanel from '@/components/StationsPanel';
import RadioNowPlaying from '@/components/RadioNowPlaying';
import { loadTvFavorites, type RadioStation, type TvChannel } from '@/lib/stations';
const TvWall = dynamic(() => import('@/components/TvWall'), { ssr: false });
const OsirisMap = dynamic(() => import('@/components/OsirisMap'), { ssr: false });
const LayerPanel = dynamic(() => import('@/components/LayerPanel'));
const SpaceCam = dynamic(() => import('@/components/SpaceCam'), { ssr: false });
const CameraViewer = dynamic(() => import('@/components/CameraViewer'));
const TheaterWall = dynamic(() => import('@/components/TheaterWall'), { ssr: false });
const AmbientTv = dynamic(() => import('@/components/AmbientTv'), { ssr: false });
const OiPanel = dynamic(() => import('@/components/OiPanel'));
const DrawingToolbar = dynamic(() => import('@/components/DrawingToolbar'), { ssr: false });
const DrawHud = dynamic(() => import('@/components/DrawHud'), { ssr: false });
// The measurement helpers are pure functions — importing them directly keeps
// them out of the lazy chunk, so a finished polygon can be measured whether or
// not the toolbar has loaded yet.
import { toShape, queryRing, type DrawMode, type DrawnShape, type DrawProgress, type DrawResult } from '@/lib/draw';
import { selectInPolygon } from '@/lib/aoi';
import { diffSweep, appendEvents, type WatchBaseline, type WatchEvent } from '@/lib/watch';
import { STORAGE_KEY, serializeShapes, deserializeShapes, shapesToGeoJSON, downloadFile } from '@/lib/aoi-export';
import SupportMenu from '@/components/SupportMenu';
import { useOi } from '@/lib/oi/client';
import { useAssist } from '@/lib/oi/assist/client';
import type { Highlight, Site } from '@/lib/oi/assist/tools';
import { currentAnswer } from '@/lib/oi/state';
import type { OiMode } from '@/components/OiPanel';
import { OiMark } from '@/components/oi/atoms';
import type { Stage } from '@/components/oi/Workspace';
import { searchObjects, TYPE_LABEL, objectsOf } from '@/lib/oi/objects';
import { workspaceInsets } from '@/lib/oi/layout';
import type { OiGlobe, OiHover } from '@/lib/oi/globe';
import { look } from '@/lib/vision/store';
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Mobile if narrow, OR landscape phone (short height + moderate width)
      setIsMobile(w < 768 || (h < 500 && w < 1024));
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);
  return isMobile;
}
const UptimeClock = () => {
  const [uptime, setUptime] = useState('00:00:00');
  const startTime = useRef(0);
  if (startTime.current === 0) startTime.current = Date.now();
  useEffect(() => {
    const iv = setInterval(() => {
      const e = Math.floor((Date.now() - startTime.current) / 1000);
      setUptime(`${String(Math.floor(e/3600)).padStart(2,'0')}:${String(Math.floor((e%3600)/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`);
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  return <span className="hidden lg:inline">UPTIME: <span className="text-[var(--gold-primary)]">{uptime}</span></span>;
};

const ZuluClock = () => {
  const [time, setTime] = useState('');
  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      setTime(`ZULU ${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}:${String(now.getUTCSeconds()).padStart(2,'0')}Z`);
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  return <span className="text-[var(--cyan-primary)] font-bold tabular-nums">{time || 'ZULU --:--:--Z'}</span>;
};

/** Real entity count — no fake throughput metrics */
const ActiveEntityCount = ({ data }: { data: Record<string, unknown[]> }) => {
  const count = useMemo(() => {
    if (!data) return 0;
    return Object.values(data).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0);
  }, [data]);
  return <span className="text-[var(--alert-green)] font-bold tabular-nums">{count.toLocaleString()}</span>;
};

/** Extracts a watchable YouTube URL from embed/channel URLs */
function getYouTubeWatchUrl(url: string): string {
  if (url.includes('channel=')) return `https://www.youtube.com/channel/${url.split('channel=')[1].split('&')[0]}/live`;
  if (url.includes('/embed/')) return `https://www.youtube.com/watch?v=${url.split('/embed/')[1].split('?')[0]}`;
  return url;
}

function ViewSegment({ active, onClick, title, icon: Icon, label, layoutId }: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  layoutId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono font-medium tracking-[0.18em] transition-colors duration-200 ${
        active ? 'text-[var(--gold-light)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {active && (
        <motion.span
          layoutId={layoutId}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className="absolute inset-0 rounded-md border border-[var(--border-active)] bg-[var(--gold-primary)]/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_14px_var(--gold-glow)]"
        />
      )}
      <Icon className="w-3.5 h-3.5 relative z-10" />
      <span className="hidden md:inline relative z-10">{label}</span>
    </button>
  );
}

/* /api/news answers with its own `timestamp` and `total`; merged at the root
   they would be overwritten by the next endpoint, so the feed keeps its
   metadata under its own key. */
const newsTransform = (d: { news?: unknown[]; sources?: unknown[]; timestamp?: string }) => ({
  news: d.news,
  news_meta: { sources: d.sources ?? [], fetchedAt: d.timestamp ?? null },
  /* The reports that resolved to a place they name — the Live Alert Pins layer. */
  alert_pins: (d.news ?? []).filter(n => (n as { place?: unknown } | null)?.place),
});

/* Halloween launch-week accents (lib/seasonal) — pumpkin orange. The bright
   shade reads on the app's dark glass; the deeper one keeps the header
   subtitle legible over the light day theme. Applied only to elements whose
   colours are constants today — nothing the Style Studio drives (its CSS
   variables) is read or written by the seasonal touches, so a saved theme
   always wins. */
const SPOOKY_ORANGE = '#FF7518';
const SPOOKY_ORANGE_DAY = '#C2410C';

/* One version label for the splash and the header, which used to disagree. */
const APP_VERSION = 'V5.0';

/* The splash reports what has actually happened. The last stage waits for
   the map's first finished frame instead of a fixed timer. */
const SPLASH_STAGES = ['ESTABLISHING SECURE CONNECTION...', 'INITIALIZING FEEDS...', 'CALIBRATING SENSORS...', 'SYSTEM READY'];
const SPLASH_PROGRESS = ['25%', '50%', '78%', '100%'];

/* The HUD enters as one sequence when the splash lifts. Each piece used to
   run its own fixed timer (2.5–3.5 s), which raced a splash that now lasts
   as long as the map takes to draw. */
const HUD_EASE = [0.22, 1, 0.36, 1] as const;
const hudIn = (delay: number) => ({ duration: 0.7, ease: HUD_EASE, delay });

export default function Dashboard() {
  const dataRef = useRef<any>({});
  const [dataVersion, setDataVersion] = useState(0);
  /* The catalogue's size as state, so controls can show a loading state
     without reading the data ref during render. */
  const [cameraCount, setCameraCount] = useState(0);
  const data = dataRef.current;

  const [backendStatus, setBackendStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [mapView, setMapView] = useState({ zoom: 2.5, latitude: 20, longitude: 0, bearing: 0, pitch: 0 });
  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lng: number; zoom?: number; bearing?: number; pitch?: number; alertId?: string; duration?: number; ts: number } | null>(null);
  /* The Live Alerts the feed's filters leave showing; the map pins those. */
  const [pinnedAlertIds, setPinnedAlertIds] = useState<string[] | null>(null);
  const [globalStats, setGlobalStats] = useState<any>(null);
  const mouseCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const coordsDisplayRef = useRef<HTMLDivElement>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [regionDossier, setRegionDossier] = useState<any>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [splashStage, setSplashStage] = useState(0);
  const [mapReady, setMapReady] = useState(false);

  const revealed = !showSplash;
  /* True once the splash has finished fading out, not merely started to. */
  const [splashGone, setSplashGone] = useState(false);
  /* Opening view — visitor-aware. Precedence (see lib/opening-view):
     shared-view link > remembered last view > IP-located city > El Paso home
     base. The home base is no longer the default; it is the fallback, and the
     Home control. The geo lookup runs in parallel with the splash and is read
     when the opening flight is due — if it has not answered yet, home base
     wins rather than the opening waiting. */
  const lastViewRef = useRef<LastView | null>(null);
  const geoRef = useRef<GeoLocation | null>(null);
  const openingFlownRef = useRef(false);
  const autoLocateCancelled = useRef(false);
  /* A shared view (?lat&lon&zoom&cam… — see lib/share-view): decoded once on
     load, and when present it replaces the home-base opening. The flight is
     applied once the splash has gone; the camera opens when the catalogue
     delivers it. */
  const sharedViewRef = useRef<SharedView | null>(null);
  const sharedViewFlownRef = useRef(false);
  const sharedCamOpenedRef = useRef(false);

  const [activeCamera, setActiveCamera] = useState<any>(null);
  const [spaceWeather, setSpaceWeather] = useState<any>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [showMarkets, setShowMarkets] = useState(false);
  /* The Markets panel is pinned just below the header rather than centred on
     its rail button. Centred, a tall panel (a chart open, a long list) rose
     past the top of the window and took its own header and buttons with it. */
  const marketsAnchor = useRef<HTMLDivElement>(null);
  const [marketsTop, setMarketsTop] = useState(0);
  useLayoutEffect(() => {
    if (!showMarkets) return;
    const place = () => {
      const anchor = marketsAnchor.current?.getBoundingClientRect();
      if (anchor) setMarketsTop(Math.round(64 - anchor.top));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [showMarkets]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showSpaceCam, setShowSpaceCam] = useState(false);
  /* Camera Theater and its lean-back sibling. Full-screen overlays rather
     than rail panels: a wall of cameras is the whole screen or it is nothing. */
  const [showWall, setShowWall] = useState(false);
  const [showAmbient, setShowAmbient] = useState(false);
  const [showTv, setShowTv] = useState(false);
  const [showStations, setShowStations] = useState(false);
  const [showTvWall, setShowTvWall] = useState(false);
  const [tvWallSeed, setTvWallSeed] = useState<{ channels: TvChannel[]; favorites: TvChannel[] }>({ channels: [], favorites: [] });
  const [radioStation, setRadioStation] = useState<RadioStation | null>(null);
  const [showSpotting, setShowSpotting] = useState(false);
  const [showScmPanel, setShowScmPanel] = useState(true);
  const [showDrawing, setShowDrawing] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const [drawProgress, setDrawProgress] = useState<DrawProgress | null>(null);
  const [drawCommand, setDrawCommand] = useState<{ action: 'undo' | 'finish' | 'cancel'; seq: number } | null>(null);
  const sendDraw = useCallback((action: 'undo' | 'finish' | 'cancel') => {
    setDrawCommand(c => ({ action, seq: (c?.seq ?? 0) + 1 }));
  }, []);
  /** AOIs whose contents are being watched for arrivals and departures. */
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [watchEvents, setWatchEvents] = useState<WatchEvent[]>([]);
  const watchBaselines = useRef<Record<string, WatchBaseline>>({});
  const [selectedPolygon, setSelectedPolygon] = useState<string | null>(null);
  const [showDesktopSearch, setShowDesktopSearch] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  // A destination Search hands to Directions ("Directions to here"); its stamp remounts the planner with it.
  const [routeTarget, setRouteTarget] = useState<{ label: string; context?: string; lat: number; lng: number; kind?: string; ts: number } | null>(null);
  const [activeRoute, setActiveRoute] = useState<
    (RouteResult & {
      from: { lat: number; lng: number };
      to: { lat: number; lng: number };
      alternates?: Array<{ type: 'LineString'; coordinates: [number, number][] }>;
      activeSegment?: [number, number][] | null;
    }) | null
  >(null);
  const [liveLocation, setLiveLocation] = useState<LiveLocation | null>(null);
  const [followUser, setFollowUser] = useState(false);
  const [navSession, setNavSession] = useState<
    { route: RouteResult; label: string; key: number; plan: TripPlan } | null
  >(null);
  const [navProgress, setNavProgress] = useState<NavProgress | null>(null);
  const [watchedFlights, setWatchedFlights] = useState<WatchedFlight[]>([]);
  const [aircraftAirports, setAircraftAirports] = useState<Record<string, Airport[]>>({});

  // The popup lives in raw map HTML, so it hands aircraft over through a global.
  useEffect(() => {
    (window as unknown as { osirisWatchFlight?: (f: WatchedFlight) => void }).osirisWatchFlight = (f) => {
      if (!f?.icao24) return;
      setWatchedFlights((prev) =>
        prev.some((w) => w.icao24 === f.icao24) ? prev : [...prev, f].slice(-6));
    };
  }, []);

  const removeWatched = useCallback((icao24: string) => {
    setWatchedFlights((prev) => prev.filter((w) => w.icao24 !== icao24));
    setAircraftAirports((prev) => {
      const next = { ...prev };
      delete next[icao24];
      return next;
    });
  }, []);

  const handleAircraftDetail = useCallback((icao24: string, detail: AircraftDetail | null) => {
    const ports = [detail?.origin, detail?.destination]
      .filter((a): a is Airport => Boolean(a && Number.isFinite(a.lat) && Number.isFinite(a.lng)));
    setAircraftAirports((prev) => (ports.length ? { ...prev, [icao24]: ports } : prev));
  }, []);

  // Telemetry for watched aircraft, refreshed from whatever the feed last gave us.
  const watchTelemetry = useMemo(() => {
    const out: Record<string, FlightTelemetry> = {};
    if (!watchedFlights.length) return out;
    const buckets = [
      data?.commercial_flights, data?.private_flights,
      data?.private_jets, data?.military_flights,
    ];
    const wanted = new Set(watchedFlights.map((w) => w.icao24));
    for (const bucket of buckets) {
      for (const f of bucket || []) {
        if (f?.icao24 && wanted.has(f.icao24)) {
          out[f.icao24] = {
            lat: f.lat, lng: f.lng, alt: f.alt,
            speed_knots: f.speed_knots, heading: f.heading,
            grounded: f.grounded, squawk: f.squawk,
          };
        }
      }
    }
    return out;
  }, [watchedFlights, data]);

  // A navigation session owns its own position watch. The planner's watch dies
  // with the planner when guidance takes over the panel, so guidance cannot
  // depend on it — without this the banner sits on "waiting for a fix" forever.
  useEffect(() => {
    if (!navSession) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setLiveLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
      }),
      () => { /* the view already explains the HTTPS requirement */ },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [navSession]);
  const [showRemote, setShowRemote] = useState(false);
  const [showArcGIS, setShowArcGIS] = useState(false);
  const [arcgisLayers, setArcgisLayers] = useState<Array<{ id: string; title: string; url: string; geojson: any; color: string; visible: boolean; opacity: number }>>([]);
  /* What Live Transit can see right now, for its row in the layer panel. */
  const [transitStatus, setTransitStatus] = useState<TransitStatus | null>(null);
  /* What the flight feed is doing right now, for the counter strip and the
     aviation rows in the layer panel. The feed backs all four aviation rows,
     so while it is loading or retrying, say so under each of them instead of
     leaving the counts blank — a blank bar reads as "aviation is broken". */
  const [flightsStatus, setFlightsStatus] = useState<FlightFeedStatus>('idle');
  const layerLiveStatus = useMemo(() => {
    const status: Record<string, string> = {};
    if (transitStatus) status.transit = transitStatus.text;
    if (flightsStatus === 'loading') {
      status.flights = 'Loading flights…';
      status.private = 'Loading flights…';
      status.jets = 'Loading flights…';
      status.military = 'Loading flights…';
    } else if (flightsStatus === 'error') {
      status.flights = 'Flights unavailable — retrying';
      status.private = 'Flights unavailable — retrying';
      status.jets = 'Flights unavailable — retrying';
      status.military = 'Flights unavailable — retrying';
    }
    return Object.keys(status).length ? status : undefined;
  }, [transitStatus, flightsStatus]);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number; bounds?: { west: number; south: number; east: number; north: number } } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'layers'|'markets'|'intel'|'search'|'remote'|'oi'|'tv'|null>(null);

  // ── OSIRIS OI ── the run lives here, not in the panel, so the globe keeps
  // drawing it while the panel is closed. State goes to the map's OI layer
  // directly rather than through a prop, so the map does not re-render per event.
  const oi = useOi();
  const [showOi, setShowOi] = useState(false);
  const oiAnchor = useRef<HTMLDivElement>(null);
  const [oiTop, setOiTop] = useState(0);
  useLayoutEffect(() => {
    if (!showOi) return;
    const place = () => {
      const anchor = oiAnchor.current?.getBoundingClientRect();
      if (anchor) setOiTop(Math.round(64 - anchor.top));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [showOi]);
  /** What is selected on the globe or in the panel: a point's key, or "link:<id>" for an arc. */
  const [oiSelected, setOiSelected] = useState<string | null>(null);
  const [oiHover, setOiHover] = useState<OiHover | null>(null);
  const [oiFollowing, setOiFollowing] = useState(true);
  const [oiTheater, setOiTheater] = useState(false);
  /** Assist (talk to OI, the default) or Forecast (the swarm). */
  const [oiMode, setOiMode] = useState<OiMode>('assist');
  /** What the full-screen workspace's stage shows. */
  const [oiStage, setOiStage] = useState<Stage>('globe');
  /** Whether the panel was opened from the keyboard, to type straight away. */
  const [oiAutoFocus, setOiAutoFocus] = useState(false);
  // A different run (or none) starts with nothing selected.
  const [oiSelectionRun, setOiSelectionRun] = useState(oi.runId);
  if (oiSelectionRun !== oi.runId) {
    setOiSelectionRun(oi.runId);
    setOiSelected(null);
  }
  const oiGlobe = useRef<OiGlobe | null>(null);
  const oiState = useRef(oi.state);
  const oiSelectedRef = useRef(oiSelected);
  useEffect(() => {
    oiState.current = oi.state;
    oiGlobe.current?.update(oi.state);
  }, [oi.state]);
  useEffect(() => {
    oiSelectedRef.current = oiSelected;
    oiGlobe.current?.select(oiSelected);
  }, [oiSelected]);
  const handleOiGlobe = useCallback((globe: OiGlobe | null) => {
    oiGlobe.current = globe;
    globe?.update(oiState.current);
    globe?.select(oiSelectedRef.current);
  }, []);
  // A click on the globe selects, and opens the panel to show what was clicked; empty map clears.
  const handleOiSelect = useCallback((key: string | null) => {
    setOiSelected(key);
    if (!key) return;
    setOiMode('forecast');
    if (window.matchMedia('(max-width: 767px)').matches) setMobilePanel('oi');
    else setShowOi(true);
  }, []);
  // Going somewhere on purpose takes the camera off the director.
  const handleOiLocate = useCallback((lat: number, lng: number, zoom?: number) => {
    oiGlobe.current?.follow(false);
    setFlyToLocation({ lat, lng, zoom, ts: Date.now() });
  }, []);
  const followOi = useCallback(() => oiGlobe.current?.follow(true), []);
  // Full screen: the workspace's columns sit either side, and the globe stays centred on the stage between.
  const oiTheaterOn = oiTheater;
  const oiHasRun = Boolean(oi.state);
  // On a phone the drawer covers the lower half: the globe, and anywhere OI flies to, centre in the space above it.
  const oiDrawerOpen = mobilePanel === 'oi';
  useEffect(() => {
    if (!oiDrawerOpen) return;
    const drawer = Math.round(Math.min(window.innerHeight * 0.55, window.innerHeight - 100)) + 52;
    oiGlobe.current?.setInsets({ top: 70, bottom: drawer, left: 0, right: 0 });
    return () => oiGlobe.current?.setInsets(null);
  }, [oiDrawerOpen]);
  useEffect(() => {
    const inset = () => oiGlobe.current?.setInsets(oiTheaterOn ? workspaceInsets(window.innerWidth, oiHasRun) : null);
    inset();
    // The app's own HUD (everything marked data-hud) steps back while the workspace has the screen.
    document.documentElement.toggleAttribute('data-oi-theater', oiTheaterOn);
    if (oiTheaterOn) window.addEventListener('resize', inset);
    return () => {
      window.removeEventListener('resize', inset);
      document.documentElement.removeAttribute('data-oi-theater');
    };
  }, [oiTheaterOn, oiHasRun]);
  // A shared link (?oi=<run>) opens the panel on that run, and the camera
  // goes to the run rather than to the visitor's city.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('oi');
    if (!id) return;
    autoLocateCancelled.current = true;
    setOiMode('forecast');
    if (window.matchMedia('(max-width: 767px)').matches) setMobilePanel('oi');
    else setShowOi(true);
    void oi.watch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Once a run is under way the camera is the director's (lib/oi/camera): a late answer about the
  // visitor's city must not fly it away.
  useEffect(() => { if (oi.runId) autoLocateCancelled.current = true; }, [oi.runId]);
  const [mapProjection, setMapProjection] = useState<'globe'|'mercator'>('globe');
  const [terrainFocus, setTerrainFocus] = useState(0);
  const [terrainStatus, setTerrainStatus] = useState<TerrainStatus>('idle');
  const [terrainRetry, setTerrainRetry] = useState(0);
  const [mapStyle, setMapStyle] = useState<'dark'|'satellite'>('dark');
  const [scanTargets, setScanTargets] = useState<any[]>([]);
  const [drawnPolygons, setDrawnPolygons] = useState<DrawnShape[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  /* First run lands on the DAY theme (light chrome, light basemap):
     visitors said the dark landing was hard to navigate. A saved Style
     Studio customisation was composed against the dark look, so when one
     exists the app still opens on CORE and the saved tokens are applied
     over it below — the stored choice wins, untouched. An explicit theme
     choice (the Day/Night toggle, the LayerPanel ghost switch) is stored
     under its own key and beats both defaults, so it survives reloads;
     the Style Studio key is never read or written here. */
  const [osirisTheme, setOsirisTheme] = useState<'core'|'ghost'|'day'>(() => {
    try {
      const chosen = localStorage.getItem('osiris:theme');
      if (chosen === 'day' || chosen === 'core' || chosen === 'ghost') return chosen;
      return loadSavedSettings() ? 'core' : 'day';
    } catch { return 'day'; }
  });

  useEffect(() => {
    document.body.className = osirisTheme === 'core' ? '' : `theme-${osirisTheme}`;
    try { localStorage.setItem('osiris:theme', osirisTheme); } catch { /* private mode */ }
  }, [osirisTheme]);

  /* Halloween launch-week theme: read from the VISITOR's local date (or the
     ?spooky=1 preview) via useSyncExternalStore. The server snapshot is
     always "off", matching the prerendered page byte for byte; the client
     snapshot flips it on right after mount, under the splash, when the
     visitor is in the window. Never persisted — a session-only read. */
  const spooky = useSyncExternalStore(
    () => () => {},
    () => isHalloweenWindow() || hasSpookyPreview(window.location.search),
    () => false,
  );

  /* Style Studio overrides are inline on <body>, so they survive the theme
     swap above and only need reapplying once per load. */
  useEffect(() => {
    const saved = loadSavedSettings();
    if (saved) applySettings(saved);
  }, []);

  const isMobile = useIsMobile();
  const startTime = useRef(Date.now());
  const geocodeCache = useRef<Map<string, string>>(new Map());
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodedPos = useRef<{ lat: number; lng: number } | null>(null);

  // ── DEFAULT: Most layers OFF — fast initial load ──
  const [activeLayers, setActiveLayers] = useState({
    flights: false,
    private: false,
    jets: false,
    military: false,
    maritime: true,
    /* Buses and other transit from operators' GPS feeds — see lib/transit.
       Off until asked for: it is city-scale, and reads feeds only for the view. */
    transit: false,
    // On from the start: the orbiting fleet around the globe is the first
    // thing the splash lifts onto.
    satellites: true,
    sat_comms: false,
    sat_military: false,
    sat_navigation: false,
    sat_earth: false,
    sat_science: false,
    balloons: false,
    cctv: true,
    /* The live preview tiles over the camera dots — see CctvPreviews. */
    cctv_previews: true,
    live_news: true,
    earthquakes: true,
    fires: false,
    weather: false,
    radiation: false,
    infrastructure: false,
    global_incidents: true,
    /* Live Alerts reports pinned to the place they name — see alert-places.
       Off until asked for, like the other threat layers: the map opens with
       what a reader has chosen to see, and the feed reads the same without it. */
    alert_pins: false,
    war_alerts: false,
    day_night: true,
    /* US state boundary outlines (bundled Census-derived GeoJSON) — on,
       because the outlines are how most people read a US map; the toggle
       lives with the other display layers. */
    state_borders: true,
    cables: true,
    sdk_sea: true,
    sdk_air: true,
    sdk_naval: true,
    /* NOAA's infrared cloud mosaic — see lib/live-clouds. Off until asked for:
       it veils everything under it. */
    live_clouds: false,
    /* NOAA GFS wind as moving trails, and RainViewer radar — see lib/wind-layer.
       Off until asked for, like the clouds. */
    wind: false,
    rain: false,
    /* Their time boxes at the bottom left — see WindBar and RainBar. On, so
       turning the layer on brings its controls; off, the layer shows now. */
    wind_controls: true,
    rain_controls: true,
    /* Wind as particles coloured by speed, the classic look, instead of streamlines. */
    wind_particles: false,
    terrain_3d: false,
    terrain_elevation: false,
    malware: false,
    cyber_attacks: false,
    gdelt_events: false,
    cf_outages: false,
    cf_attacks: false,
  });
  // ── OI ASSIST ── the conversation, and the page it works: the camera, the
  // layers, the panels, the live data, and what it marks on the map. It lives
  // here, so closing the panel keeps the conversation and its marks.
  const [oiHighlight, setOiHighlight] = useState<Highlight | null>(null);
  const [oiVoice, setOiVoice] = useState(() => typeof window !== 'undefined' && localStorage.getItem('osiris.oi.voice') === '1');
  const setOiVoicePersist = useCallback((on: boolean) => {
    setOiVoice(on);
    try { localStorage.setItem('osiris.oi.voice', on ? '1' : '0'); } catch { /* storage blocked */ }
    if (!on && typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }, []);
  const assistView = useRef<ReturnType<Site['view']>>({ lat: 20, lng: 0, zoom: 2.5, projection: 'globe', style: 'dark' });
  const assistLayers = useRef<Record<string, boolean>>(activeLayers);
  const assistVoice = useRef(oiVoice);
  const assistOi = useRef(oi);
  useEffect(() => { assistLayers.current = activeLayers; }, [activeLayers]);
  useEffect(() => { assistVoice.current = oiVoice; }, [oiVoice]);
  useEffect(() => { assistOi.current = oi; });
  useEffect(() => {
    assistView.current = { lat: mapCenter?.lat ?? 20, lng: mapCenter?.lng ?? 0, zoom: mapView.zoom, projection: mapProjection, style: mapStyle, bounds: mapCenter?.bounds };
  }, [mapCenter, mapView.zoom, mapProjection, mapStyle]);
  /** A panel the assistant asked for, opened the way its own button opens it. */
  const openFromAssist = useCallback((panel: string) => {
    const phone = window.matchMedia('(max-width: 767px)').matches;
    const right = (show: () => void) => { setShowOi(false); setShowMarkets(false); setShowAlerts(false); setShowSpaceCam(false); show(); };
    if (panel === 'markets') { if (phone) setMobilePanel('markets'); else right(() => setShowMarkets(true)); }
    else if (panel === 'alerts') right(() => setShowAlerts(true));
    else if (panel === 'layers') { if (phone) setMobilePanel('layers'); else setShowLayers(true); }
    else if (panel === 'directions') setShowDirections(true);
    else if (panel === 'forecast' || panel === 'workspace') {
      setOiMode('forecast');
      if (phone) setMobilePanel('oi'); else setShowOi(true);
      if (panel === 'workspace' && assistOi.current.state && !phone) setOiTheater(true);
    }
  }, []);
  const assistTheater = useRef(oiTheater);
  const assistStage = useRef<Stage>(oiStage);
  useEffect(() => { assistTheater.current = oiTheater; }, [oiTheater]);
  useEffect(() => { assistStage.current = oiStage; }, [oiStage]);
  const assistSite = useMemo<Omit<Site, 'forecast'>>(() => ({
    data: () => dataRef.current,
    view: () => assistView.current,
    layers: () => assistLayers.current,
    flyTo: (lat, lng, zoom) => { oiGlobe.current?.follow(false); setFlyToLocation({ lat, lng, zoom, ts: Date.now() }); },
    setLayers: (on, off) => setActiveLayers(prev => {
      const next = { ...prev } as Record<string, boolean>;
      for (const k of on) if (k in next) next[k] = true;
      for (const k of off) if (k in next) next[k] = false;
      return next as typeof prev;
    }),
    highlight: h => setOiHighlight(h),
    openPanel: openFromAssist,
    setView: ({ projection, style }) => {
      if (projection) {
        if (projection === 'mercator') setActiveLayers(prev => ({ ...prev, terrain_elevation: false, terrain_3d: false }));
        setMapProjection(projection);
      }
      if (style) setMapStyle(style);
    },
    workspace: ({ open, view }) => {
      if (window.matchMedia('(max-width: 767px)').matches) return { ok: false, error: 'The full-screen workspace is for larger screens' };
      const run = assistOi.current.state;
      if (view && view !== 'globe' && !run) return { ok: false, error: `The ${view} needs a forecast: start one first` };
      if (open === false) { setOiTheater(false); return { ok: true, summary: 'Closed the workspace' }; }
      setShowOi(true);
      setOiTheater(true);
      if (view) setOiStage(view);
      return { ok: true, summary: `Opened the workspace${view ? ` on the ${view}` : ''}` };
    },
    select: name => {
      const run = assistOi.current.state;
      if (!run) return { ok: false, error: 'There is no forecast to select from' };
      const hit = searchObjects(run, name, 1)[0];
      if (!hit) return { ok: false, error: `Nothing called "${name}" in this forecast` };
      setOiSelected(hit.key);
      return { ok: true, summary: `Opened ${hit.title} (${TYPE_LABEL[hit.type].toLowerCase()})` };
    },
    geocode: async q => {
      try {
        const res = await fetch(`/api/geosearch?q=${encodeURIComponent(q)}`);
        const hit = (await res.json())?.results?.[0];
        return hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng) ? { name: hit.name, lat: hit.lat, lng: hit.lng, kind: hit.kind } : null;
      } catch { return null; }
    },
    // OI looks through the same overlay the reader uses, so its boxes appear in the open viewer.
    camera: async (cam, watch) => {
      setActiveCamera({ ...cam, type: 'cctv' });
      const out = await look(cam, { watch, by: 'oi' });
      return { analysis: out.analysis, watch: out.watch };
    },
  }), [openFromAssist]);
  const assist = useAssist({
    site: assistSite,
    startForecast: async (question, depth, auth) => {
      const id = await assistOi.current.start({ question, seed: '', depth, useFeeds: true }, auth.engine, auth.key);
      return id ? { ok: true, id } : { ok: false, error: 'The forecast did not start: check the key and try again.' };
    },
    forecastSummary: () => {
      const st = assistOi.current.state;
      return st ? {
        question: st.question, status: st.status === 'running' ? st.phaseLabel || 'running' : st.status, answer: currentAnswer(st),
        objects: objectsOf(st).filter(o => o.type === 'actor' || o.type === 'world').map(o => o.title).slice(0, 40),
      } : null;
    },
    ui: () => ({ fullscreen: assistTheater.current, stage: assistStage.current }),
    onReply: text => {
      if (!assistVoice.current || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/^- /gm, '').replace(/\s+/g, ' ').trim());
      u.rate = 1.03;
      window.speechSynthesis.speak(u);
    },
  });

  // Server-side capability flags — gate layers that need credentials.
  const selectFlatMap = () => {
    setActiveLayers(prev => ({ ...prev, terrain_elevation: false, terrain_3d: false }));
    setMapProjection('mercator');
  };
  const terrainPanelProps = {
    terrainStatus,
    on3DModeSelected: () => setMapProjection('globe'),
    onTerrainRetry: () => setTerrainRetry(value => value + 1),
    onTerrainFocus: () => setTerrainFocus(value => value + 1),
  };
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [liveFeedUrl, setLiveFeedUrl] = useState<string | null>(null);
  const [liveFeedName, setLiveFeedName] = useState('');
  const [liveFeedEmbedAllowed, setLiveFeedEmbedAllowed] = useState(true);

  /* Splash: it lifts once the map has drawn its first frame. It never lifts
     before the intro has played (about 2.2 s), and never later than 7 s, so a
     machine that cannot start the map still reaches the platform. In the
     Halloween window the splash is the pumpkin globe's stage, so the
     failsafe stretches to 12 s — otherwise it would cut the spooky stage-3
     hold short on a merely slow load (see the stage-3 effect below). The
     failsafe is read from the same gate expression the `spooky` store
     uses, so this mount-once effect needs no reactive dep for it. */
  useEffect(() => {
    const spookyAtMount = isHalloweenWindow() || hasSpookyPreview(window.location.search);
    const timers = [
      setTimeout(() => setSplashStage(s => Math.max(s, 1)), 1100),
      setTimeout(() => setSplashStage(s => Math.max(s, 2)), 1700),
      setTimeout(() => setShowSplash(false), spookyAtMount ? SPOOKY_SPLASH_FAILSAFE_MS : SPLASH_FAILSAFE_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  useEffect(() => {
    if (!mapReady || splashStage !== 2) return;
    const t = setTimeout(() => setSplashStage(3), 500);
    return () => clearTimeout(t);
  }, [mapReady, splashStage]);
  useEffect(() => {
    if (splashStage !== 3) return;
    // Normally just long enough to read SYSTEM READY. In the Halloween
    // window the splash is the pumpkin's stage: hold it ~4.5 s so the globe
    // can actually be looked at. Tap-to-dismiss (on the splash itself, in
    // the window only) is the escape hatch for repeat visitors.
    const t = setTimeout(() => setShowSplash(false), spooky ? SPOOKY_STAGE3_HOLD_MS : SPLASH_STAGE3_HOLD_MS);
    return () => clearTimeout(t);
  }, [splashStage, spooky]);

  /* IP locate for the opening view: /api/geo answers from the host's geo
     headers (city-level, no permission prompt, nothing stored server-side).
     Fetched on mount, in parallel with the splash, so it never blocks the
     opening. Skipped outright when a remembered view or a shared link already
     decides the opening — no lookup is needed then. */
  useEffect(() => {
    lastViewRef.current = readLastView();
    if (lastViewRef.current) return;
    if (decodeShareView(new URLSearchParams(window.location.search))) return;
    let cancelled = false;
    fetch('/api/geo', { signal: AbortSignal.timeout(8000) })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled) geoRef.current = parseGeoResponse(d);
      })
      .catch(() => {
        /* fall back to home base */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* Opening flight, once the splash has gone. Runs once; the shared-view
     flight below is a separate effect, and a shared link cancels this one at
     decode time. Starting as the splash began to fade meant a busy first load
     (the satellite catalogue is ~19k objects) could hold the fade until the
     camera was nearly at street level, and the globe was never seen. */
  useEffect(() => {
    if (!splashGone || openingFlownRef.current || autoLocateCancelled.current) return;
    openingFlownRef.current = true;
    const target = resolveOpeningTarget({ lastView: lastViewRef.current, geo: geoRef.current });
    setFlyToLocation({ lat: target.lat, lng: target.lng, zoom: target.zoom, duration: 3500, ts: Date.now() });
  }, [splashGone]);

  /* Remember the last settled view, so return visits open where the visitor
     left off. mapView only changes on moveend, so mid-flight states never
     reach storage; the zoom guard keeps the initial globe view (zoom 2.5)
     out, and the splash guard keeps the opening flight's own start out. */
  const lastViewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!splashGone) return;
    const { latitude, longitude, zoom } = mapView;
    if (zoom <= 3 || !isValidLatLon(latitude, longitude)) return;
    if (lastViewTimer.current) clearTimeout(lastViewTimer.current);
    lastViewTimer.current = setTimeout(() => {
      writeLastView({ lat: latitude, lng: longitude, zoom });
    }, 1500);
    return () => {
      if (lastViewTimer.current) clearTimeout(lastViewTimer.current);
    };
  }, [mapView, splashGone]);

  /* View history (the Back button): record settled views so Back can walk
     back through them — roulette jumps, camera opens, search flights, preset
     jumps, and the opening view itself, which is the stack's base. mapView
     only changes on moveend, so mid-flight states never reach the stack; the
     zoom guard keeps the initial globe view out, and the splash guard keeps
     the opening flight's own start out. In-memory only — last-view
     persistence already covers return visits. */
  const [viewHistory] = useState(() => createViewHistory());
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => {
    if (!splashGone) return;
    const { latitude, longitude, zoom, bearing, pitch } = mapView;
    if (zoom <= 3 || !isValidLatLon(latitude, longitude)) return;
    setCanGoBack(viewHistory.record({ lat: latitude, lng: longitude, zoom, bearing, pitch }));
  }, [mapView, splashGone, viewHistory]);

  /* Back: fly to the previous view with the same mechanism as every other
     flight. The popped entry becomes current at once, so the settled view
     at the end of this flight dedupes against it and is never re-recorded. */
  const goBackView = useCallback(() => {
    const target = viewHistory.goBack();
    if (!target) return;
    setCanGoBack(viewHistory.canGoBack());
    setFlyToLocation({ lat: target.lat, lng: target.lng, zoom: target.zoom, bearing: target.bearing, pitch: target.pitch, duration: 2500, ts: Date.now() });
  }, [viewHistory]);

  /* Shared view: once the splash has gone, fly to what the link names —
     centre, zoom and camera angle — instead of home base. Runs once; the
     decode above already cancelled the home flight. */
  useEffect(() => {
    const view = sharedViewRef.current;
    if (!splashGone || !view || sharedViewFlownRef.current) return;
    sharedViewFlownRef.current = true;
    oiGlobe.current?.follow(false);
    if (view.cameraId) setActiveLayers(prev => (prev.cctv ? prev : { ...prev, cctv: true }));
    setFlyToLocation({
      lat: view.lat, lng: view.lng, zoom: view.zoom ?? 9,
      bearing: view.bearing, pitch: view.pitch,
      duration: 2600, ts: Date.now(),
    });
  }, [splashGone]);

  /* Shared view: open the link's camera when the catalogue delivers it.
     A camera the catalogue never brings simply never opens — the restored
     view is the link's main promise, and it has already been kept. */
  useEffect(() => {
    const view = sharedViewRef.current;
    if (!view?.cameraId || sharedCamOpenedRef.current) return;
    const catalog = (dataRef.current.cameras ?? []) as Array<{ id: string | number }>;
    const cam = catalog.find(c => String(c.id) === view.cameraId);
    if (!cam) return;
    sharedCamOpenedRef.current = true;
    setActiveCamera({ ...cam, type: 'cctv' });
  }, [dataVersion]);

  // On mount: restore layers and probe optional feeds
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Restore active layers from URL if present
    const p = new URLSearchParams(window.location.search);

    // A shared view in the address replaces the home-base opening: decode it
    // now (garbage decodes to null and the opening proceeds as always) and
    // cancel the fly-home before it can be scheduled.
    const shared = decodeShareView(p);
    if (shared) {
      sharedViewRef.current = shared;
      autoLocateCancelled.current = true;
    }

    const layers = p.get('layers');
    if (layers) {
      const active = layers.split(',');
      // The weather time boxes came after these links. A link with no
      // *_controls at all is from before them: the boxes stay on, as by default.
      const older = !active.some(a => a.endsWith('_controls'));
      const boxOn = (k: string) => older && (k === 'wind_controls' || k === 'rain_controls');
      setActiveLayers(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { (next as any)[k] = active.includes(k) || boxOn(k); });
        return next;
      });
    }

    // Probe which credential-gated feeds this deployment has configured, so the
    // layer panel can hide toggles that could never return data.
    fetch('/api/cloudflare-radar?probe=1')
      .then(r => (r.ok ? r.json() : null))
      .then(p => { if (p) setCapabilities(c => ({ ...c, cloudflare: !!p.configured })); })
      .catch(() => { /* leave the layer hidden */ });

    // Once the user interacts, the opening fly-in must not steal the camera
    // back: the first pointer or key press cancels it.
    const cancelAutoLocate = () => { autoLocateCancelled.current = true; };
    window.addEventListener('pointerdown', cancelAutoLocate, { once: true });
    window.addEventListener('keydown', cancelAutoLocate, { once: true });
    return () => {
      window.removeEventListener('pointerdown', cancelAutoLocate);
      window.removeEventListener('keydown', cancelAutoLocate);
    };
  }, []);

  // URL state: persist active layers only (the opening view lives in localStorage, not the address)
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const active = Object.entries(activeLayers).filter(([,v]) => v).map(([k]) => k).join(',');
      // A forecast being watched keeps its place in the address, so the address bar stays shareable.
      const oiRun = new URLSearchParams(window.location.search).get('oi');
      const url = `${window.location.pathname}?layers=${active}${oiRun ? `&oi=${encodeURIComponent(oiRun)}` : ''}`;
      window.history.replaceState(null, '', url);
    }, 1500);
  }, [activeLayers]);

  // OI focus: clear the globe of the other layers while a forecast draws,
  // and put back exactly what was on when focus ends.
  const [oiFocus, setOiFocus] = useState(false);
  const focusSaved = useRef<typeof activeLayers | null>(null);
  const toggleOiFocus = useCallback(() => {
    const saved = focusSaved.current;
    if (saved) {
      focusSaved.current = null;
      setActiveLayers(saved);
      setOiFocus(false);
      return;
    }
    const KEEP = new Set(['day_night', 'live_clouds', 'wind', 'wind_controls', 'wind_particles', 'rain', 'rain_controls', 'terrain_3d', 'terrain_elevation']);
    setActiveLayers(prev => {
      focusSaved.current = prev;
      return Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, KEEP.has(k) ? v : false])) as typeof prev;
    });
    setOiFocus(true);
  }, []);

  // Global Stats Fetch
  useEffect(() => {
    fetch('/api/stats')
      .then(res => res.json())
      .then(d => {
        if (d.stats) setGlobalStats(d.stats);
      })
      .catch(console.error);
  }, []);

  /** From Search: open Directions with this place as the destination, and show where it is. */
  const openDirectionsTo = useCallback((p: { label: string; context?: string; lat: number; lng: number; kind?: string }) => {
    setRouteTarget({ ...p, ts: Date.now() });
    setActiveRoute(null);
    setShowDesktopSearch(false);
    setMobilePanel(null);
    setShowDirections(true);
    setFlyToLocation({ lat: p.lat, lng: p.lng, zoom: 14, ts: Date.now() });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as Element)?.tagName)) return;
      if (e.key === 'f' && !e.ctrlKey) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      }
      if (e.key === 'o' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setOiMode('assist');
        setOiAutoFocus(true);
        if (window.matchMedia('(max-width: 767px)').matches) setMobilePanel('oi');
        else { setShowOi(true); setShowMarkets(false); setShowAlerts(false); setShowSpaceCam(false); }
      }
      if (e.key === 'l') setShowLayers(p => !p);
      if (e.key === 'm') setShowMarkets(p => !p);
      if (e.key === 'c') setShowScmPanel(p => !p);
      if (e.key === 's') { setShowDesktopSearch(p => !p); setShowMarkets(false); setShowAlerts(false); setShowSpaceCam(false); }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) setFlyToLocation({ lat: 20, lng: 0, zoom: 2.5, ts: Date.now() });
      if (e.key === 'g') {
        setActiveLayers(prev => ({ ...prev, terrain_elevation: false, terrain_3d: false }));
        setMapProjection(p => p === 'globe' ? 'mercator' : 'globe');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowDesktopSearch(true); setShowMarkets(false); setShowAlerts(false); setShowSpaceCam(false);
      }
    };
    const fsHandler = () => setIsFullscreen(!!document.fullscreenElement);
    window.addEventListener('keydown', handler);
    document.addEventListener('fullscreenchange', fsHandler);
    return () => { window.removeEventListener('keydown', handler); document.removeEventListener('fullscreenchange', fsHandler); };
  }, []);

  // Mouse coords + reverse geocode (Zero-Render)
  const handleMouseCoords = useCallback((coords: { lat: number; lng: number }) => {
    mouseCoordsRef.current = coords;
    if (coordsDisplayRef.current) {
      coordsDisplayRef.current.innerText = `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
    }
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(async () => {
      if (lastGeocodedPos.current) {
        const d = Math.abs(coords.lat - lastGeocodedPos.current.lat) + Math.abs(coords.lng - lastGeocodedPos.current.lng);
        if (d < 0.5) return; // increased threshold — fewer geocode calls
      }
      const gk = `${coords.lat.toFixed(1)},${coords.lng.toFixed(1)}`; // coarser grid = more cache hits
      if (geocodeCache.current.has(gk)) { setLocationLabel(geocodeCache.current.get(gk)!); lastGeocodedPos.current = coords; return; }
      try {
        /* Our own route, not Nominatim directly: it rounds the coordinate,
           caches the answer for everyone, and holds the app's request budget
           for the service — see lib/nominatim.ts. */
        const res = await fetch(`/api/geo/reverse?lat=${coords.lat}&lng=${coords.lng}`);
        if (res.ok) {
          const d = await res.json();
          const label = d.label || 'Unknown';
          if (geocodeCache.current.size > 500) { const it = geocodeCache.current.keys(); for (let i=0;i<100;i++) { const k = it.next().value; if(k) geocodeCache.current.delete(k); }}
          geocodeCache.current.set(gk, label);
          setLocationLabel(label);
          lastGeocodedPos.current = coords;
        }
      } catch (e) { console.warn('[OSIRIS] Suppressed error:', e instanceof Error ? e.message : e); }
    }, 3000); // 3s debounce (was 1.5s)
  }, []);

  // Region dossier (double right-click)
  const handleRightClick = useCallback(async (coords: { lat: number; lng: number }) => {
    setDossierLoading(true); setRegionDossier(null);
    try {
      const res = await fetch(`/api/region-dossier?lat=${coords.lat}&lng=${coords.lng}`);
      if (res.ok) setRegionDossier(await res.json());
    } catch (e) { console.warn('[OSIRIS] Suppressed error:', e instanceof Error ? e.message : e); } finally { setDossierLoading(false); }
  }, []);
  // Entity click handler (hoisted from JSX to comply with Rules of Hooks - Fixes #113)
  const handleEntityClick = useCallback((entity: any) => {
    if (entity?.type === 'cctv') setActiveCamera(entity);
    if (entity?.type === 'live_news' && entity.url) {
      setLiveFeedUrl(entity.url);
      setLiveFeedName(entity.name);
      setLiveFeedEmbedAllowed(entity.embed_allowed !== false);
    }
  }, []);

  // ── "TAKE ME SOMEWHERE LIVE" — the camera roulette ──
  // One tap: a random playable camera somewhere on Earth (the draw itself is
  // lib/theater-wall's pickRouletteCamera), flown to and opened in the viewer.
  // Tapping again while a camera is open excludes that camera, so the spin
  // always lands somewhere new.
  const roulettePending = useRef(false);
  const takeMeSomewhereLive = useCallback(() => {
    const cameras = (dataRef.current.cameras ?? []) as WallCamera[];
    const open = activeCamera?.type === 'cctv' ? activeCamera : null;
    const currentId = open && open.id != null && open.id !== '' ? String(open.id) : null;
    const pick = pickRouletteCamera(cameras, currentId);
    if (!pick) {
      /* Nothing landable yet — the catalogue is still loading, or CCTV is off
         so it never started. Turning the layer on is what loads it; remember
         the ask and the spin completes itself when the first cameras land. */
      roulettePending.current = true;
      setActiveLayers(prev => (prev.cctv ? prev : { ...prev, cctv: true }));
      return;
    }
    oiGlobe.current?.follow(false);
    setActiveLayers(prev => (prev.cctv ? prev : { ...prev, cctv: true }));
    setFlyToLocation({ lat: Number(pick.lat), lng: Number(pick.lng), zoom: 13, duration: 2400, ts: Date.now() });
    setActiveCamera({ ...pick, type: 'cctv' });
  }, [activeCamera]);

  /* The roulette control's state, shared by the desktop strip button and the
     mobile floating button: always the dice icon, visibly dimmed with a small
     loading badge while the camera catalogue is still loading. */
  const roulette = rouletteControlState(cameraCount);

  /* A spin asked for while the catalogue was still loading completes itself
     when the first batch lands. */
  useEffect(() => {
    if (!roulettePending.current) return;
    if (!((dataRef.current.cameras?.length ?? 0) > 0)) return;
    roulettePending.current = false;
    takeMeSomewhereLive();
  }, [dataVersion, takeMeSomewhereLive]);

  // ── Drawing / AOI ──
  // OsirisMap already owns the draw interaction and the polygon rendering;
  // this only turns a finished ring into a measured, named, coloured record.
  // Restore drawn areas on load. Work that vanishes on refresh is work the
  // operator will not trust the tool with.
  useEffect(() => {
    try {
      const restored = deserializeShapes(localStorage.getItem(STORAGE_KEY));
      if (restored.length) setDrawnPolygons(restored);
    } catch { /* storage unavailable — start empty */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, serializeShapes(drawnPolygons)); } catch { /* quota or private mode */ }
  }, [drawnPolygons]);

  // ── Tripwires ──
  // Re-sweep every watched AOI whenever live data refreshes and record what
  // changed. Keyed off dataVersion rather than `data` so this runs once per
  // refresh instead of once per render.
  useEffect(() => {
    if (watched.size === 0) return;
    const now = Date.now();
    const fresh: WatchEvent[] = [];
    for (const shape of drawnPolygons) {
      if (!watched.has(shape.id)) continue;
      const ring = queryRing(shape);
      if (!ring) continue;
      const report = selectInPolygon(ring, dataRef.current as any);
      const prev = watchBaselines.current[shape.id] ?? null;
      const { baseline, events } = diffSweep(shape.id, report, prev, now);
      watchBaselines.current[shape.id] = baseline;
      fresh.push(...events);
    }
    if (fresh.length) setWatchEvents(log => appendEvents(log, fresh));
  }, [dataVersion, watched, drawnPolygons]);

  const toggleWatch = useCallback((id: string) => {
    setWatched(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // Drop the baseline too, so re-arming starts clean rather than
        // reporting everything that moved while the watch was off.
        delete watchBaselines.current[id];
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleDrawComplete = useCallback((result: DrawResult) => {
    setDrawnPolygons(prev => [toShape(result, prev, prev.length), ...prev]);
    // One shape per arming: staying armed after a finish is how you end up
    // with an accidental second AOI from the click that dismisses the first.
    setDrawMode(null);
    setDrawProgress(null);
  }, []);

  const handleExportGeoJSON = useCallback(() => {
    downloadFile(
      `osiris-aoi-${new Date().toISOString().slice(0, 10)}.geojson`,
      JSON.stringify(shapesToGeoJSON(drawnPolygons), null, 2),
      'application/geo+json',
    );
  }, [drawnPolygons]);

  // ── SHARED FETCH UTILITY (Fixes #107 — single definition, not 3 copies) ──
  /* `skipWhenHidden` is for background polling only — skipping a *user-initiated*
     load (a layer toggle, or first paint in a background tab) leaves the caller
     believing it fetched, so the layer stays empty until a full reload.
     Returns whether data actually landed, so callers can retry. */
  const fetchEndpoint = useCallback(async (
    url: string,
    transform?: (d: any) => any,
    options?: RequestInit,
    { skipWhenHidden = false }: { skipWhenHidden?: boolean } = {},
  ): Promise<boolean> => {
    if (skipWhenHidden && typeof document !== 'undefined' && document.hidden) return false;
    try {
      // Force the browser to bypass its local disk cache for real-time data
      const res = await fetch(url, { ...options, cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        const d = transform ? transform(json) : json;
        dataRef.current = { ...dataRef.current, ...d };
        setDataVersion(v => v + 1);
        setBackendStatus('connected');
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[OSIRIS] Suppressed error:', e instanceof Error ? e.message : e);
      setBackendStatus('error');
      return false;
    }
  }, []);

  // ── PROGRESSIVE DATA LOADING (request-optimized) ──
  useEffect(() => {
    // Priority 1: Core feeds (always needed for panels)
    const eqUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
    const eqTransform = (data: any) => ({ earthquakes: (data.features || []).map((f: any) => ({ id: f.id, lat: f.geometry?.coordinates?.[1] || 0, lng: f.geometry?.coordinates?.[0] || 0, depth: f.geometry?.coordinates?.[2] || 0, magnitude: f.properties?.mag, place: f.properties?.place, time: f.properties?.time, url: f.properties?.url, tsunami: f.properties?.tsunami, type: f.properties?.type, felt: f.properties?.felt, alert: f.properties?.alert })) });
    fetchEndpoint(eqUrl, eqTransform);
    fetchEndpoint('/api/news', newsTransform);
    /* Official warnings — NOAA/NWS, GDACS, NASA EONET. A core feed rather than
       a layer fetch: Live Alerts lists them whether or not the weather layer
       is on, and this is the one thing in the panel a reader may have to act on. */
    fetchEndpoint('/api/weather', d => ({ weather_events: d.events }));
    layerFetchedRef.current.add('weather');
    /* A cold start can time out every upstream quote and return an all-empty
       feed. Waiting a full poll interval to find out leaves the panel blank for
       15 minutes, so retry a few times up-front until instruments actually land. */
    const marketRetries: ReturnType<typeof setTimeout>[] = [];
    const loadMarkets = async (attempt = 0) => {
      await fetchEndpoint('/api/markets', d => ({ markets: d }));
      if ((dataRef.current.markets?.count || 0) === 0 && attempt < 3) {
        marketRetries.push(setTimeout(() => loadMarkets(attempt + 1), 15000));
      }
    };
    const marketTimer = setTimeout(() => loadMarkets(), 800);

    // Priority 2: Space Weather (needed for MarketsPanel)
    const spaceTimer = setTimeout(async () => {
      try {
        const r = await fetch('/api/space-weather');
        if (r.ok) setSpaceWeather(await r.json());
      } catch (e) { console.warn('[OSIRIS] Suppressed error:', e instanceof Error ? e.message : e); }
    }, 5000);

    // Polling — OPTIMIZED intervals to minimize edge requests
    const intervals = [
      setInterval(() => fetchEndpoint(eqUrl, eqTransform, undefined, { skipWhenHidden: true }), 900000),  // 15 min (was 5)
      // 5 min: the route caches each wire for 5, so a source sees at most one read per window however many tabs poll.
      setInterval(() => fetchEndpoint('/api/news', newsTransform, undefined, { skipWhenHidden: true }), 300000),
      // 5 min: a warning that has just been issued is the point of the panel.
      setInterval(() => fetchEndpoint('/api/weather', d => ({ weather_events: d.events }), undefined, { skipWhenHidden: true }), 300000),
      setInterval(() => fetchEndpoint('/api/markets', d => ({ markets: d }), undefined, { skipWhenHidden: true }), 900000), // 15 min (was 5)
    ];
    return () => {
      clearTimeout(marketTimer);
      marketRetries.forEach(clearTimeout);
      clearTimeout(spaceTimer);
      intervals.forEach(clearInterval);
    };
  }, [fetchEndpoint]);

  // ── LAYER-AWARE DATA LOADING — only fetch when layer is toggled ON ──
  const layerFetchedRef = useRef<Set<string>>(new Set());
  // ── FLIGHTS LOADING — fetched only on success, retried on failure ──
  /* The old code marked 'flights' fetched synchronously before the request
     finished, so one failed first attempt left the layer empty until the
     5-minute poll — and the counter strip hid AIR entirely, which reads as
     "aviation is broken". This loader marks the layer only when data lands,
     retries a failed attempt on a short backoff, and keeps the flight status
     honest for the strip and the Layers panel. A stale snapshot or a first
     wave is shown at once, then re-fetched soon for the full picture. */
  const flightsInFlightRef = useRef(false);
  const flightsRetryPendingRef = useRef(false);
  const flightsTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const flightsRefetchCountRef = useRef(0);
  const loadFlights = useCallback(function loadFlightsInner(attempt = 0): void {
    if (flightsInFlightRef.current || flightsRetryPendingRef.current) return;
    /* Timers self-cancel when the aviation layers go off again. */
    const av = assistLayers.current;
    if (!av || !(av.flights || av.military || av.jets || av.private)) return;
    const d = dataRef.current;
    if (hasFlightData(d) && !isStaleFlightPayload(d) && !isPartialFlightPayload(d)) {
      layerFetchedRef.current.add('flights');
      flightsRefetchCountRef.current = 0;
      setFlightsStatus('ready');
      return;
    }
    flightsInFlightRef.current = true;
    setFlightsStatus('loading');
    fetchEndpoint('/api/flights', normalizeFlightPayload).then(ok => {
      flightsInFlightRef.current = false;
      /* The layers went off mid-flight: the data still merged, but the
         status goes back to idle instead of reporting on a layer nobody
         is watching. (Set here, in the promise callback — not in an effect.) */
      const layersNow = assistLayers.current;
      const stillWanted = Boolean(layersNow && (layersNow.flights || layersNow.military || layersNow.jets || layersNow.private));
      if (!stillWanted) {
        setFlightsStatus('idle');
        return;
      }
      if (ok) {
        layerFetchedRef.current.add('flights');
        const landed = dataRef.current;
        if (isStaleFlightPayload(landed) || isPartialFlightPayload(landed)) {
          /* A snapshot or a first wave: show what we have, then come back
             soon for the full picture. Bounded — the 5-minute poll is the
             backstop after that. */
          if (flightsRefetchCountRef.current < FLIGHT_STALE_REFETCH_ATTEMPTS) {
            flightsRefetchCountRef.current += 1;
            flightsTimersRef.current.push(setTimeout(() => loadFlightsInner(), FLIGHT_STALE_REFETCH_MS));
            setFlightsStatus('loading');
          } else {
            flightsRefetchCountRef.current = 0;
            setFlightsStatus('ready');
          }
        } else {
          flightsRefetchCountRef.current = 0;
          setFlightsStatus('ready');
        }
        return;
      }
      const delay = nextFlightRetryDelay(attempt);
      setFlightsStatus('error');
      if (delay != null) {
        flightsRetryPendingRef.current = true;
        flightsTimersRef.current.push(setTimeout(() => {
          flightsRetryPendingRef.current = false;
          loadFlightsInner(attempt + 1);
        }, delay));
      }
    });
  }, [fetchEndpoint]);
  useEffect(() => {
    if (!activeLayers.cctv) return;
    return loadCameraCatalog(cameras => {
      dataRef.current = {
        ...dataRef.current,
        cameras: mergeCameraCatalog(dataRef.current.cameras ?? [], cameras),
      };
      setCameraCount(dataRef.current.cameras?.length ?? 0);
      setDataVersion(value => value + 1);
      setBackendStatus('connected');
    }, () => console.warn('[OSIRIS] Camera catalogue load failed; bounded retry scheduled'));
  }, [activeLayers.cctv]);

  useEffect(() => {

    // Flights — fetched only when data actually lands. loadFlights releases
    // the fetched mark on failure and retries with backoff, so a failed
    // first attempt no longer leaves the layer empty until the 5-minute poll.
    if (activeLayers.flights || activeLayers.military || activeLayers.jets || activeLayers.private) {
      loadFlights();
    } else {
      flightsTimersRef.current.forEach(clearTimeout);
      flightsTimersRef.current = [];
      flightsRetryPendingRef.current = false;
      flightsRefetchCountRef.current = 0;
    }
    // Satellites (any satellite sub-layer triggers fetch)
    const anySatLayer = activeLayers.satellites || activeLayers.sat_comms || activeLayers.sat_military || activeLayers.sat_navigation || activeLayers.sat_earth || activeLayers.sat_science;
    if (anySatLayer && !layerFetchedRef.current.has('satellites')) {
      // Keep the moment the positions were propagated for. The catalogue is
      // fetched once and never re-polled, so by the time an orbit is requested
      // these markers can be a long way out of date — the orbit route needs the
      // marker's epoch to draw a track that still passes through it.
      fetchEndpoint('/api/satellites', d => ({ ...d, satellites_at: d.timestamp }));
      layerFetchedRef.current.add('satellites');
    }
    // Fires
    if (activeLayers.fires && !layerFetchedRef.current.has('fires')) {
      fetchEndpoint('/api/fires');
      layerFetchedRef.current.add('fires');
    }
    // Maritime
    if (activeLayers.maritime && !layerFetchedRef.current.has('maritime')) {
      fetchEndpoint('/api/maritime', d => ({ maritime_ports: d.ports, maritime_chokepoints: d.chokepoints, maritime_ships: d.ships }));
      layerFetchedRef.current.add('maritime');
    }
    // Balloons
    if (activeLayers.balloons && !layerFetchedRef.current.has('balloons')) {
      fetchEndpoint('/api/balloons', d => ({ balloons: d.balloons }));
      layerFetchedRef.current.add('balloons');
    }
    // Radiation
    if (activeLayers.radiation && !layerFetchedRef.current.has('radiation')) {
      fetchEndpoint('/api/radiation', d => ({ radiation: d.stations }));
      layerFetchedRef.current.add('radiation');
    }
    // Live News (+ the FAST services the TV panel launches)
    if (activeLayers.live_news && !layerFetchedRef.current.has('live_news')) {
      fetchEndpoint('/api/live-news', d => ({ live_feeds: d.feeds, tv_services: d.services ?? [] }));
      layerFetchedRef.current.add('live_news');
    }
    // Weather
    if (activeLayers.weather && !layerFetchedRef.current.has('weather')) {
      fetchEndpoint('/api/weather', d => ({ weather_events: d.events }));
      layerFetchedRef.current.add('weather');
    }
    // Infrastructure
    if (activeLayers.infrastructure && !layerFetchedRef.current.has('infrastructure')) {
      fetchEndpoint('/api/infrastructure', d => ({ infrastructure: d.infrastructure }));
      layerFetchedRef.current.add('infrastructure');
    }
    // Global Incidents (GDELT)
    if (activeLayers.global_incidents && !layerFetchedRef.current.has('gdelt')) {
      fetchEndpoint('/api/gdelt', d => ({ gdelt: d.events }));
      layerFetchedRef.current.add('gdelt');
    }

    // Submarine Cables
    if (activeLayers.cables && !layerFetchedRef.current.has('cables')) {
      (async () => {
        try {
          const ts = Date.now();
      const res = await fetch(`/data/submarine-cables.json?v=${ts}`);
          if (res.ok) {
             const cablesData = await res.json();
             dataRef.current = { ...dataRef.current, submarine_cables: cablesData.features };
             setDataVersion(v => v + 1);
          }
        } catch (e) { console.warn('Cables fetch failed'); }
      })();
      layerFetchedRef.current.add('cables');
    }


    // Live Malware (abuse.ch) is pushed, not fetched — see the SSE subscription below.

    // Botnet C2 infrastructure (abuse.ch Feodo Tracker blocklist)
    if ((activeLayers as any).cyber_attacks && !layerFetchedRef.current.has('cyber_attacks')) {
      fetchEndpoint('/api/cyber-attacks', d => ({ cyber_attacks: d.indicators }));
      layerFetchedRef.current.add('cyber_attacks');
    }

    /* Mark before awaiting so a re-render mid-flight cannot double-fetch, then
       release the mark if nothing landed — otherwise one failed request leaves
       the layer permanently empty. */
    const loadLayerOnce = (key: string, url: string, transform: (d: any) => any) => {
      if (layerFetchedRef.current.has(key)) return;
      layerFetchedRef.current.add(key);
      fetchEndpoint(url, transform).then(ok => {
        if (!ok) layerFetchedRef.current.delete(key);
      });
    };

    // GDELT 2.0 geocoded events
    if ((activeLayers as any).gdelt_events) {
      loadLayerOnce('gdelt_events', '/api/gdelt-events?limit=600', d => ({ gdelt_events: d.events }));
    }

    // Cloudflare Radar — one request backs both layers
    if ((activeLayers as any).cf_outages || (activeLayers as any).cf_attacks) {
      loadLayerOnce('cloudflare_radar', '/api/cloudflare-radar', d => ({
        cf_outages: d.outages ?? [],
        cf_attack_origins: d.attack_origins ?? [],
      }));
    }


  }, [activeLayers, loadFlights]);

  // ── LAYER-AWARE POLLING — only poll data for active layers ──
  useEffect(() => {
    const intervals: ReturnType<typeof setInterval>[] = [];
    const stopFns: (() => void)[] = [];
    if (activeLayers.flights || activeLayers.military || activeLayers.jets || activeLayers.private) {
      intervals.push(setInterval(() => {
        fetchEndpoint('/api/flights', normalizeFlightPayload).then(ok => {
          if (!ok) return;
          layerFetchedRef.current.add('flights');
          const d = dataRef.current;
          setFlightsStatus(isStaleFlightPayload(d) || isPartialFlightPayload(d) ? 'loading' : 'ready');
        });
      }, 300000)); // 5 min (was 2 min)
    }

    if (activeLayers.balloons) {
      intervals.push(setInterval(() => fetchEndpoint('/api/balloons', d => ({ balloons: d.balloons })), 300000)); // 5m
    }
    if (activeLayers.radiation) {
      intervals.push(setInterval(() => fetchEndpoint('/api/radiation', d => ({ radiation: d.stations })), 300000)); // 5m
    }
    if (activeLayers.maritime) {
      /* Ten seconds is the cadence a moving vessel needs. The other two thirds
         of this payload — 52 ports and 10 chokepoints — are constants in the
         route, and their congestion is derived from those vessels, so with no
         AIS feed the reply is byte-identical poll after poll: 360 requests an
         hour, per reader, for a fixed document. So the fast rate is earned by
         actually carrying vessels, and otherwise falls back to the five
         minutes every other layer here uses. Rescheduled rather than fixed,
         because the count is read from a ref that no re-render announces. */
      let vesselTimer: ReturnType<typeof setTimeout>;
      let stopped = false;
      const vesselGapMs = () => ((dataRef.current.maritime_ships?.length ?? 0) > 0 ? 10_000 : 300_000);
      const pollMaritime = () => {
        if (stopped) return;
        fetchEndpoint('/api/maritime', d => ({ maritime_ports: d.ports, maritime_chokepoints: d.chokepoints, maritime_ships: d.ships }));
        vesselTimer = setTimeout(pollMaritime, vesselGapMs());
      };
      vesselTimer = setTimeout(pollMaritime, vesselGapMs());
      stopFns.push(() => { stopped = true; clearTimeout(vesselTimer); });
    }
    if ((activeLayers as any).cyber_attacks) {
      intervals.push(setInterval(() => {
        layerFetchedRef.current.delete('cyber_attacks');
        fetchEndpoint('/api/cyber-attacks', d => ({ cyber_attacks: d.indicators }));
        layerFetchedRef.current.add('cyber_attacks');
      }, 300000)); // 5m — a blocklist turns over in hours, not seconds
    }
    return () => { intervals.forEach(clearInterval); stopFns.forEach(stop => stop()); };
  }, [activeLayers, fetchEndpoint]);

  /* ── LIVE MALWARE — pushed over SSE while the layer is on ──
     Detections arrive when URLhaus reports them rather than on a timer, so
     there is no poll interval to tune and no request that re-downloads the
     same rows to discover nothing changed. The connection also carries the
     progressive geolocation fill, which is why a cold server paints the map in
     batches instead of staying empty and then snapping to full. */
  useEffect(() => {
    if (!activeLayers.malware) return;

    const source = new EventSource('/api/malware/stream');
    // Keyed by address: a host re-reported with a new payload updates its node
    // rather than stacking a second dot on the same coordinates.
    const byIp = new Map<string, LiveDetection>();
    // The server sends `status` at the end of every poll, so the first one
    // marks the end of the initial fill — anything after it is genuinely new
    // and worth drawing attention to.
    let filled = false;

    const commit = () => {
      dataRef.current = { ...dataRef.current, malware_threats: [...byIp.values()] };
      setDataVersion(v => v + 1);
    };

    source.onmessage = ev => {
      try {
        const event = JSON.parse(ev.data);
        if (event.type === 'snapshot') {
          byIp.clear();
          for (const d of event.detections) byIp.set(d.ip, d);
          commit();
        } else if (event.type === 'detections') {
          // Only a first sighting is an arrival. An existing host that served
          // another payload arrives with fresh:false and keeps whatever beacon
          // state it already had, so it does not re-flag itself as new.
          const beacon = filled && event.fresh;
          for (const d of event.detections) {
            byIp.set(d.ip, beacon ? { ...d, detected_at: Date.now() } : { ...d, detected_at: byIp.get(d.ip)?.detected_at });
          }
          commit();
        } else if (event.type === 'status') {
          filled = true;
          // Hosts that have gone dark since the last poll. The store prunes
          // these; without mirroring it here the map would only ever grow.
          if (event.retired?.length) {
            for (const ip of event.retired) byIp.delete(ip);
            commit();
          }
        }
        setBackendStatus('connected');
      } catch {
        // One malformed frame must not tear down the subscription.
      }
    };

    /* EventSource reconnects on its own, firing `error` on each attempt, and
       the store replays a snapshot on connect so a drop self-heals. Only a
       readyState of CLOSED means it has given up — reporting the transient
       ones would flag the backend as down every time a connection recycles. */
    source.onopen = () => setBackendStatus('connected');
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setBackendStatus('error');
    };

    return () => source.close();
  }, [activeLayers.malware]);

  // CCTV: loaded once on layer toggle via layerFetchedRef (no viewport polling)

  // Reactive layer fetch: handled by layerFetchedRef above (no duplicate)

  // ── OSIRIS SDK — Intelligence Fusion Layer ──
  // Produces node coordinates for the SDK network mesh visualization.
  // Does NOT duplicate existing layer visuals — SDK layer is LINES ONLY.
  // Cameras are excluded — they have their own dedicated layer.
  useEffect(() => {
    const anyActive = activeLayers.sdk_sea || activeLayers.sdk_air || activeLayers.sdk_naval;
    if (!anyActive) {
      dataRef.current = { ...dataRef.current, sdk_entities: [] };
      return;
    }

    const sdkEntities: any[] = [];

    // Air domain (nodes only — no visual duplication)
    const allFlights = [
      ...(data.commercial_flights || []),
      ...(data.private_flights || []),
      ...(data.private_jets || []),
      ...(data.military_flights || []),
    ];
    // Sample flights to keep it clean (every Nth)
    const flightStep = Math.max(1, Math.floor(allFlights.length / 60));
    for (let i = 0; i < allFlights.length; i += flightStep) {
      const f = allFlights[i];
      if (!f.lat || !f.lng) continue;
      sdkEntities.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
        properties: { domain: 'AIR', name: f.callsign?.trim() || 'TRACK', source: 'ADS-B / OpenSky' },
      });
    }

    // Sea domain
    const ships = data.maritime_ships || [];
    const shipStep = Math.max(1, Math.floor(ships.length / 60));
    for (let i = 0; i < ships.length; i += shipStep) {
      const s = ships[i];
      if (!s.lat || !s.lng) continue;
      sdkEntities.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { domain: 'SEA', name: s.name || `MMSI-${s.mmsi}`, source: 'AIS Stream' },
      });
    }

    // Events — Earthquakes
    if (data.earthquakes?.length) {
      for (const eq of data.earthquakes) {
        if (!eq.lat || !eq.lng) continue;
        sdkEntities.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: [eq.lng, eq.lat] },
          properties: { domain: 'LAND', name: `M${eq.magnitude} ${eq.place || ''}`, source: 'USGS' },
        });
      }
    }

    // GDELT events
    if (data.gdelt?.length) {
      for (const g of data.gdelt) {
        if (!g.lat || !g.lng) continue;
        sdkEntities.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: [g.lng, g.lat] },
          properties: { domain: 'INTEL', name: g.name || 'GDELT Event', source: 'GDELT Project' },
        });
      }
    }

    // News intel
    if (data.news?.length) {
      for (const n of data.news) {
        if (!n.coords || n.coords.length < 2) continue;
        sdkEntities.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: [n.coords[1], n.coords[0]] },
          properties: { domain: 'INTEL', name: n.title || 'SIGINT', source: n.source || 'RSS Feed' },
        });
      }
    }

    dataRef.current = { ...dataRef.current, sdk_entities: sdkEntities };
  }, [dataVersion, activeLayers.sdk_sea, activeLayers.sdk_air, activeLayers.sdk_naval]);

  const totalFlights = useMemo(() => (
    (data.commercial_flights?.length||0)+(data.private_flights?.length||0)+(data.private_jets?.length||0)+(data.military_flights?.length||0)
  ), [data.commercial_flights, data.private_flights, data.private_jets, data.military_flights]);

  /* What a share link would carry right now: the map's real centre (the
     settled view state, not the cursor), and the open camera when the
     viewer is showing one. */
  const shareView = {
    lat: mapCenter?.lat ?? mapView.latitude,
    lng: mapCenter?.lng ?? mapView.longitude,
    zoom: mapView.zoom,
    bearing: mapView.bearing,
    pitch: mapView.pitch,
  };
  const shareCameraId = activeCamera?.type === 'cctv' && activeCamera?.id != null && activeCamera?.id !== ''
    ? String(activeCamera.id) : null;
  const shareCameraName = shareCameraId ? (activeCamera?.name ?? null) : null;


  return (
    <main className="fixed inset-0 w-full h-full bg-[var(--bg-void)] overflow-hidden">

      {/* ── SPLASH ── */}
      <AnimatePresence onExitComplete={() => setSplashGone(true)}>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            // A slight push-through as it fades: the splash gives way to the globe
            // behind it instead of just dissolving.
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
            // Tap-to-dismiss, Halloween window only: the spooky splash holds
            // ~4.5 s past SYSTEM READY, and repeat visitors can skip it with
            // a tap instead of waiting. Outside the window there is no
            // handler at all — the splash behaves exactly as before.
            onPointerDown={spooky ? () => setShowSplash(false) : undefined}
            className="absolute inset-0 z-[999] flex flex-col items-center justify-center overflow-hidden"
            style={{ background: 'radial-gradient(ellipse at center, #0a0a14 0%, var(--bg-void) 70%)' }}
          >
            {/* ── Scanline CRT overlay ── */}
            <div className="absolute inset-0 pointer-events-none z-[1]" style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(212,175,55,0.015) 2px, rgba(212,175,55,0.015) 4px)',
              animation: 'splashScanDrift 8s linear infinite',
            }} />

            {/* ── Version badge — top-left ── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ delay: 0.8, duration: 0.5 }}
              className="absolute top-6 left-6 z-[2] font-mono text-[11px] tracking-[0.3em] text-[var(--gold-primary)]"
            >
              {APP_VERSION}
            </motion.div>



            {/* ── Splash logo — orbiting rings around the globe mark.
                During the Halloween window the mark is the pumpkin globe
                (hero size); the swap happens while the globe is still at
                its initial opacity 0, so no normal-globe frame flashes. ── */}
            <div className={`relative mb-8 flex items-center justify-center z-[2] ${spooky ? 'w-52 h-52 md:w-64 md:h-64' : 'w-40 h-40'}`}>
              {/* Outer ring — slow clockwise */}
              <motion.div
                initial={{ opacity: 0, scale: 0.6, rotate: 0 }}
                animate={{ opacity: 1, scale: 1, rotate: 360 }}
                transition={{ opacity: { duration: 0.6 }, scale: { duration: 0.8, ease: 'easeOut' }, rotate: { duration: 20, repeat: Infinity, ease: 'linear' } }}
                className="absolute inset-0 rounded-full"
                style={{ border: '1px solid rgba(212,175,55,0.2)' }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ background: 'var(--gold-primary)', boxShadow: '0 0 12px var(--gold-primary), 0 0 24px rgba(212,175,55,0.3)' }} />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-1 h-1 rounded-full" style={{ background: 'rgba(212,175,55,0.5)', boxShadow: '0 0 6px rgba(212,175,55,0.3)' }} />
              </motion.div>

              {/* Middle ring — faster counter-clockwise */}
              <motion.div
                initial={{ opacity: 0, scale: 0.4, rotate: 0 }}
                animate={{ opacity: 1, scale: 1, rotate: -360 }}
                transition={{ opacity: { duration: 0.6, delay: 0.15 }, scale: { duration: 0.8, delay: 0.15, ease: 'easeOut' }, rotate: { duration: 12, repeat: Infinity, ease: 'linear' } }}
                className="absolute rounded-full"
                style={{ inset: '18px', border: '1px solid rgba(0,229,255,0.15)' }}
              >
                <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--cyan-primary)', boxShadow: '0 0 10px var(--cyan-primary), 0 0 20px rgba(0,229,255,0.2)' }} />
                <div className="absolute bottom-0 left-1/4 translate-y-1/2 w-1 h-1 rounded-full" style={{ background: 'rgba(0,229,255,0.4)' }} />
              </motion.div>

              {/* ── Globe mark — normal G Cut, or the pumpkin during
                  the Halloween window (boot screen only; the header
                  mark is untouched) ── */}
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
                className={`relative z-[2] ${spooky ? 'w-full h-full rounded-full' : 'w-24 h-24 rounded-[20%]'}`}
                style={{ boxShadow: spooky ? '0 0 40px rgba(255,117,24,0.35), 0 0 80px rgba(255,117,24,0.15)' : '0 0 32px rgba(56,189,248,0.22), 0 0 64px rgba(212,175,55,0.08)' }}
              >
                {spooky ? (
                  <PumpkinGlobe className="w-full h-full" title="Glass Earth Halloween logo" />
                ) : (
                  <BrandGlobe className="w-full h-full" title="Glass Earth logo" />
                )}
              </motion.div>

              {/* Faint pulsing radar sweep */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.15, 0], rotate: [0, 360] }}
                transition={{ opacity: { duration: 3, repeat: Infinity }, rotate: { duration: 3, repeat: Infinity, ease: 'linear' }, delay: 0.6 }}
                className="absolute inset-[10px] rounded-full"
                style={{ background: 'conic-gradient(from 0deg, transparent 0deg, rgba(212,175,55,0.15) 40deg, transparent 80deg)' }}
              />
            </div>

            {/* ── Glass Earth title — letter-by-letter stagger ── */}
            <div className="flex items-center gap-[2px] mb-3 z-[2]">
              {'GLASS EARTH'.split('').map((letter, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ delay: 0.5 + i * 0.08, duration: 0.5, ease: 'easeOut' }}
                  className="text-4xl md:text-5xl font-bold tracking-[0.5em] font-mono"
                  style={{ color: 'var(--text-heading)', textShadow: '0 0 30px rgba(212,175,55,0.2)' }}
                >
                  {letter}
                </motion.span>
              ))}
            </div>

            {/* ── Subtitle — typewriter reveal ── */}
            <div className="overflow-hidden mb-3 z-[2]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ delay: 1.2, duration: 0.8, ease: 'easeInOut' }}
                className="overflow-hidden whitespace-nowrap"
              >
                <p className="text-[11px] md:text-[10px] font-mono tracking-[0.5em] text-[var(--gold-primary)]" style={{ opacity: 0.8 }}>
                  REAL-TIME EARTH OBSERVATION
                </p>
              </motion.div>
            </div>

            {/* ── Tagline ── */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.55, duration: 0.7 }}
              className="mb-3 z-[2] text-[13px] md:text-sm font-mono tracking-[0.25em] text-[var(--text-heading)]"
              style={{ textShadow: '0 0 18px rgba(56,189,248,0.25)' }}
            >
              See everything. Miss nothing.
            </motion.p>

            {/* ── Seasonal line — Halloween launch week only (lib/seasonal);
                absent from the tree entirely outside the window ── */}
            {spooky && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.9 }}
                transition={{ delay: 1.85, duration: 0.6 }}
                className="mb-3 z-[2] text-[11px] md:text-xs font-mono tracking-[0.25em]"
                style={{ color: SPOOKY_ORANGE, textShadow: '0 0 18px rgba(255,117,24,0.35)' }}
              >
                The planet is live tonight — all of it.
              </motion.p>
            )}

            {/* ── Credit ── */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.75 }}
              transition={{ delay: 1.7, duration: 0.6 }}
              className="mb-8 z-[2] text-[10px] md:text-[11px] font-mono tracking-[0.35em] text-[var(--text-muted)]"
            >
              by Rick Quast
            </motion.p>

            {/* ── Multi-stage progress bar ── */}
            <div className="w-64 md:w-80 z-[2]">
              {/* Thin progress track */}
              <div className="relative w-full h-[2px] rounded-full overflow-hidden" style={{ background: spooky ? 'rgba(255,117,24,0.16)' : 'rgba(212,175,55,0.1)' }}>
                <motion.div
                  initial={{ width: '0%' }}
                  animate={{ width: SPLASH_PROGRESS[splashStage] }}
                  transition={{ duration: 0.55, delay: splashStage === 0 ? 0.5 : 0, ease: 'easeInOut' }}
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: 'linear-gradient(90deg, var(--gold-primary), var(--cyan-primary), var(--gold-primary))', boxShadow: '0 0 12px rgba(212,175,55,0.4)' }}
                />
              </div>

              {/* Status message — one line, swapped as each stage is reached */}
              <div className="mt-3 h-4 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={splashStage}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.18, delay: splashStage === 0 ? 0.5 : 0 }}
                    className="text-[10px] font-mono tracking-[0.25em]"
                    style={{ color: splashStage === 3 ? 'var(--cyan-primary)' : 'var(--text-muted)' }}
                  >
                    {SPLASH_STAGES[splashStage]}
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>

            {/* ── Decorative grid lines ── */}
            <div className="absolute inset-0 pointer-events-none z-[0]" style={{ opacity: 0.03 }}>
              <div className="absolute inset-0" style={{
                backgroundImage: 'linear-gradient(rgba(212,175,55,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.5) 1px, transparent 1px)',
                backgroundSize: '60px 60px',
              }} />
            </div>

            {/* ── Corner frame accents ── */}
            {[
              { t: '10px', l: '10px', bw: '2px 0 0 2px' },
              { t: '10px', r: '10px', bw: '2px 2px 0 0' },
              { b: '10px', l: '10px', bw: '0 0 2px 2px' },
              { b: '10px', r: '10px', bw: '0 2px 2px 0' },
            ].map((pos, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.3 }}
                transition={{ delay: 0.8 + i * 0.1, duration: 0.5 }}
                className="absolute w-8 h-8 z-[2]"
                style={{ top: pos.t, bottom: pos.b, left: pos.l, right: pos.r, borderWidth: pos.bw, borderStyle: 'solid', borderColor: 'var(--gold-primary)' }}
              />
            ))}



            {/* ── Inline keyframe for scanline drift ── */}

          </motion.div>
        )}
      </AnimatePresence>



      {/* ── MAP ── */}
      <ErrorBoundary name="Map">
        <OsirisMap 
          key={osirisTheme}
          data={data} 
          activeLayers={activeLayers} 
          projection={mapProjection === 'mercator' ? 'mercator' : 'globe'}
          terrainEnabled={activeLayers.terrain_elevation && mapProjection === 'globe'}
          terrainFocus={terrainFocus}
          terrainRetry={terrainRetry}
          onTerrainStatusChange={setTerrainStatus}
          onLayerOff={key => setActiveLayers(prev => ({ ...prev, [key]: false }))}
          mapStyle={mapStyle === 'satellite' ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' : 'dark'} 
          onEntityClick={handleEntityClick} 
          onMouseCoords={handleMouseCoords} 
          onRightClick={handleRightClick} 
          onViewStateChange={setMapView}
          onReady={() => setMapReady(true)}
          flyToLocation={flyToLocation}
          alertPinIds={pinnedAlertIds}
          scanTargets={scanTargets}
          demoMode={demoMode}
          theme={osirisTheme}
          arcgisLayers={arcgisLayers.filter(l => l.visible).map(l => ({ id: l.id, title: l.title, geojson: l.geojson, color: l.color, opacity: l.opacity }))}
          onMapCenter={setMapCenter}
          onTransitStatus={setTransitStatus}
          route={activeRoute}
          userLocation={
            navSession && navProgress
              ? { lat: navProgress.snapped[1], lng: navProgress.snapped[0], accuracy: liveLocation?.accuracy, heading: liveLocation?.heading }
              : liveLocation
          }
          followUser={followUser}
          onFollowInterrupt={() => setFollowUser(false)}
          navigating={Boolean(navSession)}
          drawMode={drawMode}
          onDrawProgress={setDrawProgress}
          drawCommand={drawCommand}
          onDrawCancel={() => { setDrawMode(null); setDrawProgress(null); }}
          onDrawComplete={handleDrawComplete}
          drawnPolygons={drawnPolygons}
          aircraftAirports={aircraftAirports}
          onOiGlobe={handleOiGlobe}
          onOiSelect={handleOiSelect}
          onOiHover={setOiHover}
          onOiFollow={setOiFollowing}
          oiHighlight={oiHighlight}
        />
      </ErrorBoundary>

      {/* ── OI: what the pointer is over on the globe ── */}
      {oiHover && !isMobile && (
        <div
          className="fixed z-[950] pointer-events-none max-w-[300px] rounded-lg border border-[var(--border-primary)] bg-[rgba(12,14,26,0.94)] backdrop-blur-xl px-3 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
          style={{ left: Math.min(oiHover.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1920) - 314), top: oiHover.y + 16 }}
        >
          <div className="text-[11.5px] font-medium leading-snug text-[var(--text-heading)]">{oiHover.title}</div>
          {oiHover.detail && <div className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-secondary)]">{oiHover.detail}</div>}
          <div className="mt-1 text-[8.5px] font-mono tracking-[0.18em] text-[var(--gold-primary)]">CLICK TO OPEN</div>
        </div>
      )}

      {/* ── DIRECTIONS — opens beside the right-hand tool rail, under the top bar ── */}
      <div
        className={`absolute ${isMobile ? 'top-3' : 'top-[64px]'} z-[400] w-[min(92vw,384px)] pointer-events-auto`}
        style={isMobile ? { left: '50%', transform: 'translateX(-50%)' } : { right: '56px' }}
      >
        {navSession ? (
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
            <NavigationView
              key={navSession.key}
              route={navSession.route}
              destinationLabel={navSession.label}
              fix={liveLocation}
              onProgress={setNavProgress}
              following={followUser}
              onRecenter={() => setFollowUser(true)}
              onExit={() => { setNavSession(null); setNavProgress(null); setFollowUser(false); }}
              onReroute={async (fromPt) => {
                /* Re-plan from where the traveller actually is, to the same
                   destination, the way the trip was planned: same mode (a walk
                   stays a walk), same avoid options, and the stops not yet passed. */
                const { route, plan } = navSession;
                const dest = route.geometry.coordinates.at(-1)!;
                const ahead = stopsAhead(route.geometry.coordinates, plan.stops, fromPt);
                const via = ahead.length ? `&via=${ahead.map((p) => `${p.lat},${p.lng}`).join('|')}` : '';
                const avoid = plan.avoid.length ? `&avoid=${plan.avoid.join(',')}` : '';
                try {
                  const res = await fetch(
                    `/api/directions?from=${fromPt.lat},${fromPt.lng}&to=${dest[1]},${dest[0]}&mode=${encodeURIComponent(route.mode)}${via}${avoid}`,
                  );
                  const data = await res.json();
                  if (res.ok && !data.error) {
                    setNavSession((n) => (n ? { ...n, route: data, key: Date.now(), plan: { ...n.plan, stops: ahead } } : n));
                    setActiveRoute({ ...data, from: fromPt, to: { lat: dest[1], lng: dest[0] } });
                  }
                } catch { /* keep the old route rather than dropping guidance */ }
              }}
            />
          </motion.div>
        ) : null}

        {/* The planner stays mounted underneath a running session: unmounting it
            would discard the route you are driving, so ending guidance would
            drop you into an empty form instead of back onto your route. */}
        {showDirections && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: navSession ? 0 : 1, y: 0 }}
            className={navSession ? 'pointer-events-none h-0 overflow-hidden' : ''}
            aria-hidden={Boolean(navSession)}
          >
            <DirectionsBar
              key={routeTarget?.ts ?? 'plan'}
              initialTo={routeTarget}
              center={mapCenter ? { lat: mapCenter.lat, lng: mapCenter.lng } : null}
              onRoute={(r) => setActiveRoute(r)}
              onLiveLocation={setLiveLocation}
              onFollowChange={setFollowUser}
              onActiveSegment={(seg) => setActiveRoute((r) => (r ? { ...r, activeSegment: seg } : r))}
              onStartNavigation={(r, label, plan) => {
                setNavSession({ route: r, label, key: Date.now(), plan });
                setFollowUser(true);
              }}
              onLocate={(lat, lng, zoom) => setFlyToLocation({ lat, lng, zoom, ts: Date.now() })}
              onClose={() => { setShowDirections(false); setActiveRoute(null); setRouteTarget(null); }}
            />
          </motion.div>
        )}
      </div>

      {/* ── SEARCH — a spotlight at the top of the map: places, addresses, coordinates ── */}
      <AnimatePresence>
        {showDesktopSearch && !isMobile && (
          <div data-hud className="absolute top-[92px] left-1/2 -translate-x-1/2 z-[450] w-[min(560px,calc(100vw-180px))] pointer-events-auto">
            <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ duration: 0.16 }}>
              <SearchBar center={mapCenter} onClose={() => setShowDesktopSearch(false)} onDirections={openDirectionsTo}
                onLocate={(lat, lng, zoom) => setFlyToLocation({ lat, lng, zoom, ts: Date.now() })} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>


      {/* ── FLIGHT WATCH ── */}
      {watchedFlights.length > 0 && (
        <motion.div
          initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
          className="absolute top-3 z-[380] w-[min(92vw,290px)] pointer-events-auto
                     max-h-[calc(100vh-180px)] overflow-y-auto styled-scrollbar"
          style={{ left: isMobile ? '12px' : '120px' }}
        >
          <FlightWatchPanel
            watched={watchedFlights}
            telemetry={watchTelemetry}
            onRemove={removeWatched}
            onLocate={(lat, lng) => setFlyToLocation({ lat, lng, zoom: 8, ts: Date.now() })}
            onDetail={handleAircraftDetail}
          />
        </motion.div>
      )}

      {/* ── MAP VIEW CONTROLS ── */}
      <motion.div
        data-hud
        initial={{ opacity: 0, y: 20 }} animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={hudIn(0.45)}
        className="absolute bottom-[75px] md:bottom-[100px] z-[200] flex flex-col gap-1.5 pointer-events-none"
        style={{ left: isMobile ? '12px' : '120px' }}
      >
        {/* Unified Control Strip */}
        <div className="flex items-center gap-[3px] p-[3px] pointer-events-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-panel)] backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.55)]">
          <ViewSegment layoutId="view-projection" active={mapProjection === 'globe'} onClick={() => setMapProjection('globe')} title="3D Globe" icon={Globe} label="3D" />
          <ViewSegment layoutId="view-projection" active={mapProjection === 'mercator'} onClick={selectFlatMap} title="2D Map" icon={MapPinned} label="2D" />
          <div className="w-px h-5 mx-1 bg-[var(--border-secondary)]" />
          <ViewSegment layoutId="view-style" active={mapStyle === 'dark'} onClick={() => setMapStyle('dark')} title="Night Mode" icon={Moon} label="MAP" />
          <ViewSegment layoutId="view-style" active={mapStyle === 'satellite'} onClick={() => setMapStyle('satellite')} title="Satellite View" icon={Satellite} label="SAT" />
        </div>


        {/* Scale Bar */}
        {!isMobile && (
          <div className="pl-0.5">
            <ScaleBar zoom={mapView.zoom} latitude={mapView.latitude} />
          </div>
        )}
      </motion.div>

      {/* ── HEADER ── */}
      <motion.div data-hud initial={{ opacity: 0, y: -20 }} animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }} transition={hudIn(0.15)} className={`absolute top-4 z-[200] pointer-events-none flex flex-col`} style={{ left: isMobile ? '24px' : '64px', right: '24px' }}>
        <div className="flex items-center gap-3 w-fit">
          <BrandGlobe className="w-8 h-8 md:w-10 md:h-10 shrink-0" />
          <div className="flex flex-col items-start gap-0.5">
            <h1 className="text-lg md:text-xl font-bold tracking-[0.4em] text-[#D4AF37] font-mono">GLASS EARTH</h1>
            <span className="text-[9px] md:text-[10px] font-mono tracking-[0.2em] opacity-80 uppercase text-[#D4AF37]" style={spooky ? { color: osirisTheme === 'day' ? SPOOKY_ORANGE_DAY : SPOOKY_ORANGE } : undefined}>REAL-TIME EARTH OBSERVATION</span>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1.5 pl-[44px] min-w-0 pr-4">
          <span className="text-[9px] md:text-[9px] text-[var(--text-muted)] font-mono tracking-[0.2em] md:tracking-[0.3em] uppercase opacity-40 truncate">
            REAL-TIME GLOBAL MONITORING <span className="hidden md:inline">· FLIGHTS · MARITIME · SATELLITES · CCTV · WEATHER · CYBER THREATS</span>
          </span>
        </div>
      </motion.div>


      {/* ── LIVE COUNTER STRIP ── */}
      <motion.div data-hud initial={{ opacity: 0, y: -8 }} animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }} transition={hudIn(0.4)} className="absolute z-[190] pointer-events-none" style={{ left: isMobile ? '24px' : '108px', top: isMobile ? '82px' : '96px' }}>
        <LiveCounterStrip dataRef={dataRef} flightsStatus={flightsStatus} />
      </motion.div>


      {/* ── TOP-RIGHT STATUS (desktop) ── */}
      <motion.div data-hud initial={{ opacity: 0 }} animate={{ opacity: revealed ? 1 : 0 }} transition={hudIn(0.35)} className="status-bar-desktop absolute top-4 right-6 z-[200] pointer-events-none flex items-center gap-3 text-[10px] font-mono tracking-widest text-[var(--text-muted)]">

        <span className="hidden lg:inline-flex items-center gap-1.5">
          <ZuluClock />
        </span>

        <span className="flex items-center gap-1" title="Backend connection status">STATUS: <span className={backendStatus === 'connected' ? 'text-[var(--alert-green)]' : 'text-[var(--alert-red)]'}>{backendStatus === 'connected' ? 'LIVE' : backendStatus.toUpperCase()}</span></span>

        <span className="hidden lg:inline-flex items-center gap-1" title="Number of active data layers">
          <span className="text-[var(--cyan-primary)] font-bold">{Object.values(activeLayers).filter(Boolean).length}</span>
          <span className="opacity-60">LAYERS</span>
        </span>

        <span className="hidden lg:inline-flex items-center gap-1" title="Tracked entities on map">
          <ActiveEntityCount data={data} />
          <span className="opacity-60">ENTITIES</span>
        </span>

        {spaceWeather && <span className="hidden lg:inline" title={spaceWeather.kp_index == null ? 'Geomagnetic Storm Index — no reading from NOAA' : `Geomagnetic Storm Index — Kp${spaceWeather.kp_index}`}>SOLAR: <span style={{ color: spaceWeather.storm_color, fontWeight: 700 }}>{spaceWeather.kp_index == null ? 'N/A' : `Kp${spaceWeather.kp_index}`}</span></span>}

        <span className="text-[11px] font-bold tracking-[0.2em] text-[var(--text-muted)] opacity-50">{APP_VERSION}</span>
        
        <SupportMenu />
      </motion.div>

      {/* ── MOBILE: Compact top status ── */}
      {/* The route planner claims the top of a phone screen; leaving this in
          place would put the support badge underneath the destination field. */}
      {isMobile && !showDirections && !navSession && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: revealed ? 1 : 0 }} transition={hudIn(0.35)} className="absolute top-3 right-3 z-[200] pointer-events-auto flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <SupportMenu compact />
          </div>
        </motion.div>
      )}



      {/* ── NEW SIDEBAR (Root Level) ── */}
      {showLayers && !isMobile && <div data-hud><LayerPanel {...terrainPanelProps} revealed={revealed} data={data} activeLayers={activeLayers} setActiveLayers={setActiveLayers} theme={osirisTheme} setTheme={setOsirisTheme} capabilities={capabilities} liveStatus={layerLiveStatus} /></div>}



      {/* ── RIGHT TOOL STRIP (desktop only — mobile uses bottom nav) ── */}
      {!isMobile && <motion.div data-hud initial={{ opacity: 0, x: 12 }} animate={revealed ? { opacity: 1, x: 0 } : { opacity: 0, x: 12 }} transition={hudIn(0.3)} className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 z-[250] pointer-events-auto bg-black/40 backdrop-blur-sm p-1 rounded-full border border-white/5">
        <div className="relative group">
          <button onClick={() => setOsirisTheme(osirisTheme === 'day' ? 'core' : 'day')} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${osirisTheme === 'day' ? 'bg-[var(--gold-primary)]/20' : 'hover:bg-white/10'}`} title="Day / Night — switch the app between the light day theme and the dark theme" aria-label="Toggle day and night mode" aria-pressed={osirisTheme === 'day'}>
            {osirisTheme === 'day'
              ? <Sun className="w-4 h-4 text-[var(--gold-primary)]" />
              : <Moon className="w-4 h-4 text-white/60" />}
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">DAY / NIGHT</span>
        </div>

        <div className="relative group">
          <button onClick={goBackView} disabled={!canGoBack} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${canGoBack ? 'hover:bg-white/10' : 'opacity-35 cursor-not-allowed'}`} title={canGoBack ? 'Back — return to the previous view' : 'Back — no previous view yet'} aria-label="Back to previous view" aria-disabled={!canGoBack}>
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">BACK — PREVIOUS VIEW</span>
        </div>

        <div className="relative group">
          <button onClick={() => setFlyToLocation({ lat: HOME_BASE.lat, lng: HOME_BASE.lng, zoom: HOME_BASE.zoom, duration: 3500, ts: Date.now() })} className="relative w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50" title="Home — fly back to El Paso, Glass Earth's home base" aria-label="Fly home to El Paso">
            <Home className="w-4 h-4 text-white/60" />
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">HOME — EL PASO</span>
        </div>

        <div className="relative group">
          <button onClick={takeMeSomewhereLive} className="relative w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50" title={roulette.title} aria-label="Take me somewhere live">
            <span className="relative block">
              <Dices className={`w-4 h-4 ${spooky ? 'text-[#FF7518]' : 'text-white/60'} ${roulette.ready ? '' : 'opacity-40'}`} />
              {!roulette.ready && (
                <span aria-hidden="true" className="absolute -right-1 -top-1 block h-2 w-2 rounded-full border border-white/50 border-t-transparent animate-spin" />
              )}
            </span>
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">SOMEWHERE LIVE</span>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowOi(false); setShowAlerts(false); setShowMarkets(false); setShowSpaceCam(v => !v); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showSpaceCam ? 'bg-[#00E5FF]/20' : 'hover:bg-white/10'}`} title="Live from Space — 24/7 video downlink from the ISS" aria-label="Live from Space" aria-expanded={showSpaceCam}>
            <Radio className={`w-4 h-4 ${showSpaceCam ? 'text-[#00E5FF]' : 'text-white/60'}`} />
            {showSpaceCam && (
              <span
                aria-hidden="true"
                className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-current text-[#00E5FF]"
              />
            )}
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">SPACE</span>
          <AnimatePresence>
            {showSpaceCam && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute right-12 top-1/2 -translate-y-1/2 w-80">
                <SpaceCam />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowWall(true); setShowSpaceCam(false); setShowMarkets(false); setShowAlerts(false); setShowTv(false); setShowSpotting(false); }} className="relative w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50" title="Camera Theater — a wall of live cameras (Texas / El Paso first)" aria-label="Camera Theater">
            <LayoutGrid className="w-4 h-4 text-white/60" />
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">THEATER</span>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowTv(!showTv); setShowSpaceCam(false); setShowMarkets(false); setShowAlerts(false); setShowSpotting(false); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showTv ? 'bg-[var(--gold-primary)]/20' : 'hover:bg-white/10'}`} title="Television — live news, multiview, free streaming services" aria-label="Television" aria-expanded={showTv}>
            <Tv className={`w-4 h-4 ${showTv ? 'text-[var(--gold-primary)]' : 'text-white/60'}`} />
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">TV</span>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowStations(!showStations); setShowTv(false); setShowSpaceCam(false); setShowMarkets(false); setShowAlerts(false); setShowSpotting(false); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showStations ? 'bg-[#00E5FF]/20' : 'hover:bg-white/10'}`} title="Stations — live TV channels and internet radio from open directories" aria-label="Stations" aria-expanded={showStations}>
            <RadioTower className={`w-4 h-4 ${showStations ? 'text-[#00E5FF]' : 'text-white/60'}`} />
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">STATIONS</span>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowSpotting(!showSpotting); setShowTv(false); setShowSpaceCam(false); setShowMarkets(false); setShowAlerts(false); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showSpotting ? 'bg-[var(--gold-primary)]/20' : 'hover:bg-white/10'}`} title="Plane Spotting — 24/7 airport cameras with LiveATC links" aria-label="Plane Spotting" aria-expanded={showSpotting}>
            <Plane className={`w-4 h-4 ${showSpotting ? 'text-[var(--gold-primary)]' : 'text-white/60'}`} />
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">SPOTTING</span>
        </div>

        <div ref={marketsAnchor} className="relative group">
          <button onClick={() => { setShowMarkets(!showMarkets); setShowOi(false); setShowAlerts(false); setShowSpaceCam(false); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showMarkets ? 'bg-[var(--gold-primary)]/20' : 'hover:bg-white/10'}`} title="Markets — crypto prices, space weather, global indices" aria-label="Markets" aria-expanded={showMarkets}>
            <BarChart3 className={`w-4 h-4 ${showMarkets ? 'text-[var(--gold-primary)]' : 'text-white/60'}`} />
            {showMarkets && (
              <span
                aria-hidden="true"
                className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-current text-[var(--gold-primary)]"
              />
            )}
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">MARKETS</span>
          <AnimatePresence>
            {showMarkets && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute right-12 w-[380px]" style={{ top: marketsTop }}>
                <MarketsPanel data={data} spaceWeather={spaceWeather} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowAlerts(!showAlerts); setShowOi(false); setShowMarkets(false); setShowDrawing(false); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showAlerts ? 'bg-[#FF3D3D]/20' : 'hover:bg-white/10'}`} title="Live Alerts — earthquakes, conflicts, breaking news" aria-label="Live Alerts" aria-expanded={showAlerts}>
            <AlertTriangle className={`w-4 h-4 ${showAlerts ? 'text-[#FF3D3D]' : 'text-white/60'}`} />
            {showAlerts && (
              <span
                aria-hidden="true"
                className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-current text-[#FF3D3D]"
              />
            )}
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">ALERTS</span>
          <AnimatePresence>
            {showAlerts && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute right-12 top-1/2 -translate-y-1/2 w-80">
                <LiveAlerts data={data} onLocate={(lat, lng, options) => setFlyToLocation({ lat, lng, zoom: options?.zoom, alertId: options?.alertId, ts: Date.now() })} pinsOn={activeLayers.alert_pins} onTogglePins={on => setActiveLayers(prev => ({ ...prev, alert_pins: on }))} onPinnedChange={setPinnedAlertIds} onWatchFeed={(url, name) => { setLiveFeedUrl(url); setLiveFeedName(name); }} onRefresh={() => fetchEndpoint('/api/news', newsTransform)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowDrawing(!showDrawing); setShowMarkets(false); setShowAlerts(false); setShowSpaceCam(false); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showDrawing ? 'bg-[#00E5FF]/20' : 'hover:bg-white/10'}`} title="Draw — measure areas of interest on the map" aria-label="Draw" aria-expanded={showDrawing}>
            <PenLine className={`w-4 h-4 ${showDrawing ? 'text-[#00E5FF]' : 'text-white/60'}`} />
            {showDrawing && (
              <span
                aria-hidden="true"
                className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-current text-[#00E5FF]"
              />
            )}
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">DRAW</span>
        </div>

        {/* A named group: the OI panel opens inside this wrapper, and an unnamed group would light every hover style in the panel at once. */}
        <div ref={oiAnchor} className="relative group/oi">
          {/* OI, the strip's main tool: bigger than the rest, in the middle of it, in its own colours. */}
          <button onClick={() => { setShowOi(!showOi); setShowMarkets(false); setShowAlerts(false); setShowSpaceCam(false); }}
            className={`relative w-11 h-11 rounded-full flex flex-col items-center justify-center gap-[3px] border transition-all duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showOi ? 'bg-[var(--gold-primary)]/20 border-[var(--gold-primary)]/70 shadow-[0_0_18px_rgba(var(--gold-rgb),0.35)]' : 'bg-[var(--gold-primary)]/[0.07] border-[var(--gold-primary)]/35 hover:bg-[var(--gold-primary)]/15 hover:border-[var(--gold-primary)]/60 hover:shadow-[0_0_14px_rgba(var(--gold-rgb),0.25)]'}`}
            title="OI — talk to it and it works the map for you, or run a forecast, on your own AI key (O)" aria-label="OI" aria-expanded={showOi}>
            <OiMark size={18} live={oi.state?.status === 'running' || assist.busy} />
            <span className={`text-[7.5px] font-mono font-semibold tracking-[0.2em] leading-none pl-[0.2em] ${showOi ? 'text-[var(--gold-light)]' : 'text-[var(--gold-primary)]'}`}>OI</span>
            {showOi && (
              <span
                aria-hidden="true"
                className="absolute -right-1 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-full bg-current text-[var(--gold-primary)]"
              />
            )}
            {oi.state?.status === 'running' && <span aria-hidden="true" className="absolute top-0 right-0 w-2 h-2 rounded-full bg-[var(--gold-light)] border border-black/60 animate-pulse" />}
          </button>
          {!showOi && <span className="absolute right-14 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover/oi:opacity-100 group-focus-within/oi:opacity-100 transition-opacity pointer-events-none">OI · ASSIST &amp; FORECAST</span>}
          <AnimatePresence>
            {showOi && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute right-[60px] w-[412px]" style={{ top: oiTop }}>
                <OiPanel oi={oi} selected={oiSelected} onSelect={setOiSelected} onClose={() => { setShowOi(false); setOiTheater(false); setOiAutoFocus(false); }}
                  focus={oiFocus} onFocus={toggleOiFocus} onLocate={handleOiLocate}
                  theater={oiTheater} onTheater={setOiTheater} following={oiFollowing} onFollow={followOi}
                  assist={assist} mode={oiMode} onMode={setOiMode} speakOn={oiVoice} onSpeak={setOiVoicePersist} autoFocus={oiAutoFocus}
                  stage={oiStage} onStage={setOiStage} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative group">
          <button onClick={() => { setShowDirections(!showDirections); setRouteTarget(null); if (showDirections) { setActiveRoute(null); } setShowDesktopSearch(false); setShowMarkets(false); setShowAlerts(false); setShowSpaceCam(false); setShowDrawing(false); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showDirections ? 'bg-[var(--gold-primary)]/20' : 'hover:bg-white/10'}`} title="Directions — turn-by-turn routing" aria-label="Directions" aria-expanded={showDirections}>
            <Route className={`w-4 h-4 ${showDirections ? 'text-[var(--gold-primary)]' : 'text-white/60'}`} />
            {showDirections && (
              <span
                aria-hidden="true"
                className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-current text-[var(--gold-primary)]"
              />
            )}
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">ROUTE</span>
        </div>

        <div className="relative group">
          <button data-search-toggle onClick={() => { setShowDesktopSearch(!showDesktopSearch); setShowMarkets(false); setShowAlerts(false); setShowSpaceCam(false); setShowDrawing(false); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showDesktopSearch ? 'bg-[var(--gold-primary)]/20' : 'hover:bg-white/10'}`} title="Search — find locations, cities, coordinates" aria-label="Search" aria-expanded={showDesktopSearch}>
            <Search className={`w-4 h-4 ${showDesktopSearch ? 'text-[var(--gold-primary)]' : 'text-white/60'}`} />
            {showDesktopSearch && (
              <span
                aria-hidden="true"
                className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-current text-[var(--gold-primary)]"
              />
            )}
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">SEARCH</span>
        </div>

        <div className="relative">
          <SharePanel view={shareView} activeLayers={activeLayers} cameraId={shareCameraId} cameraName={shareCameraName} withShortcut={false} />
        </div>

        {/* Separator */}
        <div className="w-4 h-px bg-white/10 mx-auto" />

        {/* ── ARCGIS INTEL ── */}
        <div className="relative group">
          <button onClick={() => { setShowArcGIS(!showArcGIS); setShowRemote(false); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showArcGIS ? 'bg-[var(--gold-primary)]/20' : 'hover:bg-white/10'}`} title="ArcGIS — search & import geospatial intel layers" aria-label="ArcGIS" aria-expanded={showArcGIS}>
            <Database className={`w-4 h-4 ${showArcGIS ? 'text-[var(--gold-primary)]' : 'text-white/60'}`} />
            {showArcGIS && (
              <span
                aria-hidden="true"
                className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-current text-[var(--gold-primary)]"
              />
            )}
            {arcgisLayers.length > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-[var(--gold-primary)] text-black text-[9px] font-mono font-bold leading-none px-0.5">{arcgisLayers.length}</span>}
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">ARCGIS</span>
          <AnimatePresence>
            {showArcGIS && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute right-12 top-1/2 -translate-y-1/2 w-[340px]">
                <div className="glass-panel p-3 max-h-[70vh] overflow-y-auto styled-scrollbar">
                  <ArcGISPanel
                    onImportLayer={(layer) => setArcgisLayers(prev => [...prev.filter(l => l.id !== layer.id), { ...layer, color: layer.color || '#D4AF37', visible: true, opacity: layer.opacity ?? 0.8 }])}
                    onRemoveLayer={(id) => setArcgisLayers(prev => prev.filter(l => l.id !== id))}
                    onUpdateLayer={(id, updates) => setArcgisLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))}
                    importedLayers={arcgisLayers}
                    mapBounds={mapCenter?.bounds || null}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>


        {/* Separator */}
        <div className="w-4 h-px bg-white/10 mx-auto" />

        {/* ── WORLD REMOTE ── */}
        <div className="relative group">
          <button onClick={() => { setShowRemote(!showRemote); setShowArcGIS(false); setShowMarkets(false); setShowAlerts(false); setShowSpaceCam(false); setShowDrawing(false); setShowDesktopSearch(false); }} className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${showRemote ? 'bg-[var(--cyan-primary)]/20' : 'hover:bg-white/10'}`} title="World Remote — control nearby Bluetooth devices (TVs, speakers, AC)" aria-label="World Remote" aria-expanded={showRemote}>
            <Bluetooth className={`w-4 h-4 ${showRemote ? 'text-[var(--cyan-primary)]' : 'text-white/60'}`} />
            {showRemote && (
              <span
                aria-hidden="true"
                className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-current text-[var(--cyan-primary)]"
              />
            )}
          </button>
          <span className="absolute right-11 top-1/2 -translate-y-1/2 px-2 py-1 text-[9px] font-mono tracking-wider text-white/80 bg-black/80 backdrop-blur-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none">REMOTE</span>
          <AnimatePresence>
            {showRemote && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute right-12 top-1/2 -translate-y-1/2 w-80">
                <WorldRemote onClose={() => setShowRemote(false)} onPlaceOnMap={(devs) => {
                  setScanTargets(prev => {
                    const ids = new Set(prev.map((t: any) => t.id));
                    const next = [...prev];
                    devs.forEach(d => { if (!ids.has(d.id)) next.unshift({ id: d.id, name: d.name, lat: d.lat, lng: d.lng, type: d.type, color: d.color, timestamp: Date.now(), source: 'BLE' }); });
                    return next.slice(0, 20);
                  });
                  if (devs.length > 0) setFlyToLocation({ lat: devs[0].lat, lng: devs[0].lng, ts: Date.now() });
                }} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>


      </motion.div>}

      {/* ── LIVE FEED VIEWER OVERLAY ── */}
      <AnimatePresence>
        {liveFeedUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setLiveFeedUrl(null)}
          >
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              className="w-[90vw] max-w-[900px] flex flex-col relative rounded-xl overflow-hidden border border-[var(--border-primary)] shadow-2xl bg-black"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#111] border-b border-[var(--border-primary)]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#FF4081] animate-osiris-pulse" />
                  <span className="text-[11px] font-mono font-bold text-white tracking-wider">{liveFeedName}</span>
                  <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-mono text-[10px] font-bold">LIVE STREAM</span>
                  {!liveFeedEmbedAllowed && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-[10px]">EXTERNAL ONLY</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <a
                    href={getYouTubeWatchUrl(liveFeedUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--border-primary)] hover:bg-[var(--gold-primary)] hover:text-black text-white transition-colors text-[10px] font-mono"
                  >
                    <span>Open in YouTube</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button onClick={() => setLiveFeedUrl(null)} className="text-white/70 hover:text-white transition-colors p-1">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Body — iframe or external card */}
              {liveFeedEmbedAllowed ? (
                <div className="w-full aspect-video relative bg-black">
                  <iframe
                    src={liveFeedUrl}
                    className="w-full h-full absolute inset-0"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div className="w-full aspect-video flex items-center justify-center bg-black/95">
                  <div className="text-center px-8">
                    <div className="w-14 h-14 rounded-full bg-[#39FF14]/10 border border-[#39FF14]/20 flex items-center justify-center mx-auto mb-4">
                      <ExternalLink className="w-6 h-6 text-[#39FF14]" />
                    </div>
                    <p className="text-[12px] font-mono font-bold text-white tracking-widest mb-2">EMBED RESTRICTED</p>
                    <p className="text-[10px] font-mono text-white/50 mb-6 max-w-xs">
                      {liveFeedName} does not allow third-party embedding. Click below to open the live stream directly.
                    </p>
                    <a
                      href={getYouTubeWatchUrl(liveFeedUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded border border-[#39FF14]/40 text-[#39FF14] font-mono text-[11px] hover:bg-[#39FF14]/10 transition-colors tracking-wider"
                    >
                      <ExternalLink className="w-4 h-4" />
                      OPEN LIVE STREAM
                    </a>
                  </div>
                </div>
              )}

              {/* Footer — only show for embeddable feeds */}
              {liveFeedEmbedAllowed && (
                <div className="bg-[#111]/90 px-4 py-2.5 border-t border-[var(--border-primary)] flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-[var(--gold-primary)] shrink-0" />
                  <span className="text-[10px] font-mono text-white/70 leading-relaxed">
                    If you see &ldquo;Video unavailable&rdquo;, use <strong className="text-[var(--gold-primary)]">Open in YouTube</strong> above.
                  </span>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ MOBILE UI ═══ */}
      {isMobile && (
        <>
          {/* Mobile Bottom Navigation */}
          <div className="mobile-nav">
            <div className="glass-panel mobile-nav-inner">
              {[
                { id: 'layers' as const, icon: Layers, label: 'LAYERS' },
                { id: 'markets' as const, icon: BarChart3, label: 'MARKETS' },
                { id: 'intel' as const, icon: Newspaper, label: 'INTEL' },
                { id: 'oi' as const, icon: Orbit, label: 'OI' },
                { id: 'tv' as const, icon: Tv, label: 'TV' },
                { id: 'search' as const, icon: Search, label: 'SEARCH' },
                // Routing was reachable only from the desktop tool rail, so a
                // phone could not open it at all. It sits next to SEARCH
                // because both answer "take me somewhere".
                { id: 'route' as const, icon: Route, label: 'ROUTE' },
                { id: 'remote' as const, icon: Bluetooth, label: 'REMOTE' },
              ].map(tab => {
                // Routing opens the planner at the top of the screen rather than
                // the bottom drawer — it needs the room above the keyboard, and
                // guidance has to stay readable while you drive.
                const isRoute = tab.id === 'route';
                const active = isRoute ? showDirections || Boolean(navSession) : mobilePanel === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      if (isRoute) {
                        // Mid-drive this must not touch anything: closing the
                        // planner clears the active route, which would take the
                        // line off the map underneath a driver. Guidance is
                        // ended from the navigation view's own exit.
                        if (navSession) return;
                        setMobilePanel(null);
                        setShowDirections((open) => {
                          if (open) setActiveRoute(null);
                          return !open;
                        });
                        return;
                      }
                      setMobilePanel(mobilePanel === tab.id ? null : tab.id);
                    }}
                    aria-pressed={active}
                    disabled={isRoute && Boolean(navSession)}
                    className={`mobile-nav-btn ${active ? 'active' : ''}`}
                  >
                    <tab.icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mobile Drawer */}
          <AnimatePresence>
            {mobilePanel && (
              <motion.div
                initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className={`fixed bottom-[52px] left-0 right-0 z-[400] glass-panel ${mobilePanel === 'oi' ? 'oi-glass' : ''} rounded-b-none overflow-y-auto styled-scrollbar`}
                style={{ maxHeight: 'min(55vh, calc(100dvh - 100px))', paddingBottom: 'env(safe-area-inset-bottom, 4px)' }}
              >
                <div className="mobile-drawer-handle" />
                <div className="px-3 pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="hud-text text-[10px] text-[var(--text-primary)]">
                      {mobilePanel === 'layers' ? 'LAYERS & STATS' : mobilePanel === 'markets' ? 'MARKETS & INTEL' : mobilePanel === 'intel' ? 'INTEL FEED' : mobilePanel === 'remote' ? 'WORLD REMOTE' : mobilePanel === 'oi' ? 'GLASS EARTH OI' : mobilePanel === 'tv' ? 'TELEVISION & THEATER' : 'SEARCH'}
                    </span>
                    <button onClick={() => setMobilePanel(null)} className="text-[var(--text-muted)] p-1"><X className="w-4 h-4" /></button>
                  </div>
                  {mobilePanel === 'tv' && (
                    <div className="space-y-2 pb-1">
                      <button
                        onClick={() => { setMobilePanel(null); takeMeSomewhereLive(); }}
                        className="flex w-full items-center gap-3 border border-white/10 bg-white/[0.03] px-3 py-3 text-left"
                      >
                        <Dices className="h-4 w-4 shrink-0 text-[var(--gold-primary)]" />
                        <span>
                          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">Take me somewhere live</span>
                          <span className="block font-mono text-[8px] uppercase tracking-wider text-[var(--text-muted)]">{cameraCount > 0 ? 'A random live camera — somewhere on Earth' : 'Camera catalogue still loading…'}</span>
                        </span>
                      </button>
                      <button
                        onClick={() => { setMobilePanel(null); setShowTv(true); }}
                        className="flex w-full items-center gap-3 border border-white/10 bg-white/[0.03] px-3 py-3 text-left"
                      >
                        <Tv className="h-4 w-4 shrink-0 text-[var(--gold-primary)]" />
                        <span>
                          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">Television</span>
                          <span className="block font-mono text-[8px] uppercase tracking-wider text-[var(--text-muted)]">Live news · multiview · Pluto, Tubi & more</span>
                        </span>
                      </button>
                      <button
                        onClick={() => { setMobilePanel(null); setShowWall(true); }}
                        className="flex w-full items-center gap-3 border border-white/10 bg-white/[0.03] px-3 py-3 text-left"
                      >
                        <LayoutGrid className="h-4 w-4 shrink-0 text-[var(--gold-primary)]" />
                        <span>
                          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">Camera Theater</span>
                          <span className="block font-mono text-[8px] uppercase tracking-wider text-[var(--text-muted)]">A wall of live cameras — Texas / El Paso first</span>
                        </span>
                      </button>
                      <button
                        onClick={() => { setMobilePanel(null); setShowStations(true); }}
                        className="flex w-full items-center gap-3 border border-white/10 bg-white/[0.03] px-3 py-3 text-left"
                      >
                        <RadioTower className="h-4 w-4 shrink-0 text-[#00E5FF]" />
                        <span>
                          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">TV & Radio Stations</span>
                          <span className="block font-mono text-[8px] uppercase tracking-wider text-[var(--text-muted)]">World channels · internet radio · IPTV-org + Radio Browser</span>
                        </span>
                      </button>
                      <button
                        onClick={() => { setMobilePanel(null); setTvWallSeed({ channels: [], favorites: loadTvFavorites() }); setShowTvWall(true); }}
                        className="flex w-full items-center gap-3 border border-white/10 bg-white/[0.03] px-3 py-3 text-left"
                      >
                        <LayoutGrid className="h-4 w-4 shrink-0 text-[var(--gold-primary)]" />
                        <span>
                          <span className="block font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)]">TV Wall</span>
                          <span className="block font-mono text-[8px] uppercase tracking-wider text-[var(--text-muted)]">A wall of live TV channels — world news first</span>
                        </span>
                      </button>
                      <p className="px-1 font-mono text-[8px] uppercase tracking-wider text-[var(--text-muted)]">
                        Both open full-screen — the way a wall of cameras and a television should.
                      </p>
                    </div>
                  )}
                  {mobilePanel === 'layers' && (
                    <>
                      <div className="glass-panel-sm p-2 mb-2">
                        <div className="grid grid-cols-5 gap-1 text-center">
                          <div><div className="hud-label" style={{fontSize:'9px'}}>AIR</div><div className="hud-value text-[10px]">{totalFlights.toLocaleString()}</div></div>
                          <div><div className="hud-label" style={{fontSize:'9px'}}>SAT</div><div className="hud-value text-[10px]">{(data.satellites?.length||0)}</div></div>
                          <div><div className="hud-label" style={{fontSize:'9px'}}>CAM</div><div className="hud-value text-[10px]">{(data.cameras?.length||0)}</div></div>
                          <div><div className="hud-label" style={{fontSize:'9px'}}>WX</div><div className="hud-value text-[10px]" style={{color:'var(--accent-weather)'}}>{(data.weather_events?.length||0)}</div></div>
                          <div><div className="hud-label" style={{fontSize:'9px'}}>NUC</div><div className="hud-value text-[10px]" style={{color:'var(--accent-nuclear)'}}>{(data.infrastructure?.length||0)}</div></div>
                        </div>
                      </div>
                      <LayerPanel {...terrainPanelProps} data={data} activeLayers={activeLayers} setActiveLayers={setActiveLayers} isMobile={true} theme={osirisTheme} setTheme={setOsirisTheme} capabilities={capabilities} liveStatus={layerLiveStatus} />
                      <div className="mt-8">
                        <ViewPresets onNavigate={(lat, lng, zoom) => { setFlyToLocation({ lat, lng, zoom, ts: Date.now() }); setMobilePanel(null); }} />
                      </div>
                    </>
                  )}
                  {mobilePanel === 'markets' && <MarketsPanel data={data} spaceWeather={spaceWeather} />}
                  {mobilePanel === 'oi' && (
                    <OiPanel oi={oi} selected={oiSelected} onSelect={setOiSelected} embedded focus={oiFocus} onFocus={toggleOiFocus}
                      onLocate={handleOiLocate} following={oiFollowing} onFollow={followOi}
                      assist={assist} mode={oiMode} onMode={setOiMode} speakOn={oiVoice} onSpeak={setOiVoicePersist}
                      stage={oiStage} onStage={setOiStage} />
                  )}
                  {mobilePanel === 'intel' && <IntelFeed data={data} onLocate={(lat, lng) => { setFlyToLocation({ lat, lng, ts: Date.now() }); setMobilePanel(null); }} />}
                  {mobilePanel === 'search' && (
                    <div className="space-y-2">
                      <SearchBar embedded center={mapCenter} onDirections={openDirectionsTo} onLocate={(lat, lng, zoom) => { setFlyToLocation({ lat, lng, zoom, ts: Date.now() }); setMobilePanel(null); }} />
                      <SharePanel view={shareView} activeLayers={activeLayers} cameraId={shareCameraId} cameraName={shareCameraName} />
                    </div>
                  )}
                  {mobilePanel === 'remote' && (
                    <WorldRemote onClose={() => setMobilePanel(null)} onPlaceOnMap={(devs) => {
                      setScanTargets(prev => {
                        const ids = new Set(prev.map((t: any) => t.id));
                        const next = [...prev];
                        devs.forEach(d => { if (!ids.has(d.id)) next.unshift({ id: d.id, name: d.name, lat: d.lat, lng: d.lng, type: d.type, color: d.color, timestamp: Date.now(), source: 'BLE' }); });
                        return next.slice(0, 20);
                      });
                      if (devs.length > 0) setFlyToLocation({ lat: devs[0].lat, lng: devs[0].lng, ts: Date.now() });
                    }} />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* ── ROULETTE FAB (mobile/touch) ── */}
      {/* The dice lives in the TV drawer on mobile, which is one drawer too
          deep on a tablet. A floating button puts it on the map itself —
          no drawer to open. Hidden while a drawer, the planner, or
          guidance is open, and until the HUD reveals. */}
      {shouldShowRouletteFab({ isMobile, mobilePanel, showDirections, navSession }) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: revealed ? 1 : 0 }} transition={hudIn(0.3)} className="fixed z-[300] pointer-events-auto" style={{ bottom: 'calc(68px + env(safe-area-inset-bottom, 0px))', right: '12px' }}>
          <button onClick={takeMeSomewhereLive} aria-label="Take me somewhere live" title={roulette.title} className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-panel)] shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
            <span className="relative block">
              <Dices className={`h-5 w-5 ${spooky ? 'text-[#FF7518]' : 'text-[var(--gold-primary)]'} ${roulette.ready ? '' : 'opacity-40'}`} />
              {!roulette.ready && (
                <span aria-hidden="true" className="absolute -right-1 -top-1 block h-2 w-2 rounded-full border border-[var(--text-muted)] border-t-transparent animate-spin" />
              )}
            </span>
          </button>
        </motion.div>
      )}

      {/* ── BACK FAB (mobile/touch) ── */}
      {/* The mirror of the roulette FAB, on the left: Back has to be one tap
          on a tablet too, with no drawer to open. Dimmed while there is
          nowhere to go back to, like the desktop strip button. */}
      {isMobile && !mobilePanel && !showDirections && !navSession && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: revealed ? 1 : 0 }} transition={hudIn(0.3)} className="fixed z-[300] pointer-events-auto" style={{ bottom: 'calc(68px + env(safe-area-inset-bottom, 0px))', left: '12px' }}>
          <button onClick={goBackView} disabled={!canGoBack} aria-label="Back to previous view" title={canGoBack ? 'Back — return to the previous view' : 'Back — no previous view yet'} className={`flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-panel)] shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur-2xl ${canGoBack ? '' : 'opacity-35'}`}>
            <ArrowLeft className="h-5 w-5 text-[var(--gold-primary)]" />
          </button>
        </motion.div>
      )}

      {/* ── BOTTOM CURSOR INFO (desktop) ── */}
      {!isMobile && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: revealed ? 1 : 0 }} transition={hudIn(0.6)} className="desktop-only absolute bottom-8 z-[200] pointer-events-auto" style={{ left: '72px' }}>
          <div className="flex items-center gap-5 text-[9px] font-mono tracking-widest text-[var(--text-muted)] opacity-60">
            <div className="flex gap-2 items-center" title="Cursor coordinates (hover over map)">
              <span>CURSOR</span>
              <span ref={coordsDisplayRef} className="text-[var(--gold-primary)] font-bold tabular-nums">—</span>
            </div>
            <div className="flex gap-2 items-center" title="Reverse-geocoded location name">
              <span>LOCATION</span>
              <span className="text-[var(--cyan-primary)] truncate max-w-[200px]">{locationLabel || 'HOVER MAP'}</span>
            </div>
            <div className="flex gap-2 items-center" title="Current zoom level">
              <span>ZOOM</span>
              <span className="text-[var(--gold-primary)] font-bold tabular-nums">{mapView.zoom.toFixed(1)}</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Scale bar is now integrated into the map controls section above */}

      {/* ── Region Dossier ── */}
      {(regionDossier || dossierLoading) && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="absolute top-16 md:top-20 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[300] md:w-[480px] max-h-[65vh] overflow-y-auto styled-scrollbar">
          <div className="glass-panel p-5 osiris-glow">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-mono font-bold text-[var(--gold-primary)] tracking-wider">REGION DOSSIER</h2>
              <button onClick={() => { setRegionDossier(null); setDossierLoading(false); }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs">✕</button>
            </div>
            {dossierLoading ? (
              <div className="text-center py-8">
                <div className="w-5 h-5 border-2 border-[var(--gold-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <span className="text-[9px] font-mono text-[var(--text-muted)] tracking-widest">COMPILING INTEL...</span>
              </div>
            ) : regionDossier && (
              <div className="space-y-3">
                <div><div className="hud-label mb-0.5">LOCATION</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.location?.display_name}</div></div>
                {regionDossier.country && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><div className="hud-label mb-0.5">COUNTRY</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.flag} {regionDossier.country.name}</div></div>
                    <div><div className="hud-label mb-0.5">CAPITAL</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.capital}</div></div>
                    <div><div className="hud-label mb-0.5">POPULATION</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.population?.toLocaleString()}</div></div>
                    <div><div className="hud-label mb-0.5">REGION</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.subregion || regionDossier.country.region}</div></div>
                    <div><div className="hud-label mb-0.5">LANGUAGES</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.languages?.join(', ')}</div></div>
                    <div><div className="hud-label mb-0.5">AREA</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.area?.toLocaleString()} km²</div></div>
                  </div>
                )}
                {regionDossier.head_of_state && (<div><div className="hud-label mb-0.5">HEAD OF STATE</div><div className="text-xs text-[var(--gold-primary)]">{regionDossier.head_of_state.name}</div><div className="text-[9px] text-[var(--text-muted)]">{regionDossier.head_of_state.position}</div></div>)}
                {regionDossier.wikipedia && (<div><div className="hud-label mb-1">INTELLIGENCE BRIEF</div><div className="flex gap-3">{regionDossier.wikipedia.thumbnail && <img src={regionDossier.wikipedia.thumbnail} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" />}<p className="text-[9px] text-[var(--text-secondary)] leading-relaxed">{regionDossier.wikipedia.extract}</p></div></div>)}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Camera Viewer ── */}
      <CameraViewer
        camera={activeCamera}
        onClose={() => setActiveCamera(null)}
        onLocate={(lat, lng) => setFlyToLocation({ lat, lng, ts: Date.now() })}
        besideOi={showOi && !oiTheater}
      />

      {/* ── Camera Theater + Ambient TV ──
          The wall hands cameras to the full viewer above: it closes first,
          because the viewer is the place with the resolver and the analysis,
          and the wall's picks are persisted so nothing is lost by leaving. */}
      {showWall && (
        <TheaterWall
          cameras={data.cameras ?? []}
          onClose={() => setShowWall(false)}
          onOpenCamera={(cam) => { setShowWall(false); setActiveCamera(cam); }}
          onAmbient={() => { setShowWall(false); setShowAmbient(true); }}
        />
      )}
      {showAmbient && (
        <AmbientTv cameras={data.cameras ?? []} onExit={() => setShowAmbient(false)} />
      )}

      {/* ── Television panel ── */}
      {showTv && (
        <TvPanel
          feeds={data.live_feeds ?? []}
          services={data.tv_services ?? []}
          onClose={() => setShowTv(false)}
        />
      )}

      {/* ── Stations panel (IPTV-org TV + Radio Browser) ── */}
      {showStations && (
        <StationsPanel
          onClose={() => setShowStations(false)}
          onPlayRadio={(station) => setRadioStation(station)}
          currentRadioUuid={radioStation?.uuid ?? null}
          onOpenTvWall={(channels, favorites) => { setTvWallSeed({ channels, favorites }); setShowStations(false); setShowTvWall(true); }}
        />
      )}

      {/* ── TV Wall ── */}
      {showTvWall && (
        <TvWall
          channels={tvWallSeed.channels}
          favorites={tvWallSeed.favorites}
          onClose={() => setShowTvWall(false)}
        />
      )}

      {/* ── Radio now-playing bar — page-level so it survives the panel ── */}
      {radioStation && (
        <RadioNowPlaying station={radioStation} onStop={() => setRadioStation(null)} />
      )}

      {/* ── Plane Spotting panel ── */}
      {showSpotting && (
        <PlaneSpottingPanel
          onClose={() => setShowSpotting(false)}
          onFlyTo={(lat, lng) => setFlyToLocation({ lat, lng, ts: Date.now() })}
        />
      )}

      {/* ── Entity Graph Panel ── */}
      {/* Guidance belongs over the map, where the clicking happens. */}
      {drawMode && (
        <DrawHud
          mode={drawMode}
          progress={drawProgress}
          onUndo={() => sendDraw('undo')}
          onFinish={() => sendDraw('finish')}
          onCancel={() => { sendDraw('cancel'); setDrawMode(null); setDrawProgress(null); }}
        />
      )}

      {showDrawing && (
        <div className="absolute right-12 top-1/2 -translate-y-1/2 z-[400] w-80 pointer-events-auto">
          <DrawingToolbar
            drawMode={drawMode}
            onSetDrawMode={setDrawMode}
            progress={drawProgress}
            polygons={drawnPolygons}
            onDeletePolygon={(id) => setDrawnPolygons(p => p.filter(x => x.id !== id))}
            onClearAll={() => { setDrawnPolygons([]); setSelectedPolygon(null); }}
            onExportGeoJSON={handleExportGeoJSON}
            selectedPolygon={selectedPolygon}
            onSelectPolygon={setSelectedPolygon}
            onRenamePolygon={(id, name) => setDrawnPolygons(p => p.map(x => x.id === id ? { ...x, name } : x))}
            data={data}
            onLocateEntity={(lat, lng) => setFlyToLocation({ lat, lng, zoom: 12, ts: Date.now() })}
            watched={watched}
            onToggleWatch={toggleWatch}
            watchEvents={watchEvents}
          />
        </div>
      )}

      {/* ── OVERLAYS ── */}
      <div className="vignette absolute inset-0 pointer-events-none z-[2]" />
      <div className="crt-scanlines absolute inset-0 pointer-events-none z-[3] opacity-[0.02]" />
      {/* Corner frames — using explicit classes for Tailwind JIT compatibility */}
      {[
        { pos: 'top-0 left-0', vAnchor: 'top-0', hAnchor: 'left-0', hGrad: 'bg-gradient-to-r', vGrad: 'bg-gradient-to-b' },
        { pos: 'top-0 right-0', vAnchor: 'top-0', hAnchor: 'right-0', hGrad: 'bg-gradient-to-l', vGrad: 'bg-gradient-to-b' },
        { pos: 'bottom-0 left-0', vAnchor: 'bottom-0', hAnchor: 'left-0', hGrad: 'bg-gradient-to-r', vGrad: 'bg-gradient-to-t' },
        { pos: 'bottom-0 right-0', vAnchor: 'bottom-0', hAnchor: 'right-0', hGrad: 'bg-gradient-to-l', vGrad: 'bg-gradient-to-t' },
      ].map((c, i) => (
        <div key={i} className={`absolute ${c.pos} w-16 h-16 pointer-events-none z-[1]`}>
          <div className={`absolute ${c.vAnchor} ${c.hAnchor} w-full h-[1px] ${c.hGrad} from-[var(--gold-primary)]/30 to-transparent`} />
          <div className={`absolute ${c.vAnchor} ${c.hAnchor} w-[1px] h-full ${c.vGrad} from-[var(--gold-primary)]/30 to-transparent`} />
        </div>
      ))}

      {/* Keyboard Shortcuts Overlay */}
      <KeyboardShortcuts />

      {/* ── GLOBAL STATUS TICKER (bottom) ── */}
      <div data-hud><GlobalStatusBar revealed={revealed} /></div>

      {/* Shortcut hint — more visible */}
      <div className="desktop-only absolute bottom-[26px] right-5 z-[200] pointer-events-none text-[9px] font-mono text-[var(--text-muted)] opacity-50 tracking-widest" title="Press ? to see all keyboard shortcuts">
        Press <span className="text-[var(--gold-primary)] opacity-80">?</span> for shortcuts · <span className="text-[var(--gold-primary)] opacity-80">F</span> fullscreen · <span className="text-[var(--gold-primary)] opacity-80">R</span> reset view
      </div>


    </main>
  );
}
