import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — Pennsylvania CCTV Cameras (PennDOT / 511pa.com)
 * Source: https://www.511pa.com — the same IBI 511 stack Louisiana and Nevada run
 * ~1,564 cameras statewide — NO API KEY NEEDED.
 *
 * Statewide coverage including the Pittsburgh, Philadelphia and Harrisburg
 * metros and the I-76, I-80, I-81 and I-95 corridors. Their public JPEG
 * snapshots are available in the map; advertised HLS playlists require
 * authorization (every sampled row sets isVideoAuthRequired) and cannot
 * play here, so this deployment is snapshot-only like Florida and Georgia.
 */
export const PENNDOT: Ibi511Source = {
  base: 'https://www.511pa.com',
  idPrefix: 'penndot',
  source: 'PennDOT',
  snapshotOnly: true,
  state: 'Pennsylvania',
  bounds: { minLat: 39.7, maxLat: 42.3, minLng: -80.6, maxLng: -74.7 },
};

export const fetchPennsylvaniaCameras = cachedSource('pennsylvania', () => loadIbi511Cameras(PENNDOT));
