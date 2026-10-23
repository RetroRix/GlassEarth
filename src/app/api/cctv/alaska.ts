import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — Alaska CCTV Cameras (Alaska DOT / 511.alaska.gov)
 * Source: https://511.alaska.gov — the same IBI 511 stack Louisiana and Nevada run
 * ~128 cameras statewide — NO API KEY NEEDED.
 *
 * Anchorage, Fairbanks, Juneau and the Seward, Parks, Glenn and Sterling
 * highways. No sampled row publishes a videoUrl at all, so these come up
 * as snapshot cameras rather than video tiles. Some sites carry several
 * views; the shared loader uses the first image, as it does everywhere.
 */
export const AKDOT: Ibi511Source = {
  base: 'https://511.alaska.gov',
  idPrefix: 'akdot',
  source: 'Alaska DOT',
  state: 'Alaska',
  bounds: { minLat: 54.5, maxLat: 71.4, minLng: -170.0, maxLng: -129.9 },
};

export const fetchAlaskaCameras = cachedSource('alaska', () => loadIbi511Cameras(AKDOT));
