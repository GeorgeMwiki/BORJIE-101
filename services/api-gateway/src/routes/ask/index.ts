/**
 * Public surface for the `/v1/ask` router family.
 *
 * The api-gateway `index.ts` should mount this at `/ask` under the
 * `/v1` (or `/api/v1`) Hono — once mounted the URLs end up at:
 *
 *   POST /api/v1/ask
 *   GET  /api/v1/ask/starting-points
 *   POST /api/v1/ask/feedback
 */

export { default as askRouter } from './ask.router.js';
