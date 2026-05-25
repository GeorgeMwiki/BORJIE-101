/**
 * Residency policy — pin tenant data to a region.
 *
 * The decision matrix:
 *   tenant.region == op.region                          → allow
 *   tenant.region != op.region & allowFailover & in     → allowed_with_replication
 *      failoverRegions
 *   tenant.region != op.region & allowFailover & NOT in → deny
 *      failoverRegions
 *   tenant.region != op.region & !allowFailover         → deny
 *
 * Per-table overrides:
 *   - `'global'` — the table is platform-wide reference data and
 *     bypasses residency entirely (e.g. country codes, currency rates).
 *   - `'pinned'` — the default behaviour above.
 *
 * Implementation is intentionally a pure function over the policy and
 * a "intended operation" record; the integration layer queries this
 * before routing a read/write.
 */

import { ResidencyViolationError } from '../types.js';
import type {
  ResidencyDecision,
  ResidencyPolicy,
  ResidencyRegion,
} from '../types.js';

export interface ResidencyOperation {
  readonly table: string;
  readonly region: ResidencyRegion;
  readonly action: 'read' | 'write';
}

/**
 * Compute the decision for one operation under one policy. Returns
 * the decision; the caller is responsible for enforcing it.
 */
export function checkResidency(params: {
  readonly policy: ResidencyPolicy;
  readonly operation: ResidencyOperation;
}): ResidencyDecision {
  const { policy, operation } = params;

  // Per-table override — `global` tables bypass residency.
  const override = policy.tableOverrides?.[operation.table];
  if (override === 'global') {
    return 'allow';
  }

  if (operation.region === policy.region) {
    return 'allow';
  }

  if (policy.allowFailover && policy.failoverRegions?.includes(operation.region)) {
    return 'allowed_with_replication';
  }

  return 'deny';
}

/**
 * Throw if a policy denies the operation. Convenience wrapper for
 * call-sites that want a hard-fail boundary.
 */
export function enforceResidency(params: {
  readonly policy: ResidencyPolicy;
  readonly operation: ResidencyOperation;
}): void {
  const decision = checkResidency(params);
  if (decision === 'deny') {
    throw new ResidencyViolationError(
      `tenant ${params.policy.tenantId} is pinned to ` +
        `${params.policy.region} but operation requested ${params.operation.region} ` +
        `on table ${params.operation.table}`,
    );
  }
}

/**
 * Factory — partially applies a policy so call-sites can carry the
 * `checkResidency` function around without re-passing the tenant
 * policy each time.
 */
export interface ResidencyChecker {
  readonly tenantId: string;
  check(operation: ResidencyOperation): ResidencyDecision;
  enforce(operation: ResidencyOperation): void;
}

export function defineResidencyPolicy(policy: ResidencyPolicy): ResidencyChecker {
  return {
    tenantId: policy.tenantId,
    check: (operation) => checkResidency({ policy, operation }),
    enforce: (operation) => enforceResidency({ policy, operation }),
  };
}
