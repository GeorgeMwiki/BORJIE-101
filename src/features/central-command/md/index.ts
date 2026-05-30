/**
 * MD (Managing Director) - top-level barrel.
 *
 * Public surface for the MD feature. Re-exports the orchestrator core, the
 * composition root that wires subagent services to the orchestrator's
 * contract ports, and every subagent's own public barrel.
 *
 * Consumers (boot path, API routes, integration tests) import from here.
 *
 * @module features/central-command/md
 */

export * from "./core";
export * from "./composition";
