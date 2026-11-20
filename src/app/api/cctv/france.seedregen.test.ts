// TEMPORARY seed-regen harness (2026-11-03 re-probe) — deleted after the run.
// Uses the app's real fetchFranceCameras(); only the transport is throttled
// (sandbox egress proxy collapses under the app's normal concurrency) and the
// per-request abort clocks are relaxed for this sandbox run. Parsing,
// filtering and liveness semantics are 100% the app's own code.
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';

const realFetch = globalThis.fetch;
let active = 0;
const waiters: (() => void)[] = [];
const CONC = 3;
function acquire(): Promise<void> {
  return new Promise(res => {
    if (active < CONC) { active++; res(); }
    else waiters.push(() => { active++; res(); });
  });
}
function release() { active--; waiters.shift()?.(); }
globalThis.fetch = (async (input: never, init?: never) => {
  await acquire();
  try { return await realFetch(input, init); } finally { release(); }
}) as typeof fetch;

const realTimeout = AbortSignal.timeout.bind(AbortSignal);
(AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout =
  (ms: number) => realTimeout(Math.max(ms * 30, 180_000));

it('seed regen: fetch all France cameras live (throttled transport)', async () => {
  const { fetchFranceCameras } = await import('./france');
  const cams = await fetchFranceCameras();
  const bySource: Record<string, number> = {};
  for (const c of cams) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  console.log(`SEEDREGEN TOTAL: ${cams.length}`);
  console.log('SEEDREGEN BY SOURCE:', JSON.stringify(bySource, null, 2));
  writeFileSync(
    '/home/hatch/workspace/goals/glass-earth-all-in-one-live-dashboard/hidden_files/france-reprobe-2026-11-03/france-fresh.json',
    JSON.stringify(cams, null, 2),
  );
}, 900_000);
