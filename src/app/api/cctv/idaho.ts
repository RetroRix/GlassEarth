import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — Idaho CCTV Cameras (ITD / 511.idaho.gov)
 * Source: https://511.idaho.gov — the same IBI 511 stack Louisiana and Nevada run
 * ~457 cameras statewide — NO API KEY NEEDED.
 *
 * Boise and the Treasure Valley, Idaho Falls, Twin Falls and northern Idaho,
 * along I-15, I-84, I-86 and I-90. No sampled row publishes a videoUrl at
 * all, so these come up as snapshot cameras rather than video tiles.
 */
export const ITD: Ibi511Source = {
  base: 'https://511.idaho.gov',
  idPrefix: 'itd',
  source: 'ITD',
  state: 'Idaho',
  bounds: { minLat: 41.9, maxLat: 49.0, minLng: -117.3, maxLng: -111.0 },
};

export const fetchIdahoCameras = cachedSource('idaho', () => loadIbi511Cameras(ITD));
