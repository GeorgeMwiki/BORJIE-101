/**
 * modules schema barrel.
 *
 * `routing_rules` is the original live, applied table
 * (packages/database/drizzle/0013_routing_rules.sql) used by the dispatch
 * matrix.
 *
 * The Piece B module-spawning tables (`modules`, `module_specs`,
 * `module_templates`) are RE-INSTATED here in Pass 2 (2026-06-09). They were
 * removed in the borjie-db-drift lane (2026-06-08) as false drift — their
 * CREATE DDL had lived only in the archived migrations, never in the applied
 * `src/migrations` chain, and nothing carried runtime Drizzle I/O. Pass 2 wires
 * the real module-spawning control plane against Drizzle: migration
 * 0323_module_spawning_registry.sql is the forward, applied CREATE for all
 * three tables, and the `services/api-gateway/src/composition/
 * module-spawning-wiring.ts` adapters + `packages/module-orchestrator` carry
 * the runtime I/O. The schema defs below therefore have a matching CREATE in
 * the forward chain (schema-migration-coverage gate passes).
 */

export {
  routingRules,
  type RoutingRuleRow,
  type RoutingRuleInsert,
} from './routing-rules.schema.js';

// Piece B module-spawning control-plane registry (migration 0323).
export {
  modules,
  type ModuleRow,
  type ModuleInsert,
} from './modules.schema.js';
export {
  moduleSpecs,
  type ModuleSpecRow,
  type ModuleSpecInsert,
} from './module-specs.schema.js';
export {
  moduleTemplates,
  type ModuleTemplateRow,
  type ModuleTemplateInsert,
} from './module-templates.schema.js';
