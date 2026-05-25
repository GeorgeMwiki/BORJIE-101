/**
 * Public surface for the `/v1/strategic-reports` router family.
 *
 * The api-gateway `index.ts` should mount this at `/strategic-reports`
 * under the `/v1` Hono — once mounted the URLs end up at:
 *
 *   POST /api/v1/strategic-reports
 *   GET  /api/v1/strategic-reports/:jobId
 *   GET  /api/v1/strategic-reports
 *   POST /api/v1/strategic-reports/:jobId/regenerate
 */

export { default as strategicReportsRouter } from './reports.router.js';
export {
  setEngineForTests,
  getEngine,
  _resetEngineForTests,
} from './engine-wiring.js';
export { _resetReportsRateLimitForTests } from './reports-rate-limit.js';
export { _resetJobIndexForTests } from './reports.router.js';
