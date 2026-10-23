import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — Connecticut CCTV Cameras (CTDOT / ctroads.org, CT Travel Smart)
 * Source: https://ctroads.org — the same IBI 511 stack Louisiana and Nevada run
 * ~350 cameras statewide — NO API KEY NEEDED.
 *
 * I-84, I-91 and I-95 end to end, plus the Hartford, New Haven and Stamford
 * approaches. Every row flags `isVideoAuthRequired` and the list feed
 * publishes no videoUrl at all, so these come up as snapshot cameras rather
 * than video tiles — the public JPEG at /map/Cctv/{id} is what plays.
 *
 * Rows name the place in `location` (`Cam 137 Waterbury I-84 EB W/O Exit 25
 * Hamilton Ave`) and carry a real city, so both survive into the label and
 * caption unchanged.
 */
export const CTDOT: Ibi511Source = {
  base: 'https://ctroads.org',
  idPrefix: 'ctdot',
  source: 'CTDOT',
  snapshotOnly: true,
  state: 'Connecticut',
  bounds: { minLat: 40.95, maxLat: 42.05, minLng: -73.75, maxLng: -71.75 },
};

export const fetchConnecticutCameras = cachedSource('connecticut', () => loadIbi511Cameras(CTDOT));
