/**
 * `@borjie/intel-self-improve` — core types (Wave INTEL-SELF-IMPROVE).
 *
 * Spec: Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
 * Persona: Mr. Mwikila.
 *
 * Every intel call (forecast | stat | graph_db | causal | anomaly |
 * recommendation) is wrapped at the composition root with
 * `wrapAsMeasured`. The wrapper emits two telemetry rows (one detailed,
 * one for the capability-catalogue worker), ticks a Voyager-style
 * skill-trace counter (Wang et al., arXiv 2305.16291), and returns the
 * unchanged output. The outcome-observer cron later attaches ground
 * truth and the curator shapes training pairs the meta-learning
 * conductor + RLVR runner consume.
 *
 * @module @borjie/intel-self-improve/types
 */

import { z } from 'zod';
import type {
  ObservedOutcome,
  UserFollowthrough,
} from '@borjie/capability-catalogue';

// ---------------------------------------------------------------------------
// Intel kinds — closed enumeration matching migration 0072 CHECK constraint
// ---------------------------------------------------------------------------

export const INTEL_KINDS = [
  'forecast',
  'stat',
  'graph_db',
  'causal',
  'anomaly',
  'recommendation',
] as const;

export type IntelKind = (typeof INTEL_KINDS)[number];

// ---------------------------------------------------------------------------
// MeasuredCapability — descriptor authored at composition root
// ---------------------------------------------------------------------------

/**
 * Descriptor a caller supplies to `wrapAsMeasured` once per intel
 * function. It is the only handle the wrapper needs to chart a call:
 *
 *   - capabilityId : registered row in the capability-catalogue.
 *   - tenantId     : RLS scope.
 *   - intelKind    : closed enumeration (`forecast`, ...).
 *   - claimedConfidenceFrom(output) : extractor in `[0, 1]`.
 *   - hashInput, hashOutput : canonical-JSON-friendly projections.
 *   - costCentsFrom(output) : optional, defaults to `0`.
 *
 * `TInput` and `TOutput` are the underlying domain function's types —
 * the wrapper never sees them directly; it only sees the projection.
 */
export interface MeasuredCapability<TInput, TOutput> {
  readonly capabilityId: string;
  readonly tenantId: string;
  readonly intelKind: IntelKind;
  readonly claimedConfidenceFrom: (output: TOutput) => number;
  readonly hashInput: (input: TInput) => Readonly<Record<string, unknown>>;
  readonly hashOutput: (output: TOutput) => Readonly<Record<string, unknown>>;
  readonly costCentsFrom?: (output: TOutput) => number;
}

// ---------------------------------------------------------------------------
// IntelInvocationContext — what the wrapper records into the audit
// ---------------------------------------------------------------------------

export interface IntelInvocationContext {
  readonly id: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly intelKind: IntelKind;
  readonly inputPayload: Readonly<Record<string, unknown>>;
  readonly outputPayload: Readonly<Record<string, unknown>>;
  readonly claimedConfidence: number;
  readonly latencyMs: number;
  readonly costUsdCents: number;
  readonly invokedAt: string;
  readonly prevHash: string;
  readonly auditHash: string;
}

export const IntelInvocationContextSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  capabilityId: z.string().uuid(),
  intelKind: z.enum(INTEL_KINDS),
  inputPayload: z.record(z.unknown()),
  outputPayload: z.record(z.unknown()),
  claimedConfidence: z.number().min(0).max(1),
  latencyMs: z.number().int().nonnegative(),
  costUsdCents: z.number().int().nonnegative(),
  invokedAt: z.string().datetime(),
  prevHash: z.string(),
  auditHash: z.string().min(1),
});

// ---------------------------------------------------------------------------
// OutcomeObservation — ground truth attached later
// ---------------------------------------------------------------------------

/**
 * One observation attached by the cron-driven outcome-observer to a
 * pending intel_invocation_audit row. The observer never invents
 * truth; it queries the upstream feedback feed (forecast horizon
 * realisations, incident table for anomalies, click stream for
 * recommendations, etc.) and writes an Outcome row through the
 * capability-catalogue port.
 */
export interface OutcomeObservation {
  readonly invocationId: string;
  readonly observedOutcome: ObservedOutcome;
  readonly userFollowthrough: UserFollowthrough;
  readonly observationPayload: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
}

export const OutcomeObservationSchema = z.object({
  invocationId: z.string().uuid(),
  observedOutcome: z.enum(['confirmed', 'disconfirmed', 'partial', 'unknown']),
  userFollowthrough: z.enum(['accepted', 'modified', 'rejected', 'ignored']),
  observationPayload: z.record(z.unknown()),
  observedAt: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Skill trace — Voyager-style counters per pattern
// ---------------------------------------------------------------------------

export interface IntelSkillTrace {
  readonly id: string;
  readonly tenantId: string;
  readonly intelKind: IntelKind;
  readonly patternSignature: string;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastCapabilityId: string | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly prevHash: string;
  readonly auditHash: string;
}

export const IntelSkillTraceSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  intelKind: z.enum(INTEL_KINDS),
  patternSignature: z.string().min(1),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  lastCapabilityId: z.string().uuid().nullable(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  prevHash: z.string(),
  auditHash: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type IntelSelfImproveErrorCode =
  | 'INVALID_INPUT'
  | 'CAPABILITY_NOT_FOUND'
  | 'INVOCATION_NOT_FOUND'
  | 'AUDIT_CHAIN_BROKEN';

export class IntelSelfImproveError extends Error {
  public readonly code: IntelSelfImproveErrorCode;

  constructor(message: string, code: IntelSelfImproveErrorCode) {
    super(message);
    this.name = 'IntelSelfImproveError';
    this.code = code;
  }
}
