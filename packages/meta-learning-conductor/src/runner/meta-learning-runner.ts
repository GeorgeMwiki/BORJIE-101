/**
 * Meta-learning runner — the conductor's orchestration loop.
 *
 * Pipeline (Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md §2):
 *
 *   1. Open a run row (status: 'scheduled' → 'running').
 *   2. Pull traces from the TraceSource.
 *   3. Curate examples (redact + dedupe + reward-shape).
 *   4. Persist examples.
 *   5. Run before/after eval.
 *   6. Decide promote / demote / no-op / rollback.
 *   7. Apply decision to the catalogue port.
 *   8. Close the run row (status: 'succeeded').
 *   9. On any error: status: 'failed', do NOT apply decision.
 */

import { curateExamples } from '../curator/example-curator.js';
import { decidePromotion } from '../decider/promotion-decider.js';
import { runBeforeAfterEval } from '../evaluator/evaluator.js';
import type { MetaLearningRunRepository } from '../repositories/in-memory-repo.js';
import type {
  AuditChainPort,
  CapabilityCataloguePort,
  ClockPort,
  Decision,
  EvaluatorPort,
  Logger,
  MetaLearningRun,
  PIIRedactor,
  PromotionDeciderConfig,
  RewardShapingConfig,
  TraceSourcePort,
  UuidPort,
} from '../types.js';

export interface MetaLearningRunnerDeps {
  readonly capabilityCatalogue: CapabilityCataloguePort;
  readonly traceSource: TraceSourcePort;
  readonly evaluator: EvaluatorPort;
  readonly redactor: PIIRedactor;
  readonly repository: MetaLearningRunRepository;
  readonly auditChain: AuditChainPort;
  readonly clock: ClockPort;
  readonly uuid: UuidPort;
  readonly logger: Logger;
  readonly rewardShaping?: RewardShapingConfig;
  readonly deciderConfig?: PromotionDeciderConfig;
}

export interface RunOnceParams {
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly windowSinceMs?: number;
  readonly traceLimit?: number;
}

export interface RunOnceOutcome {
  readonly run: MetaLearningRun;
  readonly decision: Decision | null;
  readonly examplesCount: number;
  readonly failed: boolean;
}

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_TRACE_LIMIT = 500;

export function createMetaLearningRunner(
  deps: MetaLearningRunnerDeps,
): {
  readonly runOnce: (params: RunOnceParams) => Promise<RunOnceOutcome>;
} {
  return Object.freeze({
    runOnce: async (params: RunOnceParams): Promise<RunOnceOutcome> => {
      const startedAt = deps.clock.nowIso();
      const runId = deps.uuid.next();
      const previous = await deps.repository.findLatestRun(
        params.tenantId,
        params.capabilityId,
      );
      const prevHash = previous?.auditHash ?? null;

      const openHash = deps.auditChain.hash(prevHash, {
        id: runId,
        tenantId: params.tenantId,
        capabilityId: params.capabilityId,
        startedAt,
        status: 'running',
      });

      const openRun: MetaLearningRun = Object.freeze({
        id: runId,
        tenantId: params.tenantId,
        startedAt,
        endedAt: null,
        status: 'running',
        capabilityId: params.capabilityId,
        examplesCount: 0,
        evalMetricBefore: null,
        evalMetricAfter: null,
        decision: null,
        auditHash: openHash,
        prevHash,
      });
      await deps.repository.insertRun(openRun);

      try {
        const traces = await deps.traceSource.pull({
          tenantId: params.tenantId,
          capabilityId: params.capabilityId,
          windowSinceMs: params.windowSinceMs ?? DEFAULT_WINDOW_MS,
          limit: params.traceLimit ?? DEFAULT_TRACE_LIMIT,
        });

        const curated = curateExamples({
          tenantId: params.tenantId,
          metaRunId: runId,
          traces,
          redactor: deps.redactor,
          clock: deps.clock,
          uuid: deps.uuid,
          auditChain: (payload) =>
            deps.auditChain.hash(prevHash, payload),
          ...(deps.rewardShaping !== undefined && {
            config: deps.rewardShaping,
          }),
        });

        await deps.repository.insertExamples(curated.examples);

        deps.logger.info('curation complete', {
          tenantId: params.tenantId,
          capabilityId: params.capabilityId,
          count: curated.examples.length,
          droppedDuplicates: curated.droppedDuplicates,
          droppedLowReward: curated.droppedLowReward,
          droppedHighRedaction: curated.droppedHighRedaction,
        });

        const evalOutcome = await runBeforeAfterEval({
          tenantId: params.tenantId,
          capabilityId: params.capabilityId,
          port: deps.evaluator,
          logger: deps.logger,
        });

        const decideOutcome = decidePromotion({
          evalMetricBefore: evalOutcome.evalMetricBefore,
          evalMetricAfter: evalOutcome.evalMetricAfter,
          previousDecision: previous?.decision ?? null,
          ...(deps.deciderConfig !== undefined && {
            config: deps.deciderConfig,
          }),
        });

        deps.logger.info('decision', {
          tenantId: params.tenantId,
          capabilityId: params.capabilityId,
          decision: decideOutcome.decision,
          delta: decideOutcome.delta,
          reason: decideOutcome.reason,
        });

        await deps.capabilityCatalogue.applyDecision({
          tenantId: params.tenantId,
          capabilityId: params.capabilityId,
          decision: decideOutcome.decision,
          runId,
          evalBefore: evalOutcome.evalMetricBefore,
          evalAfter: evalOutcome.evalMetricAfter,
        });

        const endedAt = deps.clock.nowIso();
        const closedHash = deps.auditChain.hash(openHash, {
          id: runId,
          status: 'succeeded',
          examplesCount: curated.examples.length,
          evalMetricBefore: evalOutcome.evalMetricBefore,
          evalMetricAfter: evalOutcome.evalMetricAfter,
          decision: decideOutcome.decision,
          endedAt,
        });

        const closed: MetaLearningRun = Object.freeze({
          ...openRun,
          endedAt,
          status: 'succeeded',
          examplesCount: curated.examples.length,
          evalMetricBefore: evalOutcome.evalMetricBefore,
          evalMetricAfter: evalOutcome.evalMetricAfter,
          decision: decideOutcome.decision,
          auditHash: closedHash,
        });
        await deps.repository.updateRun(closed);

        return Object.freeze({
          run: closed,
          decision: decideOutcome.decision,
          examplesCount: curated.examples.length,
          failed: false,
        });
      } catch (err) {
        deps.logger.error('meta-learning run failed', {
          tenantId: params.tenantId,
          capabilityId: params.capabilityId,
          error: err instanceof Error ? err.message : String(err),
        });

        const endedAt = deps.clock.nowIso();
        const failedHash = deps.auditChain.hash(openHash, {
          id: runId,
          status: 'failed',
          endedAt,
        });
        const failed: MetaLearningRun = Object.freeze({
          ...openRun,
          endedAt,
          status: 'failed',
          auditHash: failedHash,
        });
        await deps.repository.updateRun(failed);

        return Object.freeze({
          run: failed,
          decision: null,
          examplesCount: 0,
          failed: true,
        });
      }
    },
  });
}
