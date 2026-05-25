/**
 * `@borjie/litfin-port-observability-extra` — public surface.
 *
 * LITFIN-ported ops + observability patterns:
 *   - structured logging field conventions + redaction + enrichment
 *   - W3C traceparent propagation across BullMQ + Inngest workers
 *   - error-budget-burn calculator (multi-window multi-burn-rate)
 *   - per-tenant metric cardinality limits
 *   - correlation-id middleware with sampling
 */

export * from './types.js';
export * from './log-field-conventions.js';
export * from './traceparent-propagation.js';
export * from './error-budget-burn.js';
export * from './cardinality-limits.js';
export * from './correlation-id-middleware.js';
