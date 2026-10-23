import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — Wisconsin CCTV Cameras (WisDOT / 511wi.gov)
 * Source: https://www.511wi.gov — the same IBI 511 stack Louisiana and Nevada run
 * ~491 cameras statewide — NO API KEY NEEDED.
 *
 * Milwaukee, Madison and Green Bay plus the I-39, I-41, I-43, I-90 and I-94
 * corridors. No sampled row gates its video (isVideoAuthRequired is false)
 * and every sampled row carries a real .m3u8 playlist, so these come up as
 * video tiles with a snapshot behind them, like Arizona's open deployment.
 */
export const WISDOT: Ibi511Source = {
  base: 'https://www.511wi.gov',
  idPrefix: 'wisdot',
  source: 'WisDOT',
  state: 'Wisconsin',
  bounds: { minLat: 42.4, maxLat: 47.1, minLng: -92.9, maxLng: -86.8 },
};

export const fetchWisconsinCameras = cachedSource('wisconsin', () => loadIbi511Cameras(WISDOT));
