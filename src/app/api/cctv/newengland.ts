import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — New England CCTV Cameras (New England 511 / newengland511.org)
 * Source: https://newengland511.org — the same IBI 511 stack Louisiana and Nevada run
 * ~362 cameras across Vermont, New Hampshire and Maine — NO API KEY NEEDED.
 *
 * One regional deployment covering all three states: I-89, I-91 and I-93 in
 * Vermont and New Hampshire, and I-95 through Maine. No sampled row
 * publishes a videoUrl at all, so these come up as snapshot cameras rather
 * than video tiles. Rows name their own state in the feed, but the caption
 * of last resort for this combined deployment is 'New England'.
 */
export const NE511: Ibi511Source = {
  base: 'https://newengland511.org',
  idPrefix: 'ne511',
  source: 'New England 511',
  state: 'New England',
  bounds: { minLat: 42.7, maxLat: 47.5, minLng: -73.5, maxLng: -66.9 },
};

export const fetchNewEnglandCameras = cachedSource('newengland', () => loadIbi511Cameras(NE511));
