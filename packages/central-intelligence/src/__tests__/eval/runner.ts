/**
 * Eval runner — drives `composeSovereign()` through a corpus of
 * scenarios, captures aggregate metrics, and runs the per-scenario
 * `expected.*` assertions.
 *
 * Pure deterministic harness:
 *   - One stub-sensor per scenario (returns the canned text exactly).
 *   - Fresh in-memory sinks per scenario for isolation.
 *   - Fixed clock + rng so latency / cot-sample numbers are stable.
 *
 * Aggregate summary: total / passed / failed, mean confidence, mean
 * + p95 latency, refusal rate, drift rate, gate-block rate. The
 * baseline diff is owned by `eval.test.ts`; this module only produces
 * the numbers.
 */

import {
  composeSovereign,
  createInMemoryCotReservoirSink,
  createInMemoryPersonaDriftSink,
  createInMemoryProvenanceSink,
  createInMemoryApprovalStore,
  createInMemoryNudgeDedupe,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type SubstrateSinks,
} from '../../kernel/index.js';
import type { BrainDecision, GateVerdict } from '../../kernel/kernel-types.js';
import type { EvalScenario } from './scenarios.js';

// ─────────────────────────────────────────────────────────────────────
// Result + summary types
// ─────────────────────────────────────────────────────────────────────

export interface EvalResult {
  readonly scenarioId: string;
  readonly category: EvalScenario['category'];
  readonly pass: boolean;
  readonly failures: ReadonlyArray<string>;
  readonly metrics: {
    readonly latencyMs: number;
    readonly confidenceOverall: number;
    readonly decisionKind: BrainDecision['kind'];
    readonly driftEventCount: number;
    readonly gateVerdicts: {
      readonly inviolable: GateVerdict['status'];
      readonly policy: GateVerdict['status'];
      readonly drift: GateVerdict['status'];
      readonly cognitiveLoad: GateVerdict['status'];
    };
  };
}

export interface EvalSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly meanConfidence: number;
  readonly meanLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly refusalRate: number;
  readonly driftRate: number;
  readonly gateBlockRate: {
    readonly inviolable: number;
    readonly policy: number;
    readonly drift: number;
  };
}

export interface EvalSuiteOutcome {
  readonly results: ReadonlyArray<EvalResult>;
  readonly summary: EvalSummary;
}

// ─────────────────────────────────────────────────────────────────────
// Stub sensor — returns the scenario's canned response verbatim. Fixed
// `latencyMs: 1` so the kernel's recorded latency depends only on the
// fixed clock progression (here, also 0 — see `clock` below).
// ─────────────────────────────────────────────────────────────────────

function buildStubSensor(scenario: EvalScenario): Sensor {
  return {
    id: 'eval-stub',
    modelId: 'eval-stub-1',
    priority: 1,
    capabilities: ['fast', 'thinking'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      return {
        text: scenario.stubResponse.text,
        thought: scenario.stubResponse.thought ?? null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'eval-stub-1',
        sensorId: 'eval-stub',
      };
    },
  };
}

// Fixed UTC clock so kernel-recorded latency is deterministic across
// runs. We advance the clock by 1ms per `clock()` call so the kernel
// records a positive latency rather than 0 — pleasant for diffs.
function buildFixedClock(): () => Date {
  let nowMs = new Date('2026-05-05T08:00:00.000Z').getTime();
  return () => {
    const d = new Date(nowMs);
    nowMs += 1;
    return d;
  };
}

// Brief async pause so the fire-and-forget provenance write has time
// to land before the next scenario starts.
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ─────────────────────────────────────────────────────────────────────
// Per-scenario runner
// ─────────────────────────────────────────────────────────────────────

export async function runEvalScenario(scenario: EvalScenario): Promise<EvalResult> {
  const cot = createInMemoryCotReservoirSink();
  const drift = createInMemoryPersonaDriftSink();
  const provenance = createInMemoryProvenanceSink();
  const sinks: SubstrateSinks = { cot, drift, provenance };

  // Multi-turn scenarios carry an in-line `priorTurns` array; we
  // surface it through `priorTurnsLoader` so the kernel mixes it into
  // the sensor call args exactly the same way it would in production.
  const priorTurnsLoader = scenario.priorTurns
    ? async (_threadId: string) => scenario.priorTurns!
    : undefined;

  const sov = composeSovereign({
    extraSensors: [buildStubSensor(scenario)],
    substrateSinks: sinks,
    approvalStore: createInMemoryApprovalStore(),
    nudgeDedupe: createInMemoryNudgeDedupe(),
    clock: buildFixedClock(),
    // Deterministic rng — high enough to suppress all CoT sampling
    // except critical-stakes (rate=1.0). Keeps drift sinks comparable.
    rng: () => 0.999,
    ...(priorTurnsLoader ? { priorTurnsLoader } : {}),
  });

  const startedWall = Date.now();
  const decision = await sov.kernel.think(scenario.request);
  const elapsedWall = Date.now() - startedWall;
  await flushAsync();

  const failures: string[] = [];

  // ── decision-kind assertion ────────────────────────────────────
  if (decision.kind !== scenario.expected.kind) {
    failures.push(
      `expected decision.kind="${scenario.expected.kind}", got "${decision.kind}"`,
    );
  }

  // ── gate assertion ─────────────────────────────────────────────
  if (scenario.expected.expectedGate !== undefined && scenario.expected.expectedGate !== null) {
    if (decision.kind === 'refusal') {
      if (decision.gateThatRefused !== scenario.expected.expectedGate) {
        failures.push(
          `expected refusal at gate "${scenario.expected.expectedGate}", got "${decision.gateThatRefused}"`,
        );
      }
    } else if (decision.kind === 'softened') {
      // For softened, the policy/drift gate is the most informative
      // signal. We accept either gate matching the expected name.
      const gateStatus = readGateStatus(decision, scenario.expected.expectedGate);
      if (gateStatus !== 'soften' && gateStatus !== 'block') {
        failures.push(
          `expected gate "${scenario.expected.expectedGate}" to soften/block, got "${gateStatus}"`,
        );
      }
    }
  }

  // ── text content assertions (only when decision carries text) ──
  const text = decisionText(decision);
  if (scenario.expected.mustContain) {
    for (const fragment of scenario.expected.mustContain) {
      if (!text.includes(fragment)) {
        failures.push(`output should contain "${fragment}"`);
      }
    }
  }
  if (scenario.expected.mustNotContain) {
    for (const fragment of scenario.expected.mustNotContain) {
      if (text.includes(fragment)) {
        failures.push(`output should NOT contain "${fragment}"`);
      }
    }
  }

  // ── domain-capability single-substring assertions (additive sugar)
  // The richer mustContain/mustNotContain arrays are still preferred;
  // these fields exist so capability scenarios can spell intent more
  // tersely (one assertion per scenario).
  if (
    scenario.expected.expectedSubstring !== undefined &&
    !text.includes(scenario.expected.expectedSubstring)
  ) {
    failures.push(
      `output should contain expectedSubstring "${scenario.expected.expectedSubstring}"`,
    );
  }
  if (
    scenario.expected.expectedNotSubstring !== undefined &&
    text.includes(scenario.expected.expectedNotSubstring)
  ) {
    failures.push(
      `output should NOT contain expectedNotSubstring "${scenario.expected.expectedNotSubstring}"`,
    );
  }

  // ── confidence floor assertion (only for non-refusal) ──────────
  const confidenceOverall = decisionConfidence(decision);
  if (
    scenario.expected.minConfidence !== undefined &&
    decision.kind !== 'refusal' &&
    confidenceOverall < scenario.expected.minConfidence
  ) {
    failures.push(
      `confidence ${confidenceOverall.toFixed(3)} < min ${scenario.expected.minConfidence}`,
    );
  }

  // ── drift event count assertion ────────────────────────────────
  const driftEventCount = drift.events().length;
  if (
    scenario.expected.expectedDriftCount !== undefined &&
    driftEventCount < scenario.expected.expectedDriftCount
  ) {
    failures.push(
      `expected at least ${scenario.expected.expectedDriftCount} drift event(s), got ${driftEventCount}`,
    );
  }

  // ── latency budget assertion ───────────────────────────────────
  if (
    scenario.expected.maxLatencyMs !== undefined &&
    elapsedWall > scenario.expected.maxLatencyMs
  ) {
    failures.push(
      `wall-clock latency ${elapsedWall}ms > max ${scenario.expected.maxLatencyMs}ms`,
    );
  }

  return {
    scenarioId: scenario.id,
    category: scenario.category,
    pass: failures.length === 0,
    failures,
    metrics: {
      latencyMs: elapsedWall,
      confidenceOverall,
      decisionKind: decision.kind,
      driftEventCount,
      gateVerdicts: readAllGateStatuses(decision),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Suite runner — serial loop, aggregate summary
// ─────────────────────────────────────────────────────────────────────

export async function runEvalSuite(
  scenarios: ReadonlyArray<EvalScenario>,
): Promise<EvalSuiteOutcome> {
  const results: EvalResult[] = [];
  for (const s of scenarios) {
    const r = await runEvalScenario(s);
    results.push(r);
  }
  const summary = aggregate(results);
  return { results, summary };
}

function aggregate(results: ReadonlyArray<EvalResult>): EvalSummary {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;

  const nonRefusals = results.filter((r) => r.metrics.decisionKind !== 'refusal');
  const meanConfidence =
    nonRefusals.length === 0
      ? 0
      : nonRefusals.reduce((acc, r) => acc + r.metrics.confidenceOverall, 0) /
        nonRefusals.length;

  const latencies = results.map((r) => r.metrics.latencyMs).slice().sort((a, b) => a - b);
  const meanLatencyMs =
    latencies.length === 0 ? 0 : latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95LatencyMs =
    latencies.length === 0 ? 0 : latencies[Math.min(latencies.length - 1, Math.floor(0.95 * latencies.length))]!;

  const refusalRate =
    total === 0 ? 0 : results.filter((r) => r.metrics.decisionKind === 'refusal').length / total;
  const driftRate =
    total === 0 ? 0 : results.filter((r) => r.metrics.driftEventCount > 0).length / total;

  const gateBlockRate = {
    inviolable:
      total === 0
        ? 0
        : results.filter((r) => r.metrics.gateVerdicts.inviolable === 'block').length / total,
    policy:
      total === 0
        ? 0
        : results.filter((r) => r.metrics.gateVerdicts.policy === 'block').length / total,
    drift:
      total === 0
        ? 0
        : results.filter((r) => r.metrics.gateVerdicts.drift === 'block').length / total,
  };

  return {
    total,
    passed,
    failed,
    meanConfidence,
    meanLatencyMs,
    p95LatencyMs,
    refusalRate,
    driftRate,
    gateBlockRate,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function decisionText(d: BrainDecision): string {
  if (d.kind === 'answer' || d.kind === 'softened') return d.text;
  return '';
}

function decisionConfidence(d: BrainDecision): number {
  if (d.kind === 'answer' || d.kind === 'softened') return d.confidence.overall;
  return 0;
}

function readGateStatus(
  d: BrainDecision,
  gate: 'inviolable' | 'policy' | 'drift' | 'cognitive-load',
): GateVerdict['status'] {
  if (d.kind === 'refusal') {
    // cognitive-load can never be the refusing gate (kernel only ever
    // refuses at inviolable / policy / drift). For a refusal decision
    // a non-refusing gate effectively reports "pass".
    if (gate === 'cognitive-load') return 'pass';
    return d.gateThatRefused === gate ? 'block' : 'pass';
  }
  if (gate === 'cognitive-load') return d.gates.cognitiveLoad.status;
  return d.gates[gate].status;
}

function readAllGateStatuses(d: BrainDecision): EvalResult['metrics']['gateVerdicts'] {
  if (d.kind === 'refusal') {
    return {
      inviolable: d.gateThatRefused === 'inviolable' ? 'block' : 'pass',
      policy: d.gateThatRefused === 'policy' ? 'block' : 'pass',
      drift: d.gateThatRefused === 'drift' ? 'block' : 'pass',
      cognitiveLoad: 'pass',
    };
  }
  return {
    inviolable: d.gates.inviolable.status,
    policy: d.gates.policy.status,
    drift: d.gates.drift.status,
    cognitiveLoad: d.gates.cognitiveLoad.status,
  };
}
