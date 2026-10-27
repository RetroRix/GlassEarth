/**
 * OSIRIS — the satellite basemap's reference overlay (hybrid satellite).
 *
 * The SAT basemap is Esri World_Imagery served as a bare raster over the
 * CARTO base style (see OsirisMap's satellite style switch). Bare imagery
 * carries no borders and no names, so the satellite view was hard to read
 * against the vector MAP view, which names everything. Rick, 2026-10-27:
 * "make the satellite layer include prominent borders and city names and
 * such, the same as the non-satellite layer."
 *
 * Esri publishes two tile services designed to sit on top of
 * World_Imagery — together they are Esri's own "Imagery Hybrid" recipe:
 *
 *   Reference/World_Transportation       roads, rail, road shields
 *   Reference/World_Boundaries_and_Places  national + admin-1 borders,
 *                                          city and place names
 *
 * Both are transparent PNG tiles in the same {z}/{y}/{x} scheme, from the
 * same host the imagery already comes from, so they ride the exact tile
 * path the app already trusts (direct, no proxy change), and their
 * labels are the satellite convention — light, haloed type drawn to stay
 * legible over bright desert and dark ocean alike, in either theme.
 * Attribution strings below are each service's own published
 * copyrightText, served on the source so the map credits them.
 *
 * Ordering contract: the specs are listed in INSERTION order. Each is
 * added just below the anchor layer ('day-night-fill' — the same slot
 * the imagery itself occupies, above the base style and below every app
 * data layer), so a later insert lands above an earlier one:
 * imagery → transportation → boundaries & places (names topmost).
 * If a reference service ever fails, its raster simply draws nothing —
 * the imagery underneath is untouched, so satellite degrades to bare
 * imagery, never to a broken map.
 */

export const SATELLITE_REFERENCE_ANCHOR = 'day-night-fill';

export interface SatelliteReferenceSpec {
  /** MapLibre layer id. */
  layerId: string;
  /** MapLibre source id. */
  sourceId: string;
  /** Tile URL template, Esri {z}/{y}/{x} order — same as the imagery. */
  tiles: [string];
  /** The service's own published copyrightText. */
  attribution: string;
}

export const SATELLITE_REFERENCE_LAYERS: readonly SatelliteReferenceSpec[] = [
  {
    layerId: 'satellite-reference-transport',
    sourceId: 'satellite-reference-transport-tiles',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri, HERE, Garmin, (c) OpenStreetMap contributors',
  },
  {
    layerId: 'satellite-reference-places',
    sourceId: 'satellite-reference-places-tiles',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri, HERE, Garmin, (c) OpenStreetMap contributors, and the GIS user community',
  },
];

/** Raster source options shared by both reference services — matched to
 *  the imagery source's own (256px tiles, cached to zoom 18). */
export const SATELLITE_REFERENCE_TILE_SIZE = 256;
export const SATELLITE_REFERENCE_MAX_ZOOM = 18;
