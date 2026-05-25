/**
 * modules schema barrel — Piece B dynamic module spawning.
 *
 * Exports the per-tenant `modules` table, the versioned `module_specs`,
 * the platform `module_templates`, the `routing_rules` dispatch matrix,
 * and the `module_accept_handlers` executor registry.
 *
 * All five tables FORCE ROW LEVEL SECURITY per the canonical RLS
 * pattern (see migrations 0216-0220).
 */

export {
  modules,
  MODULE_LIFECYCLE_STATES,
  type ModuleRow,
  type ModuleInsert,
  type ModuleLifecycleState,
} from './modules.schema.js';

export {
  moduleSpecs,
  MODULE_SPEC_COMPILE_STATUSES,
  type ModuleSpecRow,
  type ModuleSpecInsert,
  type ModuleSpecCompileStatus,
} from './module-specs.schema.js';

export {
  moduleTemplates,
  MODULE_TEMPLATE_SLUGS,
  type ModuleTemplateRow,
  type ModuleTemplateInsert,
  type ModuleTemplateSlug,
} from './module-templates.schema.js';

export {
  routingRules,
  type RoutingRuleRow,
  type RoutingRuleInsert,
} from './routing-rules.schema.js';

export {
  moduleAcceptHandlers,
  MODULE_ACCEPT_HANDLER_RISK_TIERS,
  type ModuleAcceptHandlerRow,
  type ModuleAcceptHandlerInsert,
  type ModuleAcceptHandlerRiskTier,
} from './module-accept-handlers.schema.js';
