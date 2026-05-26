/**
 * RTBF cascade planner — compute per-target-table actions for a
 * right-to-be-forgotten request.
 *
 * Pure function: given the set of target tables touched by a subject,
 * the per-table classification, and a list of active legal holds, the
 * planner returns the action per table.
 *
 * See spec §5.3.
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import {
  type Classification,
  type RtbfAction,
} from '../types.js';

export interface RtbfTarget {
  readonly tableName: string;
  readonly entityKind: string;
  readonly entityId: string;
  readonly class: Classification;
  /** True if the row is encrypted via envelope encryption. */
  readonly isEncrypted: boolean;
  /** Categories tagged on this row (legal hold, fraud investigation, etc.). */
  readonly categories: ReadonlyArray<string>;
}

export interface RtbfCascadeEntry {
  readonly tableName: string;
  readonly entityKind: string;
  readonly entityId: string;
  readonly action: RtbfAction;
  readonly auditHash: string;
}

export interface RtbfCascadePlan {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly entries: ReadonlyArray<RtbfCascadeEntry>;
  /** Aggregate audit hash chaining all per-entry hashes. */
  readonly aggregateHash: string;
}

const LEGAL_HOLD_CATEGORIES: ReadonlySet<string> = new Set([
  'litigation_hold',
  'tax_obligation',
  'fraud_investigation',
  'court_order',
]);

/**
 * Decide the cascade action for a single target row.
 *
 * Rules (universal — jurisdiction-aware overrides flow via the
 * `legalHoldOverride` parameter):
 *
 *   - any active legal-hold category → retained-legal-hold.
 *   - class === 'financial'           → retained-legal-hold (statutory).
 *   - class IN ('critical','phi')     → crypto-shredded if encrypted; else deleted.
 *   - class IN ('pii') AND encrypted  → crypto-shredded.
 *   - class IN ('pii') AND !encrypted → deleted.
 *   - class === 'confidential'        → redacted.
 *   - else                            → deleted.
 */
export function decideCascade(input: {
  readonly target: RtbfTarget;
  readonly legalHoldOverride?: boolean;
}): RtbfAction {
  const { target } = input;
  const onHold =
    input.legalHoldOverride === true ||
    target.categories.some((c) => LEGAL_HOLD_CATEGORIES.has(c));
  if (onHold) {
    return 'retained-legal-hold';
  }
  if (target.class === 'financial') {
    return 'retained-legal-hold';
  }
  if (target.class === 'critical' || target.class === 'phi') {
    return target.isEncrypted ? 'crypto-shredded' : 'deleted';
  }
  if (target.class === 'pii') {
    return target.isEncrypted ? 'crypto-shredded' : 'deleted';
  }
  if (target.class === 'confidential') {
    return 'redacted';
  }
  return 'deleted';
}

function entryHash(
  tenantId: string,
  subjectId: string,
  e: RtbfTarget,
  action: RtbfAction,
): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        [
          tenantId,
          subjectId,
          e.tableName,
          e.entityKind,
          e.entityId,
          e.class,
          action,
        ].join('|'),
      ),
    ),
  );
}

export function planCascade(input: {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly targets: ReadonlyArray<RtbfTarget>;
  readonly legalHoldOverride?: boolean;
}): RtbfCascadePlan {
  const entries: RtbfCascadeEntry[] = input.targets.map((t) => {
    const action = decideCascade({
      target: t,
      ...(input.legalHoldOverride !== undefined
        ? { legalHoldOverride: input.legalHoldOverride }
        : {}),
    });
    return Object.freeze({
      tableName: t.tableName,
      entityKind: t.entityKind,
      entityId: t.entityId,
      action,
      auditHash: entryHash(input.tenantId, input.subjectId, t, action),
    });
  });
  const aggregateHash = bytesToHex(
    sha256(
      utf8ToBytes(
        [input.tenantId, input.subjectId, ...entries.map((e) => e.auditHash)].join(
          '|',
        ),
      ),
    ),
  );
  return Object.freeze({
    tenantId: input.tenantId,
    subjectId: input.subjectId,
    entries: Object.freeze(entries),
    aggregateHash,
  });
}

/** Verify completeness: every target with a PII-class must have an action. */
export function verifyCompleteness(
  targets: ReadonlyArray<RtbfTarget>,
  plan: RtbfCascadePlan,
): ReadonlyArray<string> {
  const planned = new Set(
    plan.entries.map((e) => `${e.tableName}::${e.entityKind}::${e.entityId}`),
  );
  const missing: string[] = [];
  for (const t of targets) {
    const key = `${t.tableName}::${t.entityKind}::${t.entityId}`;
    if (!planned.has(key)) {
      missing.push(key);
    }
  }
  return Object.freeze(missing);
}
