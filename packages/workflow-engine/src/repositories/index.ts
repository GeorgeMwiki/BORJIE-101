/**
 * Drizzle-backed repository adapters for `@borjie/workflow-engine`.
 *
 * These persist the engine's three ports — RunRepository,
 * RunEventRepository, AuditChainRepository — to the Postgres tables in
 * `@borjie/database` (migration 0307) so /workflow runs, the four-eyes
 * approval queue, and the hashed audit chain survive a process restart.
 *
 * The composition root (services/api-gateway/src/composition/
 * workflow-engine-wiring.ts) selects these when a DatabaseClient is
 * present, and falls back to the in-memory adapters (../runs/in-memory-
 * repos.js) when it is not.
 */

export { createDrizzleRunRepository } from './drizzle-run-repository.js';
export { createDrizzleRunEventRepository } from './drizzle-run-event-repository.js';
export { createDrizzleAuditChainRepository } from './drizzle-audit-chain-repository.js';
// Flow-keyed autonomy posture (migration 0308 / flow_autonomy_prefs).
export { createDrizzleFlowAutonomyRepository } from './drizzle-flow-autonomy-repository.js';
