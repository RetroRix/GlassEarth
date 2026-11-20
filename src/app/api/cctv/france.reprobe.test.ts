// TEMPORARY re-probe harness (2026-11-03) — deleted after the run.
import { it } from 'vitest';
import { fetchFranceCameras } from './france';

it('reprobe: fetch all France cameras live', async () => {
  const cams = await fetchFranceCameras();
  const bySource: Record<string, number> = {};
  for (const c of cams) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  console.log(`REPROBE TOTAL: ${cams.length}`);
  console.log('REPROBE BY SOURCE:', JSON.stringify(bySource, null, 2));
}, 240_000);
