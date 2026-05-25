/**
 * @borjie/ai-copilot/property-grading
 *
 * Public surface for the property-grading system:
 *   - types + scoring model (pure)
 *   - portfolio aggregator (pure)
 *   - grading service (composes live data sources)
 *   - in-memory repositories (fallback for tests + degraded mode)
 */

export * from './property-grading-types.js';
export * from './scoring-model.js';
export * from './portfolio-aggregator.js';
export * from './property-grading-service.js';
export * from './in-memory-repositories.js';
