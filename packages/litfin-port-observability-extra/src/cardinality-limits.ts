/**
 * Per-tenant cardinality limits on metrics — prevent metric explosion.
 *
 * LITFIN ref: src/core/telemetry/cardinality-guard.ts — every metric
 * emit increments a per-tenant per-metric counter; when the tenant's
 * cardinality crosses a threshold, new label combinations are dropped
 * (with an audit signal) instead of being exported.
 *
 * This is a stateless decision function over a snapshot.
 */

import type { TenantId } from './types.js';

export interface CardinalityState {
  /** Per-(tenant, metric) -> set of label-tuple signatures. */
  readonly tenantMetric: ReadonlyMap<string, ReadonlySet<string>>;
}

export const emptyCardinalityState = (): CardinalityState => ({
  tenantMetric: new Map(),
});

export interface CardinalityLimits {
  readonly perTenantPerMetric: number;
  /** Optional per-tenant total cap (across metrics). */
  readonly perTenantTotal?: number;
}

export const DEFAULT_LIMITS: CardinalityLimits = {
  perTenantPerMetric: 5000,
  perTenantTotal: 50_000,
};

const keyOf = (tenantId: TenantId, metric: string): string => `${tenantId}::${metric}`;

export const labelSignature = (labels: Readonly<Record<string, string>>): string => {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k] ?? ''}`).join('|');
};

export type EmitDecision =
  | { readonly admit: true; readonly state: CardinalityState }
  | { readonly admit: false; readonly reason: 'per-metric-cap' | 'per-tenant-cap'; readonly state: CardinalityState };

export const decideEmit = (
  state: CardinalityState,
  tenantId: TenantId,
  metric: string,
  labels: Readonly<Record<string, string>>,
  limits: CardinalityLimits = DEFAULT_LIMITS,
): EmitDecision => {
  const k = keyOf(tenantId, metric);
  const sig = labelSignature(labels);
  const existing = state.tenantMetric.get(k);
  if (existing !== undefined && existing.has(sig)) {
    // Already-seen combination — admit without state change.
    return { admit: true, state };
  }
  // Check per-metric cap.
  if (existing !== undefined && existing.size >= limits.perTenantPerMetric) {
    return { admit: false, reason: 'per-metric-cap', state };
  }
  // Check per-tenant total cap.
  if (limits.perTenantTotal !== undefined) {
    let total = 0;
    const prefix = `${tenantId}::`;
    for (const [tk, set] of state.tenantMetric) {
      if (tk.startsWith(prefix)) total += set.size;
    }
    if (total >= limits.perTenantTotal) {
      return { admit: false, reason: 'per-tenant-cap', state };
    }
  }
  // Admit and update state.
  const next = new Map(state.tenantMetric);
  const nextSet = new Set(existing ?? []);
  nextSet.add(sig);
  next.set(k, nextSet);
  return { admit: true, state: { tenantMetric: next } };
};

export const tenantCardinality = (
  state: CardinalityState,
  tenantId: TenantId,
): number => {
  let total = 0;
  const prefix = `${tenantId}::`;
  for (const [k, set] of state.tenantMetric) {
    if (k.startsWith(prefix)) total += set.size;
  }
  return total;
};
