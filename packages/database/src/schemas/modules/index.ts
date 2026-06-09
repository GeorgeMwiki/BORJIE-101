/**
 * modules schema barrel.
 *
 * Only `routing_rules` survives here — it is a live, applied table
 * (packages/database/drizzle/0013_routing_rules.sql) used by the dispatch
 * matrix.
 *
 * The Piece B module-spawning tables (`modules`, `module_specs`,
 * `module_templates`, `module_accept_handlers`) were removed in the
 * borjie-db-drift lane (2026-06-08): they had ZERO runtime Drizzle I/O (no
 * .insert/.from/.update/.delete anywhere; `ModulesStorePort` had no concrete
 * Drizzle-backed implementation, and the unmounted `createModulesRouter` route
 * was deleted in closure Wave 6 as dead orphan code — the
 * orchestrator is "purely deterministic, no DB"). Their CREATE DDL existed
 * ONLY in packages/database/.archive/migrations/ (0219-0223), never in the
 * applied src/migrations chain — so keeping the Drizzle defs manufactured false
 * schema drift. The module-orchestrator package keeps its own independent
 * MODULE_LIFECYCLE_STATES + port interfaces; nothing imported these DB types.
 * Reinstate via a forward migration + schema def when Piece B is actually
 * wired against Drizzle.
 */

export {
  routingRules,
  type RoutingRuleRow,
  type RoutingRuleInsert,
} from './routing-rules.schema.js';
