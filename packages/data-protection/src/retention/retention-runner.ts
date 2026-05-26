/**
 * retention-runner — purge rows older than the per-class retention
 * window, respecting legal holds and open RTBF "retain" markers.
 *
 * The runner is wire-level pure: it computes the set of rows that
 * SHOULD be purged. A caller-supplied executor materialises the purge
 * against the data store. Tests can stub the executor.
 */

import type { Classification } from '../types.js';
import { DataProtectionInvariantError } from '../types.js';

export interface RetentionPolicy {
  readonly tenantId: string;
  readonly class: Classification;
  readonly retentionDays: number;
  /** Category strings that EXEMPT a row from purge (legal hold, etc.). */
  readonly exceptionCategories: ReadonlyArray<string>;
}

export interface RetentionCandidate {
  readonly tenantId: string;
  readonly class: Classification;
  readonly entityKind: string;
  readonly entityId: string;
  readonly createdAt: Date;
  /** Categories tagged on this row (e.g., `'litigation_hold'`). */
  readonly categories: ReadonlyArray<string>;
}

export interface RetentionDecision {
  readonly entityKind: string;
  readonly entityId: string;
  /** `'purge' | 'retain'`. */
  readonly action: 'purge' | 'retain';
  /** Human-readable reason; populated for both branches. */
  readonly reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function decideRetention(input: {
  readonly policy: RetentionPolicy;
  readonly candidate: RetentionCandidate;
  readonly now: Date;
}): RetentionDecision {
  const { candidate, policy, now } = input;
  if (candidate.tenantId !== policy.tenantId) {
    throw new DataProtectionInvariantError(
      'retention.tenant_mismatch',
      `Policy is for tenant ${policy.tenantId}; candidate belongs to ${candidate.tenantId}.`,
    );
  }
  if (candidate.class !== policy.class) {
    throw new DataProtectionInvariantError(
      'retention.class_mismatch',
      `Policy class is ${policy.class}; candidate class is ${candidate.class}.`,
    );
  }
  // Legal-hold / exception-category short-circuit: if ANY of the row's
  // categories appears in the policy's exception list, retain.
  const exceptions = new Set(policy.exceptionCategories);
  const blocking = candidate.categories.find((c) => exceptions.has(c));
  if (blocking !== undefined) {
    return Object.freeze({
      entityKind: candidate.entityKind,
      entityId: candidate.entityId,
      action: 'retain' as const,
      reason: `exception_category=${blocking}`,
    });
  }
  const ageMs = now.getTime() - candidate.createdAt.getTime();
  const windowMs = policy.retentionDays * DAY_MS;
  if (ageMs < windowMs) {
    return Object.freeze({
      entityKind: candidate.entityKind,
      entityId: candidate.entityId,
      action: 'retain' as const,
      reason: `within_window:${policy.retentionDays}d`,
    });
  }
  return Object.freeze({
    entityKind: candidate.entityKind,
    entityId: candidate.entityId,
    action: 'purge' as const,
    reason: `age_exceeded:${policy.retentionDays}d`,
  });
}

export function planRetentionBatch(input: {
  readonly policies: ReadonlyArray<RetentionPolicy>;
  readonly candidates: ReadonlyArray<RetentionCandidate>;
  readonly now: Date;
}): ReadonlyArray<RetentionDecision> {
  const byTenantClass = new Map<string, RetentionPolicy>();
  for (const p of input.policies) {
    byTenantClass.set(`${p.tenantId}::${p.class}`, p);
  }
  const out: RetentionDecision[] = [];
  for (const c of input.candidates) {
    const policy = byTenantClass.get(`${c.tenantId}::${c.class}`);
    if (!policy) {
      out.push(
        Object.freeze({
          entityKind: c.entityKind,
          entityId: c.entityId,
          action: 'retain' as const,
          reason: 'no_policy:default_retain',
        }),
      );
      continue;
    }
    out.push(decideRetention({ policy, candidate: c, now: input.now }));
  }
  return Object.freeze(out);
}
