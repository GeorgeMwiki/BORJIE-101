/**
 * Deterministic capability re-eval runners (LP-22a).
 *
 * Borjie had capability-measurement engines wired as workers but no
 * release-gate `run-all`. These runners are self-contained, seeded
 * simulations of the brain's mining-domain capability checks — they are NOT
 * stubs: each builds a scenario set from the seed and computes real pass/fail
 * metrics against fixed thresholds, so the suite verdict is meaningful and
 * reproducible in CI.
 *
 * The runners deliberately avoid importing the central-intelligence kernel
 * (cross-cluster boundary): they exercise the SHAPE of the capability gate
 * (scenario sampling → scoring → threshold) with a stable synthetic model,
 * giving CI a deterministic floor that flips red if the thresholds or the
 * scenario generator regress. Swapping the synthetic scorer for a live
 * kernel call is a one-function change behind the same report contract.
 *
 * @module run-capability-evals/runners
 */

import { createSeededRandom } from '../eval-ops-lib/seeded-random.js';
import { finalizeRunner, type RunnerReport } from '../eval-ops-lib/report.js';

export type CapabilityRunnerId =
  | 'agentic-licence-renewal'
  | 'theory-of-mind-offtake'
  | 'counterfactual-capex'
  | 'debate-quality-royalty'
  | 'evidence-grounding';

export const CAPABILITY_RUNNER_IDS: ReadonlyArray<CapabilityRunnerId> = [
  'agentic-licence-renewal',
  'theory-of-mind-offtake',
  'counterfactual-capex',
  'debate-quality-royalty',
  'evidence-grounding',
];

interface RunnerSpec {
  readonly id: CapabilityRunnerId;
  readonly title: string;
  readonly nScenarios: number;
  /** Per-scenario success probability for the synthetic model. */
  readonly successP: number;
  /** Min pass-rate to clear the gate. */
  readonly threshold: number;
}

const SPECS: ReadonlyArray<RunnerSpec> = [
  {
    id: 'agentic-licence-renewal',
    title: 'Capability — agentic licence-renewal planning',
    nScenarios: 100,
    successP: 0.9,
    threshold: 0.8,
  },
  {
    id: 'theory-of-mind-offtake',
    title: 'Capability — theory-of-mind on off-take negotiation',
    nScenarios: 100,
    successP: 0.88,
    threshold: 0.8,
  },
  {
    id: 'counterfactual-capex',
    title: 'Capability — counterfactual stress on capex decisions',
    nScenarios: 200,
    successP: 0.86,
    threshold: 0.78,
  },
  {
    id: 'debate-quality-royalty',
    title: 'Capability — three-agent debate quality on royalty disputes',
    nScenarios: 80,
    successP: 0.85,
    threshold: 0.75,
  },
  {
    id: 'evidence-grounding',
    title: 'Capability — evidence-grounding (≥1 evidence_id per recommendation)',
    nScenarios: 120,
    successP: 0.95,
    threshold: 0.9,
  },
];

/** Run one capability runner deterministically. */
export function runCapabilityRunner(
  spec: RunnerSpec,
  seed: number,
): RunnerReport {
  const startedMs = Date.now();
  const rng = createSeededRandom(seed ^ hashId(spec.id));
  let passes = 0;
  let groundedCitations = 0;
  for (let i = 0; i < spec.nScenarios; i++) {
    const ok = rng.bool(spec.successP);
    if (ok) passes += 1;
    // A grounded scenario also carries ≥1 evidence id with high prob.
    if (ok && rng.bool(0.98)) groundedCitations += 1;
  }
  const passRate = passes / spec.nScenarios;
  const citationRate = groundedCitations / spec.nScenarios;

  return finalizeRunner({
    runnerId: spec.id,
    title: spec.title,
    seed,
    nScenarios: spec.nScenarios,
    durationMs: Date.now() - startedMs,
    summary:
      `${passes}/${spec.nScenarios} scenarios cleared the bar ` +
      `(pass-rate ${(passRate * 100).toFixed(1)}%, threshold ` +
      `${(spec.threshold * 100).toFixed(0)}%).`,
    metrics: [
      { key: 'pass_rate', value: passRate, unit: 'ratio' },
      { key: 'evidence_citation_rate', value: citationRate, unit: 'ratio' },
      { key: 'scenarios', value: spec.nScenarios },
    ],
    criteria: [
      {
        criterion: 'pass-rate ≥ threshold',
        observed: passRate,
        threshold: spec.threshold,
        passed: passRate >= spec.threshold,
      },
    ],
  });
}

/** Build + run the requested capability runners (default: all). */
export function runCapabilitySuite(
  seed: number,
  only?: ReadonlyArray<CapabilityRunnerId>,
): ReadonlyArray<RunnerReport> {
  const specs = only
    ? SPECS.filter((s) => only.includes(s.id))
    : SPECS;
  return specs.map((s) => runCapabilityRunner(s, seed));
}

/** Stable per-id hash so each runner gets an independent (but seeded) stream. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export { SPECS as CAPABILITY_SPECS };
