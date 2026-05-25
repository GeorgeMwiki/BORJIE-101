/**
 * TenantAutonomyCap — port + façade module.
 *
 * Combines the cap-policy (DSL) and cap-evaluator (decision) layers into
 * one ergonomic surface. The wire-side adapter (kernel pre-mutate hook)
 * resolves the cap via `TenantAutonomyCapStore.load`, materialises the
 * rolling state via `AutonomyRollingStateStore.snapshot`, then invokes
 * `evaluateAutonomyCap` from cap-evaluator.
 *
 * This module just re-exports the contracts + defines the storage ports.
 */

import type {
  AutonomyRollingState,
  TenantAutonomyCap,
} from '../types.js';

export {
  parseCapPolicy,
  defaultCap,
  capPolicySchema,
  type CapPolicyInput,
} from './cap-policy.js';
export { evaluateAutonomyCap } from './cap-evaluator.js';

/**
 * Storage port for tenant autonomy caps. The kernel-side adapter
 * implements this against the `tenant_autonomy_caps` table.
 */
export interface TenantAutonomyCapStore {
  /**
   * Load the active cap for a tenant. Returns the platform default if no
   * row exists (callers must not depend on the row's presence).
   */
  load(tenantId: string): Promise<TenantAutonomyCap>;
  /**
   * Upsert a cap. Throws on schema-validation failure. The wire-side
   * implementation must reject any write where `updatedBy` is not an
   * HQ-admin actor.
   */
  upsert(cap: TenantAutonomyCap): Promise<void>;
}

/**
 * Storage port for rolling autonomy counters. Sourced from the
 * sovereign-action-ledger by the wire-side implementation.
 */
export interface AutonomyRollingStateStore {
  snapshot(tenantId: string): Promise<AutonomyRollingState>;
}
