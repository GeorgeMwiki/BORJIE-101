/**
 * Property-grading domain module — Postgres-backed adapters for
 * `@borjie/ai-copilot/property-grading`.
 *
 * Three adapter classes bind the structural ports (ports.ts) to real
 * Postgres tables. The api-gateway composition root instantiates the
 * ai-copilot `PropertyGradingService` using these adapters.
 */

export * from './ports.js';
export * from './drizzle-weights-repository.js';
export * from './drizzle-snapshot-repository.js';
export * from './live-metrics-source.js';
export * from './create-property-grading-service.js';
