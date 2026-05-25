/**
 * Review gate — every proposed memory delta passes through here before
 * the writer touches `core_memory_blocks` / `kernel_memory_semantic` /
 * `ai_semantic_memories`.
 *
 * Two layers:
 *
 *   1. Constitution verifier — for the action tag the delta carries, run
 *      the v1 BORJIE constitution citation gate. Any `severity:refuse`
 *      clause that applies but isn't cited in the delta's rationale -> the
 *      delta is BLOCKED. `severity:warn` clauses surface as warnings but
 *      don't block. The verifier is wire-agnostic (pure function) — see
 *      `packages/autonomy-governance/src/constitution/citation-verifier.ts`.
 *
 *   2. Heuristic safety net — even when the constitution lets a delta
 *      through, refuse-class action tags (eviction, data export, payment
 *      disbursement, etc.) require explicit human approval. The gate
 *      escalates these rather than auto-applying.
 *
 * The gate calls the verifier via the `@borjie/autonomy-governance`
 * barrel so this module compiles without the verifier physically present
 * — when the package is missing (degraded build), the gate falls back to
 * the stub interface and blocks every `severity:refuse` action tag.
 *
 * Stub interface (used when the real verifier isn't wired):
 *   `ConstitutionVerifierPort.verify(input) -> VerifyVerdict`.
 * The real package exports `verifyResponse` with the same signature; the
 * composition root just wraps it as a port.
 */

import type {
  DeltaApplicationResult,
  MemoryDelta,
  BrainWorkerLogger,
} from '../types.js';

/**
 * Inputs the verifier receives. Mirrors the `VerifyInput` shape from
 * `@borjie/autonomy-governance` so a thin adapter is all the
 * composition root needs.
 */
export interface VerifierInput {
  readonly candidateResponse: string;
  readonly action: string;
  readonly jurisdiction: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

/**
 * Verdict shape echoed from the constitution verifier. Reduced to the
 * fields the gate actually consumes — the full verifier returns more.
 */
export interface VerifierVerdict {
  readonly pass: boolean;
  readonly escalate: boolean;
  readonly violations: ReadonlyArray<{ readonly id: string }>;
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Constitution port. The composition root wraps the real
 * `verifyResponse` exported from `@borjie/autonomy-governance` as
 * this interface. When the package is unavailable, callers may pass a
 * stub that blocks every refuse-severity action tag.
 */
export interface ConstitutionVerifierPort {
  verify(input: VerifierInput): VerifierVerdict;
}

/**
 * Action tags that always require human approval, regardless of what the
 * constitution returns. Belt-and-braces — if a future clause edit weakens
 * the citation requirement, this list keeps the worker safe.
 *
 * Mirrors the `appliesTo` lists of the v1 constitution's `severity:refuse`
 * clauses, plus the worker's own write-class action tags.
 */
export const ALWAYS_ESCALATE_ACTIONS: ReadonlySet<string> = new Set([
  'eviction.notice.draft',
  'eviction.notice.send',
  'eviction.filing.initiate',
  'eviction.filing.submit',
  'tenant.profile.write',
  'tenant.export.crossborder',
  'tenant.share.thirdparty',
  'payment.disburse',
  'payment.transfer.trust',
  'creditbureau.adverse.report',
  'police.report.submit',
  'lease.terminate',
]);

export interface ReviewGateDeps {
  readonly verifier: ConstitutionVerifierPort;
  readonly jurisdictionFor: (tenantId: string) => string;
  readonly logger?: BrainWorkerLogger;
}

/**
 * Run a single delta through the gate. Returns the application verdict
 * the writer downstream consumes. Never throws — verifier exceptions
 * downgrade to `applied=false, escalated=true`.
 */
export function reviewDelta(
  deps: ReviewGateDeps,
  delta: MemoryDelta,
): DeltaApplicationResult {
  // Always-escalate action tags short-circuit. The brain may PROPOSE
  // these, but the gate never auto-applies. Operators review in the
  // admin portal.
  if (ALWAYS_ESCALATE_ACTIONS.has(delta.actionTag)) {
    return {
      idempotencyKey: delta.idempotencyKey,
      applied: false,
      escalated: true,
      skippedReason: `action ${delta.actionTag} is always-escalate per worker safety policy`,
      violations: [],
    };
  }

  let verdict: VerifierVerdict;
  try {
    const jurisdiction = deps.jurisdictionFor(delta.tenantId);
    verdict = deps.verifier.verify({
      candidateResponse: composeVerifierResponse(delta),
      action: delta.actionTag,
      jurisdiction,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    deps.logger?.warn?.(
      {
        tenantId: delta.tenantId,
        deltaKey: delta.idempotencyKey,
        actionTag: delta.actionTag,
        err: msg,
      },
      'brain-evolution-worker: verifier threw — escalating delta to human',
    );
    return {
      idempotencyKey: delta.idempotencyKey,
      applied: false,
      escalated: true,
      skippedReason: `verifier_error:${msg}`,
      violations: [],
    };
  }

  if (!verdict.pass) {
    return {
      idempotencyKey: delta.idempotencyKey,
      applied: false,
      escalated: verdict.escalate,
      skippedReason: 'constitution_violation',
      violations: verdict.violations.map((v) => v.id),
    };
  }

  if (verdict.escalate) {
    return {
      idempotencyKey: delta.idempotencyKey,
      applied: false,
      escalated: true,
      skippedReason: 'constitution_requires_human_review',
      violations: [],
    };
  }

  return {
    idempotencyKey: delta.idempotencyKey,
    applied: true,
    escalated: false,
    skippedReason: null,
    violations: [],
  };
}

/**
 * Compose the "candidate response" the verifier sees. The constitution's
 * citation gate looks for clause-id tokens in this string. By inlining
 * the rationale + content + action tag we make it easy for the brain to
 * comply with the gate by citing relevant clause ids in the rationale.
 */
function composeVerifierResponse(delta: MemoryDelta): string {
  return [
    `MemoryDelta tenant=${delta.tenantId} action=${delta.actionTag}`,
    `blockKind=${delta.blockKind} subKind=${delta.coreSubKind ?? ''}`,
    `rationale=${delta.rationale}`,
    `content=${delta.content}`,
  ].join('\n');
}

/**
 * Convenience: a stub verifier that blocks any always-escalate action
 * and otherwise passes. Used by tests where the real
 * `@borjie/autonomy-governance` package isn't wired.
 */
export function createStubVerifier(): ConstitutionVerifierPort {
  return {
    verify(input) {
      if (ALWAYS_ESCALATE_ACTIONS.has(input.action)) {
        return {
          pass: false,
          escalate: true,
          violations: [{ id: 'STUB-ESCALATE' }],
          warnings: [],
        };
      }
      return {
        pass: true,
        escalate: false,
        violations: [],
        warnings: [],
      };
    },
  };
}
