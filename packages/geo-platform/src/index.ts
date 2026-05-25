/**
 * @borjie/geo-platform — root barrel.
 *
 * Server-safe: no React, no DOM, no maplibre-gl. UI consumers should
 * import the React surface from `@borjie/geo-platform/react`.
 *
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md`.
 */

// Types — full re-export so everything downstream has one import path.
export * from './types.js';

// Google clients
export {
  lookupAerialView,
  fetchBuildingInsights,
  fetchCurrentConditions,
  fetchPollenForecast,
  computeRoute,
  validateAddress,
  type AddressValidationInput,
  type BuildingInsightsInput,
  type CurrentConditionsInput,
  type PollenForecastInput,
  DEFAULT_TIMEOUT_MS,
  GOOGLE_API_KEY_ENV,
  readApiKey,
  missingKeyError,
  fetchJson,
} from './google/index.js';

// Geofence
export {
  GeofenceEngine,
  GeofenceEventBus,
  pointInPolygon,
  polygonBoundingBox,
  type DetectInput,
  type DetectOptions,
  type GeofenceEventListener,
  type Unsubscribe,
} from './geofence/index.js';

// Segmentation
export {
  DEFAULT_SNAP_RADIUS_M,
  SAM_TOKEN_ENV,
  SAM_ENDPOINT_ENV,
  rankCandidates,
  segmentClick,
  snapToBuilding,
  type SamCallOptions,
  type SnapInput,
} from './segmentation/index.js';

// Advisory
export { fetchAreaInsights, type AreaInsightsInput } from './advisory/index.js';
