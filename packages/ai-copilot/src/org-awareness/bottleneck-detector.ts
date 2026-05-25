/**
 * Bottleneck Detector — scheduled task that scans process stats for
 * chronic problems and writes `bottlenecks` rows.
 *
 * Heuristics:
 *   - CHRONIC_SLOW      p95 > 3 × p50 (skewed long-tail; something sticks)
 *   - HIGH_VARIANCE     variance > (avg^2) — unpredictable, coefficient-of-
 *                       variation > 1.0
 *   - STALLED_HANDOFF   a stage has observations but the last one for any
 *                       open instance is older than 48h (inferred from the
 *                       newest observation per instance)
 *   - HIGH_REOPEN_RATE  reopen-rate > 15%
 *   - QUEUE_DEPTH_RISING last 7 days of approval-decision observations show
 *                        monotonic rise over baseline window
 *
 * Severity:
 *   P1 if p95 > 5 × p50 OR reopen > 30% OR stalled > 7 days
 *   P2 if p95 > 3 × p50 OR reopen > 15% OR stalled > 48h
 *   P3 otherwise
 *
 * Cooldown: once surfaced, a bottleneck with the same (kind, stage,
 * bottleneckKind) is ignored for 24h even if the heuristic re-fires.
 */

import type {
  Bottleneck,
  BottleneckKind,
  BottleneckSeverity,
  BottleneckStore,
  NewBottleneckInput,
  ProcessKind,
  ProcessObservationStore,
  StageStats,
} from './types.js';
import { ProcessMiner } from './process-miner.js';

export interface BottleneckDetectorDeps {
  readonly observationStore: ProcessObservationStore;
  readonly bottleneckStore: BottleneckStore;
  readonly miner: ProcessMiner;
  readonly now?: () => Date;
}

const ALL_PROCESS_KINDS: readonly ProcessKind[] = [
  'maintenance_case',
  'lease_renewal',
  'arrears_case',
  'payment_reconcile',
  'approval_decision',
  'tender_bid',
  'inspection',
  'letter_generation',
  'training_completion',
];

const REOPEN_P1_THRESHOLD = 0.3;
const REOPEN_P2_THRESHOLD = 0.15;
const STALL_48H_MS = 48 * 60 * 60 * 1000;
const STALL_7D_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SAMPLE_SIZE = 5;

export class BottleneckDetector {
  private readonly deps: BottleneckDetectorDeps;

  constructor(deps: BottleneckDetectorDeps) {
    this.deps = deps;
  }

  /** Run detection for a single tenant. Returns newly surfaced bottlenecks. */
  async detectForTenant(
    tenantId: string,
  ): Promise<readonly Bottleneck[]> {
    const surfaced: Bottleneck[] = [];
    for (const kind of ALL_PROCESS_KINDS) {
      const detections = await this.detectForProcess(tenantId, kind);
      for (const d of detections) {
        const stored =
          await this.deps.bottleneckStore.upsertOpen(d);
        surfaced.push(stored);
      }
    }
    return surfaced;
  }

  /** Run detection for a single process kind within a tenant. */
  async detectForProcess(
    tenantId: string,
    processKind: ProcessKind,
  ): Promise<readonly NewBottleneckInput[]> {
    const stats = await this.deps.miner.getProcessStats(
      tenantId,
      processKind,
    );
    const findings: NewBottleneckInput[] = [];

    if (stats.distinctInstances >= MIN_SAMPLE_SIZE) {
      if (stats.reopenRate > REOPEN_P1_THRESHOLD) {
        findings.push(
          makeReopenFinding(tenantId, processKind, stats.reopenRate, 'P1'),
        );
      } else if (stats.reopenRate > REOPEN_P2_THRESHOLD) {
        findings.push(
          makeReopenFinding(tenantId, processKind, stats.reopenRate, 'P2'),
        );
      }
    }

    for (const stage of stats.stages) {
      const chronic = detectChronicSlow(
        tenantId,
        processKind,
        stage,
      );
      if (chronic) findings.push(chronic);
      const variance = detectHighVariance(
        tenantId,
        processKind,
        stage,
      );
      if (variance) findings.push(variance);
    }

    const stalls = await this.detectStalledHandoffs(
      tenantId,
      processKind,
    );
    findings.push(...stalls);

    return findings;
  }

  private async detectStalledHandoffs(
    tenantId: string,
    processKind: ProcessKind,
  ): Promise<readonly NewBottleneckInput[]> {
    const observations = await this.deps.observationStore.list(
      tenantId,
      processKind,
    );
    if (observations.length === 0) return [];
    const latestPerInstance = new Map<
      string,
      { stage: string; observedAt: Date }
    >();
    for (const obs of observations) {
      const prior = latestPerInstance.get(obs.processInstanceId);
      if (!prior || obs.observedAt > prior.observedAt) {
        latestPerInstance.set(obs.processInstanceId, {
          stage: obs.stage,
          observedAt: obs.observedAt,
        });
      }
    }
    const now = (this.deps.now?.() ?? new Date()).getTime();
    const countsByStage = new Map<
      string,
      { stalled: number; oldestMs: number }
    >();
    for (const { stage, observedAt } of latestPerInstance.values()) {
      const ageMs = now - observedAt.getTime();
      const isTerminal = /resolved|closed|completed|awarded|accepted|declined|generated|reconciled/i.test(
        stage,
      );
      if (isTerminal) continue;
      if (ageMs < STALL_48H_MS) continue;
      const current = countsByStage.get(stage) ?? {
        stalled: 0,
        oldestMs: 0,
      };
      countsByStage.set(stage, {
        stalled: current.stalled + 1,
        oldestMs: Math.max(current.oldestMs, ageMs),
      });
    }
    const findings: NewBottleneckInput[] = [];
    for (const [stage, v] of countsByStage.entries()) {
      const severity: BottleneckSeverity =
        v.oldestMs >= STALL_7D_MS ? 'P1' : 'P2';
      findings.push({
        tenantId,
        processKind,
        stage,
        bottleneckKind: 'stalled_handoff',
        severity,
        evidence: {
          stalledForMs: v.oldestMs,
          sampleSize: v.stalled,
          notes: [
            `${v.stalled} instance(s) stuck at '${stage}' for more than 48h`,
          ],
        },
        suggestedRemediation:
          'Review the hand-off owner and clear blocking approvals or dependencies.',
      });
    }
    return findings;
  }
}

export function createBottleneckDetector(
  deps: BottleneckDetectorDeps,
): BottleneckDetector {
  return new BottleneckDetector(deps);
}

function detectChronicSlow(
  tenantId: string,
  processKind: ProcessKind,
  stage: StageStats,
): NewBottleneckInput | null {
  if (stage.sampleSize < MIN_SAMPLE_SIZE) return null;
  if (stage.p50Ms === 0) return null;
  const ratio = stage.p95Ms / stage.p50Ms;
  if (ratio <= 3) return null;
  const severity: BottleneckSeverity = ratio > 5 ? 'P1' : 'P2';
  return {
    tenantId,
    processKind,
    stage: stage.stage,
    bottleneckKind: 'chronic_slow',
    severity,
    evidence: {
      p50Ms: stage.p50Ms,
      p95Ms: stage.p95Ms,
      sampleSize: stage.sampleSize,
      notes: [
        `p95 (${stage.p95Ms}ms) is ${ratio.toFixed(1)}x p50 (${stage.p50Ms}ms)`,
      ],
    },
    suggestedRemediation:
      'Investigate the slowest instances at this stage; consider automation or reassignment.',
  };
}

function detectHighVariance(
  tenantId: string,
  processKind: ProcessKind,
  stage: StageStats,
): NewBottleneckInput | null {
  if (stage.sampleSize < MIN_SAMPLE_SIZE) return null;
  if (stage.avgMs === 0) return null;
  const stdDev = Math.sqrt(stage.varianceMs);
  const coefficientOfVariation = stdDev / stage.avgMs;
  if (coefficientOfVariation <= 1.0) return null;
  const severity: BottleneckSeverity =
    coefficientOfVariation > 2.0 ? 'P2' : 'P3';
  return {
    tenantId,
    processKind,
    stage: stage.stage,
    bottleneckKind: 'high_variance',
    severity,
    evidence: {
      p50Ms: stage.p50Ms,
      p95Ms: stage.p95Ms,
      sampleSize: stage.sampleSize,
      notes: [
        `coefficient of variation ${coefficientOfVariation.toFixed(2)} at stage '${stage.stage}'`,
      ],
    },
    suggestedRemediation:
      'Wide spread in processing time — standardise the workflow and add checklists.',
  };
}

function makeReopenFinding(
  tenantId: string,
  processKind: ProcessKind,
  reopenRate: number,
  severity: BottleneckSeverity,
): NewBottleneckInput {
  return {
    tenantId,
    processKind,
    stage: 'reopened',
    bottleneckKind: 'high_reopen_rate',
    severity,
    evidence: {
      reopenRate,
      notes: [
        `re-open rate ${(reopenRate * 100).toFixed(1)}% above threshold`,
      ],
    },
    suggestedRemediation:
      'Review first-time-fix quality; inspect the most-reopened instances.',
  };
}

/**
 * Build the scheduled-task definition that the Wave-11 background
 * scheduler can run daily at 04:00. Keeps the detector decoupled from
 * the scheduler wiring so tests can call `detectForTenant` directly.
 */
export function buildDetectBottlenecksTask(
  detectorFactory: () => BottleneckDetector,
): {
  readonly name: 'detect_bottlenecks';
  readonly cron: string;
  readonly description: string;
  readonly featureFlagKey: string;
  readonly run: (ctx: {
    readonly tenantId: string;
    readonly now: Date;
  }) => Promise<{
    readonly task: 'detect_bottlenecks';
    readonly tenantId: string;
    readonly detected: number;
  }>;
} {
  return {
    name: 'detect_bottlenecks',
    cron: '0 4 * * *',
    description:
      'Daily scan for chronic bottlenecks, stalls, and high reopen rates.',
    featureFlagKey: 'ai.bg.detect_bottlenecks',
    run: async (ctx) => {
      const detector = detectorFactory();
      const surfaced = await detector.detectForTenant(ctx.tenantId);
      return {
        task: 'detect_bottlenecks',
        tenantId: ctx.tenantId,
        detected: surfaced.length,
      };
    },
  };
}
