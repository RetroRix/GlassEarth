'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bell, BellRing, Plane, Rocket, Satellite, X } from 'lucide-react';
import {
  applyFired, evaluateIssPasses, evaluateLaunches, evaluateQuakes,
  loadSmartAlertsRecord, newAlerts, saveSmartAlertsRecord, unreadCount,
  type Anchor, type IssPassLike, type LaunchLike, type QuakeLike,
  type SmartAlert, type SmartAlertPrefs, type SmartAlertsRecord,
} from '@/lib/smart-alerts';
import { rateNearMe, type HeatLike } from '@/lib/near-me';
import { evaluateNotableAircraft, type FlightLike } from '@/lib/notable-aircraft';

const ISS_NORAD = '25544';
const CHECK_EVERY_MS = 5 * 60_000;

/** The raw feed snapshots from the engine's latest check — the NEAR ME
    card scores these. null = the feed didn't answer this check. */
export interface SmartAlertFeeds {
  quakes: QuakeLike[] | null;
  quakesAt: number | null;
  passes: IssPassLike[] | null;
  passesAt: number | null;
  launches: LaunchLike[] | null;
  launchesAt: number | null;
}

const EMPTY_FEEDS: SmartAlertFeeds = {
  quakes: null, quakesAt: null, passes: null, passesAt: null, launches: null, launchesAt: null,
};

export interface SmartAlertsEngine {
  record: SmartAlertsRecord;
  unread: number;
  lastCheckAt: number | null;
  feeds: SmartAlertFeeds;
  permission: NotificationPermission | 'unsupported';
  updatePrefs: (patch: Partial<SmartAlertPrefs>) => void;
  markSeen: () => void;
  clearHistory: () => void;
  enableNotifications: () => Promise<void>;
}

/**
 * The engine: polls the app's existing feeds on an interval, evaluates the
 * visitor's rules in lib/smart-alerts, remembers what already fired (so an
 * event alerts once, ever) and — only when the visitor opted in AND the
 * browser granted permission — raises a browser notification per new alert.
 * Runs at page level so alerts accumulate whether or not the panel is open.
 * It can only check while the tab is open; the panel says so plainly.
 */
export function useSmartAlertsEngine(anchor: Anchor | null): SmartAlertsEngine {
  const [record, setRecord] = useState<SmartAlertsRecord>(() => loadSmartAlertsRecord());
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);
  const [feeds, setFeeds] = useState<SmartAlertFeeds>(EMPTY_FEEDS);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    () => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'),
  );
  const recordRef = useRef(record);
  useEffect(() => { recordRef.current = record; }, [record]);
  const checkingRef = useRef(false);

  const persist = useCallback((next: SmartAlertsRecord) => {
    recordRef.current = next;
    setRecord(next);
    saveSmartAlertsRecord(next);
  }, []);

  const anchorKey = anchor ? `${anchor.lat.toFixed(3)},${anchor.lng.toFixed(3)}` : '';
  const prefs = record.prefs;
  const prefsKey = JSON.stringify(prefs);

  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const now = Date.now();
      const current = recordRef.current;
      const p = current.prefs;
      const candidates: SmartAlert[] = [];
      const jobs: Promise<void>[] = [];
      /* Snapshots for the NEAR ME card: the feeds are read on every check
         whether or not their alert toggle is on (the card is a summary of
         the same feeds, not an alert); the toggles still gate the alerts. */
      const snap: SmartAlertFeeds = { ...EMPTY_FEEDS };

      if (anchor) {
        jobs.push(
          fetch('/api/earthquakes', { signal: AbortSignal.timeout(10_000) })
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
              if (Array.isArray(d?.earthquakes)) {
                snap.quakes = d.earthquakes; snap.quakesAt = now;
                if (p.quakesEnabled) candidates.push(...evaluateQuakes(d.earthquakes, anchor, p, now));
              }
            })
            .catch(() => { /* a failed feed produces no alerts, never fake ones */ }),
        );
        jobs.push(
          fetch(`/api/satellites/passes?id=${ISS_NORAD}&lat=${anchor.lat}&lng=${anchor.lng}`, { signal: AbortSignal.timeout(10_000) })
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
              if (Array.isArray(d?.passes)) {
                snap.passes = d.passes; snap.passesAt = now;
                if (p.issEnabled) candidates.push(...evaluateIssPasses(d.passes, anchor, p, now));
              }
            })
            .catch(() => { /* as above */ }),
        );
      }
      jobs.push(
        fetch('/api/launches', { signal: AbortSignal.timeout(15_000) })
          .then(r => (r.ok ? r.json() : null))
          .then(d => {
            if (Array.isArray(d?.launches)) {
              snap.launches = d.launches; snap.launchesAt = now;
              if (p.launchesEnabled) candidates.push(...evaluateLaunches(d.launches, p, now));
            }
          })
          .catch(() => { /* as above */ }),
      );
      if (p.aircraftEnabled) {
        jobs.push(
          fetch('/api/flights', { signal: AbortSignal.timeout(15_000) })
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
              if (!d) return;
              const rows: FlightLike[] = [];
              for (const key of ['commercial_flights', 'private_flights', 'private_jets', 'military_flights']) {
                if (Array.isArray(d[key])) rows.push(...d[key]);
              }
              if (rows.length) candidates.push(...evaluateNotableAircraft(rows, now));
            })
            .catch(() => { /* as above — a silent feed simply spots nothing */ }),
        );
      }

      await Promise.all(jobs);
      setFeeds(snap);
      const fresh = newAlerts(candidates, recordRef.current);
      if (fresh.length) {
        persist(applyFired(recordRef.current, fresh, now));
        if (p.notifications && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          for (const a of fresh) {
            try {
              new Notification(a.title, { body: a.body, tag: a.id });
            } catch { /* notification construction can throw on some mobile browsers; in-app list still has it */ }
          }
        }
      }
      setLastCheckAt(now);
    } finally {
      checkingRef.current = false;
    }
    // anchorKey/prefsKey stand in for the objects so a pan doesn't re-fire checks;
    // the interval below is the steady cadence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, prefsKey, persist]);

  useEffect(() => {
    void check();
    const iv = setInterval(() => void check(), CHECK_EVERY_MS);
    return () => clearInterval(iv);
  }, [check]);

  const updatePrefs = useCallback((patch: Partial<SmartAlertPrefs>) => {
    const current = recordRef.current;
    persist({ ...current, prefs: { ...current.prefs, ...patch } });
  }, [persist]);

  const markSeen = useCallback(() => {
    persist({ ...recordRef.current, lastSeenAt: Date.now() });
  }, [persist]);

  const clearHistory = useCallback(() => {
    const current = recordRef.current;
    persist({ ...current, history: [], lastSeenAt: Date.now() });
  }, [persist]);

  const enableNotifications = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      updatePrefs({ notifications: result === 'granted' });
    } catch { /* permission prompt unavailable; the toggle simply stays off */ }
  }, [updatePrefs]);

  return {
    record,
    unread: unreadCount(record),
    lastCheckAt,
    feeds,
    permission,
    updatePrefs,
    markSeen,
    clearHistory,
    enableNotifications,
  };
}

const KIND_ICON = {
  quake: Activity,
  iss: Satellite,
  launch: Rocket,
  aircraft: Plane,
} as const;

const KIND_COLOR = {
  quake: '#FF7043',
  iss: '#7DD3FC',
  launch: '#FF6D00',
  aircraft: '#B39DDB',
} as const;

function ago(at: number, now: number): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded border border-white/10 px-2 py-2 text-left transition-colors hover:bg-white/5"
      aria-pressed={on}
    >
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: on ? '#4ADE80' : 'rgba(255,255,255,0.25)' }}
      />
      <span className="flex-1">
        <span className="block font-mono text-[11px] uppercase tracking-wider text-white">{label}</span>
        <span className="block text-[9px] text-white/40">{hint}</span>
      </span>
      <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: on ? '#4ADE80' : 'rgba(255,255,255,0.35)' }}>
        {on ? 'On' : 'Off'}
      </span>
    </button>
  );
}

function Choice({ value, options, onChange, label }: {
  value: number;
  options: { value: number; label: string }[];
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 px-1 py-1">
      <span className="text-[10px] text-white/50">{label}</span>
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="rounded border border-white/15 bg-[#111] px-1.5 py-1 font-mono text-[10px] text-white"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

interface PanelProps {
  engine: SmartAlertsEngine;
  anchor: Anchor | null;
  /** NASA FIRMS heat detections the page has already loaded for the
      Fires layer — the NEAR ME card scores them only when present. */
  fires?: HeatLike[] | null;
  onClose: () => void;
  onLocate: (lat: number, lng: number) => void;
}

const NEAR_ME_COLOR = { QUIET: '#4ADE80', WATCH: '#FFD54F', ELEVATED: '#FF7043' } as const;

function NearMeCard({ engine, anchor, fires, now }: {
  engine: SmartAlertsEngine;
  anchor: Anchor | null;
  fires: HeatLike[] | null;
  now: number;
}) {
  const feeds = engine.feeds;
  const result = useMemo(() => (anchor
    ? rateNearMe({ anchor, quakes: feeds.quakes, passes: feeds.passes, launches: feeds.launches, fires, now })
    : null), [anchor, feeds, fires, now]);
  const checked: string[] = [];
  if (feeds.quakesAt) checked.push(`quakes ${ago(feeds.quakesAt, now)}`);
  if (feeds.passesAt) checked.push(`ISS times ${ago(feeds.passesAt, now)}`);
  if (feeds.launchesAt) checked.push(`launches ${ago(feeds.launchesAt, now)}`);

  return (
    <div className="border-b border-white/10 px-3 py-3" data-testid="near-me-card">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/35">Near me · 500 km</span>
        {anchor && <span className="font-mono text-[8px] uppercase tracking-wider text-white/30">around {anchor.label}</span>}
      </div>
      {!anchor || !result ? (
        <div className="mt-1.5 font-mono text-[11px] leading-relaxed text-white/40">
          NEAR ME needs a location anchor — once the app knows where “near” is, this card rates what the feeds show around it.
        </div>
      ) : (
        <>
          <div className="mt-1 font-mono text-[26px] font-bold leading-none tracking-[0.15em]" style={{ color: NEAR_ME_COLOR[result.level] }}>
            {result.level}
          </div>
          {result.reasons.length === 0 ? (
            <div className="mt-1.5 text-[10px] leading-relaxed text-white/50">Nothing on the feeds stands out right now.</div>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {result.reasons.map(r => (
                <li key={r} className="text-[10px] leading-relaxed text-white/70">• {r}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 font-mono text-[8px] leading-relaxed text-white/35">
            {result.inputs.map(i => <div key={i}>{i}</div>)}
            <div className="mt-1 text-white/45">
              A plain-English summary of these feeds — not an official risk level or warning.
              {checked.length ? ` Checked: ${checked.join(' · ')}.` : ' First check still running.'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function SmartAlertsPanel({ engine, anchor, fires = null, onClose, onLocate }: PanelProps) {
  const { record, permission } = engine;
  const prefs = record.prefs;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const history = useMemo(() => record.history, [record.history]);

  return (
    <div className="fixed bottom-0 right-0 top-0 z-[940] flex w-[min(430px,100vw)] flex-col border-l border-white/10 bg-[#0a0a0a]/[0.98] shadow-2xl" data-testid="smart-alerts-panel">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Bell className="h-4 w-4 text-[#FFD54F]" />
        <span className="font-mono text-[12px] font-bold tracking-[0.25em] text-white">SMART ALERTS</span>
        <button onClick={onClose} className="ml-auto rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close smart alerts panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-white/5 px-3 py-2 font-mono text-[9px] leading-relaxed text-white/40">
          {anchor
            ? <>Watching around <span className="text-white/70">{anchor.label}</span>. </>
            : <>No location anchor yet — quake and ISS alerts wait for one. </>}
          Checks run every few minutes <span className="text-white/70">while this tab is open</span>
          {engine.lastCheckAt ? <> · last check {ago(engine.lastCheckAt, now)}</> : null}.
        </div>

        <NearMeCard engine={engine} anchor={anchor} fires={fires} now={now} />

        <div className="px-3 pb-1 pt-3 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/35">
          Alerts · newest first
        </div>
        {history.length === 0 && (
          <div className="px-3 py-4 font-mono text-[11px] leading-relaxed text-white/40">
            No alerts yet. When a quake, ISS pass or launch matches your settings below, it lands here — and only ever once per event.
          </div>
        )}
        {history.map(a => {
          const Icon = KIND_ICON[a.kind];
          return (
            <div key={a.id} className="border-b border-white/5 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: KIND_COLOR[a.kind] }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium leading-snug text-white">{a.title}</div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-white/50">{a.body}</div>
                  <div className="mt-1 flex items-center gap-3">
                    <span className="font-mono text-[8px] uppercase tracking-wider text-white/30">{ago(a.firedAt, now)}</span>
                    {typeof a.lat === 'number' && typeof a.lng === 'number' && (
                      <button onClick={() => onLocate(a.lat!, a.lng!)} className="font-mono text-[8px] uppercase tracking-wider text-[#7DD3FC] hover:underline">
                        Show on map
                      </button>
                    )}
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer" className="font-mono text-[8px] uppercase tracking-wider text-[#7DD3FC] hover:underline">
                        USGS report
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {history.length > 0 && (
          <button onClick={engine.clearHistory} className="mx-3 mt-2 font-mono text-[9px] uppercase tracking-wider text-white/35 hover:text-white/70">
            Clear alert history
          </button>
        )}

        <div className="px-3 pb-1 pt-4 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/35">
          What to watch
        </div>
        <div className="flex flex-col gap-2 px-3">
          <Toggle on={prefs.quakesEnabled} onClick={() => engine.updatePrefs({ quakesEnabled: !prefs.quakesEnabled })}
            label="Earthquakes near you" hint="From the USGS feed (M2.5+, last 24 h)" />
          {prefs.quakesEnabled && (
            <div>
              <Choice label="Minimum magnitude" value={prefs.quakeMinMagnitude} onChange={v => engine.updatePrefs({ quakeMinMagnitude: v })}
                options={[2.5, 3.5, 4.5, 5.5, 6.5].map(v => ({ value: v, label: `M${v.toFixed(1)}+` }))} />
              <Choice label="Within" value={prefs.quakeRadiusKm} onChange={v => engine.updatePrefs({ quakeRadiusKm: v })}
                options={[50, 100, 250, 500, 1000].map(v => ({ value: v, label: `${v} km` }))} />
            </div>
          )}
          <Toggle on={prefs.issEnabled} onClick={() => engine.updatePrefs({ issEnabled: !prefs.issEnabled })}
            label="ISS passes" hint="From Look Up! pass times for your anchor" />
          {prefs.issEnabled && (
            <div>
              <Choice label="Alert ahead of the pass" value={prefs.issLeadMinutes} onChange={v => engine.updatePrefs({ issLeadMinutes: v })}
                options={[15, 30, 60, 120].map(v => ({ value: v, label: `${v} min` }))} />
              <Toggle on={prefs.issVisibleOnly} onClick={() => engine.updatePrefs({ issVisibleOnly: !prefs.issVisibleOnly })}
                label="Visible passes only" hint="Off = every overhead pass, labelled as not visible" />
            </div>
          )}
          <Toggle on={prefs.launchesEnabled} onClick={() => engine.updatePrefs({ launchesEnabled: !prefs.launchesEnabled })}
            label="Rocket launches" hint="Launch Library 2 — NET times, feed status verbatim" />
          {prefs.launchesEnabled && (
            <Choice label="Alert when NET is within" value={prefs.launchWithinHours} onChange={v => engine.updatePrefs({ launchWithinHours: v })}
              options={[6, 12, 24, 48].map(v => ({ value: v, label: `${v} h` }))} />
          )}
          <Toggle on={prefs.aircraftEnabled} onClick={() => engine.updatePrefs({ aircraftEnabled: !prefs.aircraftEnabled })}
            label="Notable aircraft" hint="E-4B, RC-135, B-52, B-2, tankers, Air Force One / SAM callsigns — spotted on the ADS-B feed" />
          {prefs.aircraftEnabled && (
            <p className="px-1 text-[9px] leading-relaxed text-white/40">
              A sighting is just that — one aircraft broadcasting where the feed can hear it. Many such flights
              never broadcast, or fly filtered: silence never means none are flying.
            </p>
          )}
          <div className="rounded border border-white/10 px-2 py-2">
            <div className="flex items-center gap-2">
              <BellRing className="h-3.5 w-3.5 text-white/60" />
              <span className="flex-1 font-mono text-[11px] uppercase tracking-wider text-white">Browser notifications</span>
            </div>
            <p className="mt-1 text-[9px] leading-relaxed text-white/40">
              {permission === 'unsupported'
                ? 'This browser does not support notifications; alerts still collect here.'
                : permission === 'denied'
                  ? 'Notifications are blocked in this browser’s settings; alerts still collect here.'
                  : permission === 'granted'
                    ? prefs.notifications
                      ? 'On — new alerts also pop up as browser notifications while this tab is open.'
                      : 'The browser allows notifications; turn them on to get pop-ups for new alerts.'
                    : 'Off until you turn them on — the browser will ask once.'}
            </p>
            {permission === 'default' && (
              <button onClick={() => void engine.enableNotifications()} className="mt-2 rounded border border-white/20 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-white hover:bg-white/10">
                Enable notifications
              </button>
            )}
            {permission === 'granted' && (
              <button onClick={() => engine.updatePrefs({ notifications: !prefs.notifications })} className="mt-2 rounded border border-white/20 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-white hover:bg-white/10">
                {prefs.notifications ? 'Turn pop-ups off' : 'Turn pop-ups on'}
              </button>
            )}
          </div>
        </div>

        <div className="px-3 py-3 font-mono text-[9px] leading-relaxed text-white/30">
          Sources: USGS earthquake feed · ISS pass times from the Look Up! route (CelesTrak elements, propagated server-side) · Launch Library 2 / The Space Devs · aircraft as broadcast on the ADS-B feed (adsb.lol). Settings and alert history live only in this browser.
        </div>
      </div>
    </div>
  );
}
