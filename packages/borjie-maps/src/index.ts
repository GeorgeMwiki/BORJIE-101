/**
 * @borjie/maps — root barrel.
 *
 * Most consumers should import from the platform-specific entry:
 *   - `@borjie/maps/react`  (web React)
 *   - `@borjie/maps/native` (React Native)
 *
 * The root barrel re-exports the shared types + helpers so consumers
 * that only need `BorjieLngLat` / `BorjiePolygon` / `boundsOf` /
 * `fromGeoJsonPolygon` can import without pulling in a UI component.
 */

export * from './types/index.js';
