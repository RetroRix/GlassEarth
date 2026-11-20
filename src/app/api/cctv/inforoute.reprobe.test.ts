// TEMPORARY re-probe harness (2026-11-03) — deleted after the run.
import { it } from 'vitest';
import { fetchInforouteCameras } from './inforoute';

it('reprobe: fetch Inforoute cameras alone', async () => {
  const cams = await fetchInforouteCameras();
  const bySource: Record<string, number> = {};
  for (const c of cams) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  console.log(`INFOROUTE TOTAL: ${cams.length}`);
  console.log('INFOROUTE BY SOURCE:', JSON.stringify(bySource, null, 2));
}, 240_000);
