'use client';

/**
 * Side-effect module that imports mapbox-gl's CSS.
 *
 * Kept in its own file so the heavy stylesheet is code-split — webpack
 * only fetches it when this module is dynamically imported from
 * MapCanvas. If the `mapbox-gl` package is not installed in this
 * workspace, this module never executes and the map gracefully
 * degrades to the GeoJSON fallback.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - side-effect CSS import resolved at build time.
import 'mapbox-gl/dist/mapbox-gl.css';

export const MAPBOX_CSS_LOADED = true;
