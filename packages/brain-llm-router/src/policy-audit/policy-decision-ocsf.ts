/**
 * OCSF (Open Cybersecurity Schema Framework) emitter for min-tier
 * policy upgrade events.
 *
 * Ported from LITFIN `task-router.ts` lines 402-414 (`logPolicyDecision`).
 *
 * OCSF Category: Policy Activity (class 6003 — Policy Decision).
 *
 * Wire pattern (composition root):
 *
 *     bindMinTierToOcsf((event) => ocsfEmitter.emit(event))
 *
 * That subscribes the min-tier policy's audit-sink to the OCSF emitter.
 * Every time the floor enforces a family upgrade, a structured event
 * lands in the audit chain.
 */

import {
  setEnforcementAuditSink,
  type EnforcementLogEntry,
} from '../dynamic-registry/min-tier-policy.js';

/**
 * Minimal OCSF Policy Decision shape (class 6003).
 * Production wiring will marshal this through the
 * `@borjie/ocsf-emitter` package — keep this shape compatible.
 */
export interface PolicyDecisionOcsf {
  readonly metadata: {
    readonly version: '1.5.0';
    readonly product: { readonly name: 'borjie-brain-llm-router' };
  };
  readonly category_uid: 6; // Policy
  readonly class_uid: 6003; // Policy Decision
  readonly activity_id: 1; // Allow + Modify (we don't deny, we upgrade)
  readonly time: number; // epoch ms
  readonly severity_id: 2; // Low — informational
  readonly status: 'enforced';
  readonly policy: {
    readonly name: 'min-tier';
    readonly desc: string;
  };
  readonly enrichments: ReadonlyArray<{
    readonly name: string;
    readonly value: string;
  }>;
}

export type OcsfEmitter = (event: PolicyDecisionOcsf) => void;

export function formatPolicyDecisionOcsf(
  entry: EnforcementLogEntry,
): PolicyDecisionOcsf {
  return {
    metadata: {
      version: '1.5.0',
      product: { name: 'borjie-brain-llm-router' },
    },
    category_uid: 6,
    class_uid: 6003,
    activity_id: 1,
    time: entry.timestampMs,
    severity_id: 2,
    status: 'enforced',
    policy: {
      name: 'min-tier',
      desc: entry.reason,
    },
    enrichments: [
      { name: 'task_category', value: entry.taskCategory },
      { name: 'original_family', value: entry.originalFamily },
      { name: 'enforced_family', value: entry.enforcedFamily },
    ],
  };
}

/**
 * Bind the min-tier policy's audit sink to an OCSF emitter. Call once
 * at composition root.
 */
export function bindMinTierToOcsf(emitter: OcsfEmitter): void {
  setEnforcementAuditSink((entry) => {
    try {
      emitter(formatPolicyDecisionOcsf(entry));
    } catch {
      // OCSF emitter failure must not crash the LLM hot path.
    }
  });
}
