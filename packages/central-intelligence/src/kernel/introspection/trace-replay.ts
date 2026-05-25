/**
 * Decision-trace replay — historical kernel turns are re-run through
 * the CURRENT kernel logic so we can detect drift, regression, and
 * fairness anomalies without waiting for a user complaint.
 *
 * The brain's "self-knowledge" pattern. Mirrors LITFIN's
 * `m5-falsification/legal-replay-runner.ts` shape: pull a window of
 * historical traces, replay each through `kernel.think`, diff the
 * resulting decision kind / confidence / sensor against what was
 * originally produced, then aggregate into a ReplaySummary.
 *
 * The runner is provider- and storage-agnostic: callers inject a
 * `ReplaySource` (Postgres / S3 / fixture file) and a duck-typed
 * `think` function (typically `kernel.think.bind(kernel)`).
 *
 * USE CASES
 *   - Pre-deploy regression check: replay last 1000 turns; assert
 *     kindFlips < threshold and meanConfidenceDelta within ±0.05.
 *   - Drift hunt: replay a fairness-cohort slice; flag new refusals.
 *   - Fairness audit: replay a tenant slice; flag asymmetric softening.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * The minimum subset of a historical kernel turn that we need to
 * replay it. Captured at provenance-write time and reconstructed by
 * adapters from `kernel_provenance` rows.
 */
export interface ReplayInput {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly userMessage: string;
  readonly scope: {
    readonly kind: 'tenant' | 'platform';
    readonly tenantId?: string;
    readonly actorUserId: string;
    readonly roles: ReadonlyArray<string>;
    readonly personaId: string;
  };
  readonly tier: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly surface: string;
  /** What the original turn produced — for diffing. */
  readonly originalDecisionKind: 'answer' | 'softened' | 'refusal';
  readonly originalSensorId: string;
  readonly originalConfidenceOverall: number;
  readonly originalProducedAt: string;
}

/**
 * Source of historical traces. Production binds a Postgres adapter
 * over `kernel_provenance`; tests can pass an in-memory fixture.
 */
export type ReplaySource = {
  readonly fetchTraces: (args: {
    readonly limit: number;
    readonly olderThanDays?: number;
    readonly newerThanDays?: number;
  }) => Promise<ReadonlyArray<ReplayInput>>;
};

/**
 * Per-trace diff — what changed when this turn was replayed against
 * the current kernel.
 */
export interface ReplayDelta {
  readonly thoughtId: string;
  readonly originalKind: ReplayInput['originalDecisionKind'];
  readonly replayKind: 'answer' | 'softened' | 'refusal';
  readonly kindChanged: boolean;
  readonly originalConfidence: number;
  readonly replayConfidence: number;
  readonly confidenceDelta: number;
  readonly sensorIdChanged: boolean;
  readonly newRefusalReason?: string;
}

export interface ReplaySummary {
  readonly totalReplayed: number;
  readonly kindFlips: number;
  readonly meanConfidenceDelta: number;
  readonly p95ConfidenceDelta: number;
  readonly newRefusals: number; // was answer/softened, now refusal
  readonly newAnswers: number;  // was refusal, now answer/softened
  readonly perCategoryRates: {
    readonly answer: number;
    readonly softened: number;
    readonly refusal: number;
  };
}

/**
 * Duck-typed BrainKernel think — we don't import from `./kernel.js`
 * because that would create a hard cycle when the introspection layer
 * is later folded back into a kernel debug tool. The runner only needs
 * the request/decision shape.
 */
export type ReplayThinkFn = (req: unknown) => Promise<{
  readonly kind: 'answer' | 'softened' | 'refusal';
  readonly confidence?: { readonly overall: number };
  readonly provenance?: { readonly sensorId?: string };
  readonly reason?: string;
}>;

export interface ReplayDeps {
  readonly source: ReplaySource;
  readonly think: ReplayThinkFn;
  readonly clock?: () => number;
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Replay up to `limit` historical traces through the current kernel
 * and report every per-trace diff plus an aggregated summary.
 *
 * Failures of `deps.think` for a single trace do NOT abort the run —
 * the failing trace is dropped from the deltas (so it doesn't poison
 * the summary) and the loop continues. This matches LITFIN's "best-
 * effort regression sweep" semantics.
 */
export async function runDecisionReplay(
  args: {
    readonly limit: number;
    readonly olderThanDays?: number;
    readonly newerThanDays?: number;
  },
  deps: ReplayDeps,
): Promise<{
  readonly deltas: ReadonlyArray<ReplayDelta>;
  readonly summary: ReplaySummary;
}> {
  const traces = await deps.source.fetchTraces(args);

  const deltas: ReplayDelta[] = [];

  for (const trace of traces) {
    const rebuilt = rebuildThoughtRequest(trace);
    let replayDecision;
    try {
      replayDecision = await deps.think(rebuilt);
    } catch {
      // Skip this trace; the runner is best-effort.
      continue;
    }

    const replayKind = replayDecision.kind;
    const replayConfidence =
      replayKind === 'refusal'
        ? 0
        : replayDecision.confidence?.overall ?? 0;
    const replaySensorId = replayDecision.provenance?.sensorId ?? '__unknown__';

    const delta: ReplayDelta = {
      thoughtId: trace.thoughtId,
      originalKind: trace.originalDecisionKind,
      replayKind,
      kindChanged: trace.originalDecisionKind !== replayKind,
      originalConfidence: trace.originalConfidenceOverall,
      replayConfidence,
      confidenceDelta: replayConfidence - trace.originalConfidenceOverall,
      sensorIdChanged: trace.originalSensorId !== replaySensorId,
      ...(replayKind === 'refusal' && replayDecision.reason
        ? { newRefusalReason: replayDecision.reason }
        : {}),
    };
    deltas.push(delta);
  }

  return {
    deltas,
    summary: summarise(deltas),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Rebuild a kernel-shaped ThoughtRequest from the persisted trace.
 *
 * We deliberately don't import the full `ThoughtRequest` type here
 * because the runner is duck-typed; the kernel's own runtime shape
 * checks (in `inviolable`, `selectPersona`, etc.) will catch any
 * malformed scope at replay time.
 */
function rebuildThoughtRequest(trace: ReplayInput): unknown {
  const scope =
    trace.scope.kind === 'tenant'
      ? {
          kind: 'tenant',
          tenantId: trace.scope.tenantId ?? '',
          actorUserId: trace.scope.actorUserId,
          roles: trace.scope.roles,
          personaId: trace.scope.personaId,
        }
      : {
          kind: 'platform',
          actorUserId: trace.scope.actorUserId,
          roles: trace.scope.roles,
          personaId: trace.scope.personaId,
        };

  return {
    threadId: trace.threadId,
    userMessage: trace.userMessage,
    scope,
    tier: trace.tier,
    stakes: trace.stakes,
    surface: trace.surface,
  };
}

function summarise(deltas: ReadonlyArray<ReplayDelta>): ReplaySummary {
  const total = deltas.length;
  if (total === 0) {
    return {
      totalReplayed: 0,
      kindFlips: 0,
      meanConfidenceDelta: 0,
      p95ConfidenceDelta: 0,
      newRefusals: 0,
      newAnswers: 0,
      perCategoryRates: { answer: 0, softened: 0, refusal: 0 },
    };
  }

  let kindFlips = 0;
  let newRefusals = 0;
  let newAnswers = 0;
  const confidenceDeltas: number[] = [];
  const replayBuckets = { answer: 0, softened: 0, refusal: 0 };

  for (const d of deltas) {
    if (d.kindChanged) kindFlips += 1;
    if (
      d.replayKind === 'refusal' &&
      (d.originalKind === 'answer' || d.originalKind === 'softened')
    ) {
      newRefusals += 1;
    }
    if (
      (d.replayKind === 'answer' || d.replayKind === 'softened') &&
      d.originalKind === 'refusal'
    ) {
      newAnswers += 1;
    }
    confidenceDeltas.push(d.confidenceDelta);
    replayBuckets[d.replayKind] += 1;
  }

  return {
    totalReplayed: total,
    kindFlips,
    meanConfidenceDelta: mean(confidenceDeltas),
    p95ConfidenceDelta: p95Abs(confidenceDeltas),
    newRefusals,
    newAnswers,
    perCategoryRates: {
      answer: replayBuckets.answer / total,
      softened: replayBuckets.softened / total,
      refusal: replayBuckets.refusal / total,
    },
  };
}

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/**
 * p95 of |confidenceDelta|. We take the absolute value because a
 * regression run cares about the magnitude of drift in either
 * direction, not the sign — a 0.4 drop and a 0.4 gain are both
 * "the kernel is producing different confidence now."
 */
function p95Abs(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].map((x) => Math.abs(x)).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx] ?? 0;
}
