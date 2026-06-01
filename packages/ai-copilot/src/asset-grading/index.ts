/**
 * @borjie/ai-copilot/asset-grading
 *
 * Public surface for the asset-grading system:
 *   - types + scoring model (pure)
 *   - portfolio aggregator (pure)
 *   - grading service (composes live data sources)
 *   - in-memory repositories (fallback for tests + degraded mode)
 */

export * from './asset-grading-types.js';
export * from './scoring-model.js';
export * from './portfolio-aggregator.js';
export * from './asset-grading-service.js';
export * from './in-memory-repositories.js';
