/**
 * Barrel for Google Maps Platform clients.
 */

export { lookupAerialView } from './aerial-view-client.js';
export { fetchBuildingInsights, type BuildingInsightsInput } from './solar-api-client.js';
export {
  fetchCurrentConditions,
  type CurrentConditionsInput,
} from './air-quality-client.js';
export { fetchPollenForecast, type PollenForecastInput } from './pollen-api-client.js';
export { computeRoute } from './routes-api-client.js';
export { validateAddress, type AddressValidationInput } from './address-validation-client.js';
export {
  DEFAULT_TIMEOUT_MS,
  GOOGLE_API_KEY_ENV,
  fetchJson,
  missingKeyError,
  readApiKey,
} from './http.js';
