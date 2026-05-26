/**
 * Loop runner — pure orchestrator of the five-layer cycle.
 *
 * Given a {@link LoopInput} and a {@link LoopRunnerDeps} bundle, the
 * runner executes:
 *
 *   1. Sensors      — caller-supplied function returns sensor items.
 *   2. Policy       — caller-supplied predicate returns allow/deny/gate.
 *   3. Tools        — caller-supplied function executes the proposed
 *                     action; returns artifacts + cost.
 *   4. Quality      — caller-supplied composite gate (or its result).
 *   5. Learning     — caller-supplied function records skill / memory /
 *                     calibration updates.
 *
 * The runner persists one row per executed layer plus one row per
 * quality signal. The run row is inserted at start with status='running'
 * and updated at end with the final status + endedAt + audit hash.
 *
 * Failure semantics are exactly as documented in
 * FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md §5:
 *
 *   - sensors=>no items                    => status='no_input'
 *   - policy=>deny                          => status='denied'
 *   - policy=>gate                          => status='gated'
 *   - tools throws / returns status='error' => status='tool_error'
 *   - quality.pass=false                    => status='quality_failed'
 *     (learning is still invoked, but only to record the failure)
 *   - learning throws                       => status='learning_error'
 *   - happy path                            => status='ok'
 *
 * Pure async function. No I/O — every side effect is delegated to a
 * port. Composition root wires the real ports from `@borjie/database`
 * and `@borjie/observability`.
 *
 * Spec: Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md.
 */

import type {
  CompositeGateResult,
  QualitySignal,
} from '@borjie/loop-quality-gates';
import {
  LoopRunnerError,
  type LayerOutcome,
  type LayerOutcomeRepository,
  type LearningOutcome,
  type LoopInput,
  type LoopLogger,
  type LoopRunRepository,
  type LoopRunResult,
  type LoopStatus,
  type PolicyOutcome,
  type QualitySignalRepository,
  type SensorsOutcome,
  type ToolsOutcome,
} from '../types.js';

export interface SensorsFn {
  (input: LoopInput): Promise<SensorsOutcome>;
}
export interface PolicyFn {
  (input: LoopInput, sensors: SensorsOutcome): Promise<PolicyOutcome>;
}
export interface ToolsFn {
  (
    input: LoopInput,
    sensors: SensorsOutcome,
    policy: PolicyOutcome,
  ): Promise<ToolsOutcome>;
}
export interface QualityFn {
  (
    input: LoopInput,
    sensors: SensorsOutcome,
    policy: PolicyOutcome,
    tools: ToolsOutcome,
  ): Promise<CompositeGateResult>;
}
export interface LearnFn {
  (
    input: LoopInput,
    sensors: SensorsOutcome,
    policy: PolicyOutcome,
    tools: ToolsOutcome,
    quality: CompositeGateResult,
  ): Promise<LearningOutcome>;
}

export interface LoopRunnerDeps {
  readonly sensorsFn: SensorsFn;
  readonly policyFn: PolicyFn;
  readonly toolsFn: ToolsFn;
  readonly qualityFn: QualityFn;
  readonly learnFn: LearnFn;
  readonly loopRunRepo: LoopRunRepository;
  readonly layerOutcomeRepo: LayerOutcomeRepository;
  readonly qualitySignalRepo: QualitySignalRepository;
  readonly logger: LoopLogger;
  /** Override the clock for tests. */
  readonly now?: () => Date;
  /** Override the id generator for tests. */
  readonly nextId?: () => string;
}

interface LayerExecution<T> {
  readonly outcome: T;
  readonly latencyMs: number;
  readonly costUsdCents: number;
}

function makeAuditHash(
  loopRunId: string,
  layer: string,
  ordinal: number,
): string {
  return `loop-${loopRunId}-${layer}-${ordinal.toString(16).padStart(4, '0')}`;
}

function makeRunAuditHash(loopRunId: string, status: string): string {
  return `loop-run-${loopRunId}-${status}`;
}

function makeSignalId(loopRunId: string, ordinal: number): string {
  return `qs-${loopRunId}-${ordinal.toString(16).padStart(4, '0')}`;
}

function makeOutcomeId(loopRunId: string, layer: string): string {
  return `lo-${loopRunId}-${layer}`;
}

async function runLayer<T>(
  fn: () => Promise<T>,
  now: () => Date,
): Promise<LayerExecution<T>> {
  const t0 = now().getTime();
  const outcome = await fn();
  const t1 = now().getTime();
  const cost = typeof (outcome as { costUsdCents?: number })?.costUsdCents
    === 'number'
    ? ((outcome as { costUsdCents: number }).costUsdCents)
    : 0;
  return {
    outcome,
    latencyMs: Math.max(0, t1 - t0),
    costUsdCents: cost,
  };
}

export async function runLoop(
  input: LoopInput,
  deps: LoopRunnerDeps,
): Promise<LoopRunResult> {
  if (!input || !input.id || !input.tenantId) {
    throw new LoopRunnerError(
      'runLoop requires input with id and tenantId',
      'INVALID_INPUT',
    );
  }

  const now = deps.now ?? (() => new Date());
  const startInsertHash = makeRunAuditHash(input.id, 'running');

  await deps.loopRunRepo.insert({
    id: input.id,
    tenantId: input.tenantId,
    loopKind: input.loopKind,
    startedAt: input.startedAt,
    status: 'running',
    auditHash: startInsertHash,
    prevHash: input.prevHash,
  });

  deps.logger.info('loop.start', {
    loopRunId: input.id,
    tenantId: input.tenantId,
    loopKind: input.loopKind,
  });

  const layerOutcomes: LayerOutcome[] = [];
  const qualitySignals: QualitySignal[] = [];
  let totalLatencyMs = 0;
  let totalCostUsdCents = 0;

  const persistLayer = async (
    layer: LayerOutcome['layer'],
    outcome: Readonly<Record<string, unknown>>,
    latencyMs: number,
    costUsdCents: number,
  ): Promise<LayerOutcome> => {
    const auditHash = makeAuditHash(input.id, layer, layerOutcomes.length);
    const rec: LayerOutcome = Object.freeze({
      layer,
      outcome,
      latencyMs,
      costUsdCents,
      auditHash,
    });
    await deps.layerOutcomeRepo.insert({
      id: makeOutcomeId(input.id, layer),
      loopRunId: input.id,
      tenantId: input.tenantId,
      layer,
      outcome,
      latencyMs,
      costUsdCents,
      auditHash,
    });
    layerOutcomes.push(rec);
    totalLatencyMs += latencyMs;
    totalCostUsdCents += costUsdCents;
    return rec;
  };

  const finalise = async (
    status: LoopStatus,
    reason: string,
    extra?: { qualityResult?: CompositeGateResult },
  ): Promise<LoopRunResult> => {
    const endedAt = now().toISOString();
    const auditHash = makeRunAuditHash(input.id, status);
    await deps.loopRunRepo.update({
      id: input.id,
      status,
      endedAt,
      auditHash,
    });
    deps.logger.info('loop.end', {
      loopRunId: input.id,
      status,
      totalLatencyMs,
      totalCostUsdCents,
    });
    return Object.freeze({
      loopRunId: input.id,
      status,
      endedAt,
      layerOutcomes: Object.freeze([...layerOutcomes]),
      qualitySignals: Object.freeze([...qualitySignals]),
      totalLatencyMs,
      totalCostUsdCents,
      auditHash,
      ...(extra?.qualityResult ? { qualityResult: extra.qualityResult } : {}),
      reason,
    });
  };

  // ── Layer 1 — Sensors ────────────────────────────────────────────────────
  let sensorsExec: LayerExecution<SensorsOutcome>;
  try {
    sensorsExec = await runLayer(() => deps.sensorsFn(input), now);
  } catch (error) {
    deps.logger.error('loop.sensors.threw', {
      loopRunId: input.id,
      message: (error as Error).message,
    });
    return finalise('learning_error', `sensors-threw:${(error as Error).message}`);
  }
  await persistLayer(
    'sensors',
    { items: sensorsExec.outcome.items },
    sensorsExec.latencyMs,
    sensorsExec.costUsdCents,
  );

  if (sensorsExec.outcome.items.length === 0) {
    return finalise('no_input', 'sensors-returned-zero-items');
  }

  // ── Layer 2 — Policy ─────────────────────────────────────────────────────
  let policyExec: LayerExecution<PolicyOutcome>;
  try {
    policyExec = await runLayer(
      () => deps.policyFn(input, sensorsExec.outcome),
      now,
    );
  } catch (error) {
    deps.logger.error('loop.policy.threw', {
      loopRunId: input.id,
      message: (error as Error).message,
    });
    return finalise('learning_error', `policy-threw:${(error as Error).message}`);
  }
  await persistLayer(
    'policy',
    {
      decision: policyExec.outcome.decision,
      ...(policyExec.outcome.gateName
        ? { gateName: policyExec.outcome.gateName }
        : {}),
      reason: policyExec.outcome.reason,
    },
    policyExec.latencyMs,
    policyExec.costUsdCents,
  );

  if (policyExec.outcome.decision === 'deny') {
    return finalise('denied', `policy-denied:${policyExec.outcome.reason}`);
  }
  if (policyExec.outcome.decision === 'gate') {
    return finalise(
      'gated',
      `policy-gated:${policyExec.outcome.gateName ?? 'unnamed'}`,
    );
  }

  // ── Layer 3 — Tools ──────────────────────────────────────────────────────
  let toolsExec: LayerExecution<ToolsOutcome>;
  try {
    toolsExec = await runLayer(
      () => deps.toolsFn(input, sensorsExec.outcome, policyExec.outcome),
      now,
    );
  } catch (error) {
    deps.logger.error('loop.tools.threw', {
      loopRunId: input.id,
      message: (error as Error).message,
    });
    await persistLayer(
      'tools',
      { status: 'error', error: (error as Error).message },
      0,
      0,
    );
    return finalise(
      'tool_error',
      `tools-threw:${(error as Error).message}`,
    );
  }
  await persistLayer(
    'tools',
    {
      status: toolsExec.outcome.status,
      artifactsCount: toolsExec.outcome.artifacts.length,
      ...(toolsExec.outcome.error ? { error: toolsExec.outcome.error } : {}),
    },
    toolsExec.latencyMs,
    toolsExec.outcome.costUsdCents,
  );

  if (toolsExec.outcome.status === 'error') {
    return finalise('tool_error', `tools-status-error:${toolsExec.outcome.error ?? 'unknown'}`);
  }

  // ── Layer 4 — Quality ────────────────────────────────────────────────────
  let qualityExec: LayerExecution<CompositeGateResult>;
  try {
    qualityExec = await runLayer(
      () =>
        deps.qualityFn(
          input,
          sensorsExec.outcome,
          policyExec.outcome,
          toolsExec.outcome,
        ),
      now,
    );
  } catch (error) {
    deps.logger.error('loop.quality.threw', {
      loopRunId: input.id,
      message: (error as Error).message,
    });
    return finalise(
      'learning_error',
      `quality-threw:${(error as Error).message}`,
    );
  }
  await persistLayer(
    'quality',
    {
      pass: qualityExec.outcome.pass,
      failedGates: qualityExec.outcome.failedGates,
      reason: qualityExec.outcome.reason,
    },
    qualityExec.latencyMs,
    0,
  );

  // Persist every emitted signal — even passing ones, so Layer 5 has the
  // full record.
  for (const sig of qualityExec.outcome.signals) {
    await deps.qualitySignalRepo.insert({
      id: makeSignalId(input.id, qualitySignals.length),
      loopRunId: input.id,
      tenantId: input.tenantId,
      signal: sig.signal,
      score: sig.score,
      weight: sig.weight,
      evidence: sig.evidence,
    });
    qualitySignals.push(sig);
  }

  // ── Layer 5 — Learning ───────────────────────────────────────────────────
  let learningExec: LayerExecution<LearningOutcome>;
  try {
    learningExec = await runLayer(
      () =>
        deps.learnFn(
          input,
          sensorsExec.outcome,
          policyExec.outcome,
          toolsExec.outcome,
          qualityExec.outcome,
        ),
      now,
    );
  } catch (error) {
    deps.logger.error('loop.learning.threw', {
      loopRunId: input.id,
      message: (error as Error).message,
    });
    return finalise(
      'learning_error',
      `learning-threw:${(error as Error).message}`,
      qualityExec.outcome.pass ? {} : { qualityResult: qualityExec.outcome },
    );
  }
  await persistLayer(
    'learning',
    {
      skillUpdates: learningExec.outcome.skillUpdates,
      memoryUpdates: learningExec.outcome.memoryUpdates,
      calibrationUpdates: learningExec.outcome.calibrationUpdates,
      reason: learningExec.outcome.reason,
    },
    learningExec.latencyMs,
    learningExec.costUsdCents,
  );

  if (!qualityExec.outcome.pass) {
    return finalise(
      'quality_failed',
      `quality-failed:${qualityExec.outcome.reason}`,
      { qualityResult: qualityExec.outcome },
    );
  }

  return finalise('ok', 'all-five-layers-passed');
}
