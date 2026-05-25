/**
 * Stage 03 — Reflect.
 *
 * For each cluster, run an LLM critic that writes a 1-paragraph
 * "what went well / what failed / what to do next time" reflection.
 * Production wires a Haiku-backed critic at the composition root;
 * the default in-worker implementation produces a deterministic stub
 * so unit tests can verify the orchestrator wiring.
 *
 * B4 Phase B: optional Constitutional critic (RLAIF labelling). When
 * the composition root wires a `constitutionalCritic`, each
 * reflection is scored against the BORJIE constitution (TZ Rental
 * Act, GDPR / PDPA, currency-chain rules, inviolable IP). The verdict
 * is logged alongside the reflection so the optimisation loop has a
 * principled reference signal — even without humans labelling.
 */

import type {
  ReflectionCritic,
  ReflectionResult,
  StageLogger,
  TraceCluster,
} from './types.js';

/**
 * Verdict shape the constitutional critic returns. Duck-typed locally
 * so the worker has no compile-time dependency on
 * `@borjie/central-intelligence`.
 */
export interface ConstitutionalCriticPort {
  score(reflection: {
    clusterId: string;
    tenantId: string | null;
    text: string;
    intentLabel: string;
  }): Promise<{
    clusterId: string;
    overall: number;
    passed: boolean;
    scores: ReadonlyArray<{ ruleId: string; score: number; rationale: string }>;
  }>;
}

export interface ReflectArgs {
  readonly clusters: ReadonlyArray<TraceCluster>;
  readonly critic?: ReflectionCritic;
  readonly logger: StageLogger;
  /**
   * Optional RLAIF constitutional critic. When supplied, each
   * reflection is scored after the main critic produces it. The
   * scoring runs in best-effort mode — a critic failure logs + skips
   * without dropping the reflection.
   */
  readonly constitutionalCritic?: ConstitutionalCriticPort;
}

export async function runReflectStage(
  args: ReflectArgs,
): Promise<ReadonlyArray<ReflectionResult>> {
  const critic = args.critic ?? createStubCritic();
  const out: ReflectionResult[] = [];
  let constitutionalChecks = 0;
  let constitutionalPasses = 0;
  for (const cluster of args.clusters) {
    try {
      const r = await critic.reflect(cluster);
      out.push(r);

      // RLAIF — score against the constitution if a critic is wired.
      if (args.constitutionalCritic) {
        try {
          const verdict = await args.constitutionalCritic.score({
            clusterId: r.clusterId,
            tenantId: r.tenantId,
            text: r.text,
            intentLabel: r.intentLabel,
          });
          constitutionalChecks += 1;
          if (verdict.passed) constitutionalPasses += 1;
          args.logger.info(
            {
              stage: '03-reflect',
              clusterId: r.clusterId,
              constitutionalOverall: verdict.overall,
              constitutionalPassed: verdict.passed,
              failingRules: verdict.scores
                .filter((s) => s.score < 1)
                .map((s) => s.ruleId),
            },
            'constitutional critic verdict',
          );
        } catch (error) {
          args.logger.warn(
            {
              stage: '03-reflect',
              clusterId: r.clusterId,
              err: asMessage(error),
            },
            'constitutional critic threw — continuing without verdict',
          );
        }
      }
    } catch (error) {
      args.logger.warn(
        {
          stage: '03-reflect',
          clusterId: cluster.clusterId,
          err: asMessage(error),
        },
        'reflect stage critic threw — skipping cluster',
      );
    }
  }
  args.logger.info(
    {
      stage: '03-reflect',
      clusters: args.clusters.length,
      reflections: out.length,
      constitutionalChecks,
      constitutionalPasses,
    },
    'reflect stage complete',
  );
  return out;
}

/**
 * Deterministic stub critic. The text is concrete enough to be
 * recognisable in audit dashboards ("stub-haiku: ...") so an operator
 * can tell at a glance whether the real critic is wired.
 */
export function createStubCritic(): ReflectionCritic {
  return {
    async reflect(cluster) {
      const verb =
        cluster.outcome === 'success'
          ? 'worked well'
          : cluster.outcome === 'failure'
            ? 'failed'
            : 'was mixed';
      const text =
        `stub-haiku: cluster '${cluster.intentLabel}' (${cluster.traces.length} traces, score=${cluster.score.toFixed(2)}) ${verb}. ` +
        `Next time, run the typed action with explicit grounding.`;
      return {
        clusterId: cluster.clusterId,
        tenantId: cluster.tenantId,
        text,
        outcome: cluster.outcome,
        intentLabel: cluster.intentLabel,
      };
    },
  };
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
