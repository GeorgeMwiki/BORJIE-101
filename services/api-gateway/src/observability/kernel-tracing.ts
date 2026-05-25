/**
 * Kernel-pipeline tracing helpers.
 *
 * Wraps `kernel.think(req)` (and equivalents) in an OTel span tagged
 * with the Borjie kernel attributes operators expect to filter by:
 * tenantId, hashed userId, surface, tier, stakes, scope kind, decision
 * kind, sensorId, modelId, confidence, gate verdicts, latency, debate
 * round count.
 *
 * Sub-spans for each kernel pipeline step are exposed via
 * `KERNEL_STEP_SPAN_NAMES` plus the `withKernelStepSpan` helper so
 * downstream wirings (or future kernel hooks) can emit child spans
 * with the canonical names without typo risk.
 *
 * Designed so the rest of the gateway never needs a direct OTel import
 * — `withKernelSpan(...)` is the one entry point.
 */

import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { createHash } from 'node:crypto';

const TRACER_NAME = 'borjie.api-gateway.kernel';

/** Canonical span name for a single kernel turn. */
export const KERNEL_TURN_SPAN_NAME = 'borjie.kernel.turn';

/**
 * Canonical sub-span names for each pipeline step. Keep in sync with
 * the kernel's internal step ordering — see
 * `packages/central-intelligence/src/kernel/kernel.ts`.
 */
export const KERNEL_STEP_SPAN_NAMES = {
  cacheCheck: 'kernel.step.cache_check',
  inviolable: 'kernel.step.inviolable',
  memoryRecall: 'kernel.step.memory_recall',
  cohortSignal: 'kernel.step.cohort_signal',
  grounding: 'kernel.step.grounding',
  identity: 'kernel.step.identity',
  sensorCall: 'kernel.step.sensor_call',
  normalize: 'kernel.step.normalize',
  judge: 'kernel.step.judge',
  driftDetection: 'kernel.step.drift_detection',
  policyGate: 'kernel.step.policy_gate',
  confidence: 'kernel.step.confidence',
  provenanceWrite: 'kernel.step.provenance_write',
} as const;

export type KernelStepName =
  (typeof KERNEL_STEP_SPAN_NAMES)[keyof typeof KERNEL_STEP_SPAN_NAMES];

/**
 * Per-turn scope inputs. Hashed userId is constructed inside the
 * tracer so a caller never accidentally leaks a raw user id onto a
 * span.
 */
export interface KernelTraceScope {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly surface: string;
  readonly tier: string;
  readonly stakes: string;
  readonly scopeKind: 'tenant' | 'platform' | string;
}

/**
 * Subset of the kernel's BrainDecision the tracer needs to emit
 * attributes — kept structurally compatible so callers don't have to
 * import the full type.
 */
export interface KernelDecisionForSpan {
  readonly kind: 'answer' | 'refusal' | 'softened' | string;
  readonly confidence?: { readonly overall?: number } | null;
  readonly gates?: {
    readonly inviolable?: { readonly status: string };
    readonly policy?: { readonly status: string };
    readonly drift?: { readonly status: string };
  } | null;
  readonly provenance: {
    readonly thoughtId: string;
    readonly sensorId: string;
    readonly modelId: string;
    readonly latencyMs: number;
    readonly debateRoundsCompleted?: number;
  };
}

/**
 * Hash a userId so spans can carry per-user cardinality without
 * leaking raw identities to a downstream collector. SHA-256, first 16
 * hex chars (64 bits) — enough to disambiguate while remaining
 * pseudonymous.
 */
function hashUserId(userId: string | null): string {
  if (!userId) return '__nouser__';
  return createHash('sha256').update(userId).digest('hex').slice(0, 16);
}

function attributesForScope(
  scope: KernelTraceScope,
  thoughtId: string,
): Attributes {
  return {
    'borjie.kernel.thoughtId': thoughtId,
    'borjie.kernel.tenantId': scope.tenantId ?? '__platform__',
    'borjie.kernel.userId': hashUserId(scope.userId),
    'borjie.kernel.surface': scope.surface,
    'borjie.kernel.tier': scope.tier,
    'borjie.kernel.stakes': scope.stakes,
    'borjie.kernel.scopeKind': scope.scopeKind,
  };
}

function recordDecisionAttributes(
  span: Span,
  decision: KernelDecisionForSpan,
): void {
  span.setAttributes({
    'borjie.kernel.decisionKind': decision.kind,
    'borjie.kernel.sensorId': decision.provenance.sensorId,
    'borjie.kernel.modelId': decision.provenance.modelId,
    'borjie.kernel.latencyMs': decision.provenance.latencyMs,
  });
  if (typeof decision.confidence?.overall === 'number') {
    span.setAttribute(
      'borjie.kernel.confidence.overall',
      decision.confidence.overall,
    );
  }
  if (decision.gates?.policy?.status) {
    span.setAttribute(
      'borjie.kernel.gates.policy.status',
      decision.gates.policy.status,
    );
  }
  if (decision.gates?.drift?.status) {
    span.setAttribute(
      'borjie.kernel.gates.drift.status',
      decision.gates.drift.status,
    );
  }
  if (decision.gates?.inviolable?.status) {
    span.setAttribute(
      'borjie.kernel.gates.inviolable.status',
      decision.gates.inviolable.status,
    );
  }
  if (typeof decision.provenance.debateRoundsCompleted === 'number') {
    span.setAttribute(
      'borjie.kernel.debateRoundsCompleted',
      decision.provenance.debateRoundsCompleted,
    );
  }
}

/**
 * Wrap an async kernel.think (or equivalent) call in a span. The
 * passed `thoughtId` is used for the initial attribute set; if the
 * decision returns its own `provenance.thoughtId`, that value
 * overwrites the attribute so the span shows the canonical id.
 *
 * Errors thrown by `fn` are recorded on the span and re-thrown so
 * upstream error handling is unchanged.
 */
export async function withKernelSpan<T extends KernelDecisionForSpan>(
  thoughtId: string,
  scope: KernelTraceScope,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    KERNEL_TURN_SPAN_NAME,
    {
      kind: SpanKind.INTERNAL,
      attributes: attributesForScope(scope, thoughtId),
    },
    async (span) => {
      const startedAt = Date.now();
      try {
        const decision = await fn();
        if (decision?.provenance?.thoughtId) {
          span.setAttribute(
            'borjie.kernel.thoughtId',
            decision.provenance.thoughtId,
          );
        }
        recordDecisionAttributes(span, decision);
        // Wall-clock latency in case the decision provenance latency
        // is missing (some refusal paths set 0).
        span.setAttribute(
          'borjie.kernel.wallLatencyMs',
          Date.now() - startedAt,
        );
        span.setStatus({ code: SpanStatusCode.OK });
        return decision;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        span.recordException(
          err instanceof Error ? err : new Error(message),
        );
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.setAttribute(
          'borjie.kernel.wallLatencyMs',
          Date.now() - startedAt,
        );
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Run an async pipeline-step in a child span. When called outside an
 * active turn span the helper still produces a span attached to the
 * tracer's root context so step traces are not lost.
 */
export async function withKernelStepSpan<T>(
  step: KernelStepName,
  fn: () => Promise<T>,
  attributes: Attributes = {},
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    step,
    { kind: SpanKind.INTERNAL, attributes },
    context.active(),
    async (span) => {
      try {
        const out = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return out;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        span.recordException(
          err instanceof Error ? err : new Error(message),
        );
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

/** Test seam — exposed for unit tests, not part of the public API. */
export const __internals = {
  hashUserId,
  attributesForScope,
  recordDecisionAttributes,
  TRACER_NAME,
};
