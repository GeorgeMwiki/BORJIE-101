/**
 * Site live-metrics module — Borjie mining.
 *
 * Replaces the property-domain `property-grading/live-metrics-source.ts`
 * with mining-domain equivalent: real-time per-site operations signals
 * (asset health, maintenance load, attendance) for ops dashboards.
 */

export * from './types.js';
export * from './drizzle-site-live-metrics-source.js';
