/**
 * Barrel — composition-root adapters for the mining-shift-planner ports.
 *
 * Wires the local `AssignmentSinkPort` / `OshaRulebookPort` interfaces to
 * the cross-package surfaces of `@borjie/assignment-registry` and
 * `@borjie/regulatory-tz-mining` respectively.
 *
 * In-memory fallbacks remain in `../ports.ts` for tests and dry-runs.
 */

export {
  createAssignmentRegistrySink,
  type CreateAssignmentRegistrySinkArgs,
  type ShiftRegistryClient,
} from './assignment-registry.js';

export {
  createRegulatoryTzMiningRulebook,
  type CreateRegulatoryTzMiningRulebookArgs,
  type OshaOverrideSet,
  type RegulatoryOverridesClient,
} from './regulatory-tz-mining.js';
