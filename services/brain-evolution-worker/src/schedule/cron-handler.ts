/**
 * Cron handler — runs the nightly brain-evolution sweep.
 *
 * Designed to be invoked TWO ways:
 *
 *   1. In-process via a node-cron schedule (every 24h, 02:00 tenant-
 *      local time approximated as 02:00 UTC at this layer; per-tenant
 *      timezone-aware scheduling is a later enhancement).
 *
 *   2. By an external scheduler (Kubernetes CronJob) which fires the
 *      service entrypoint at 02:00 UTC daily. The entrypoint sets
 *      `BRAIN_EVOLUTION_INTERVAL_MS=0` so this handler runs once + exits.
 *
 * Both paths reuse `runNightlySweep` — the cron loop just calls it on a
 * schedule. The Kubernetes CronJob short-circuits the loop and calls
 * `runNightlySweep` once.
 */

import { randomBytes } from 'crypto';

import { iterateTenants, type TenantIterationSummary } from './tenant-iteration.js';
import { readDailyTraces, type TraceReader } from '../pipeline/stage-01-read-traces.js';
import { reflectOnDay, type ReflectionEngine } from '../pipeline/stage-02-reflect.js';
import { extractDeltas, type DeltaExtractor } from '../pipeline/stage-03-extract-deltas.js';
import { writeApprovedDeltas, type MemoryWriter } from '../pipeline/stage-04-write-memory.js';
import { emitEvolutionReport, type ReportSink } from '../pipeline/stage-05-emit-report.js';
import { generateAutobiographyDeltas } from '../pipeline/stage-06-autobiography.js';
import { reviewDelta, type ConstitutionVerifierPort } from '../safety/review-gate.js';
import type {
  BrainWorkerLogger,
  TenantRunResult,
  DeltaApplicationResult,
} from '../types.js';

export interface TenantDirectory {
  /** List every active tenant the sweep should process. */
  listActiveTenants(): Promise<ReadonlyArray<string>>;
  /** Jurisdiction ISO-3166-1 alpha-2 for a tenant. Used by the verifier. */
  jurisdictionFor(tenantId: string): string;
}

export interface NightlySweepDeps {
  readonly directory: TenantDirectory;
  readonly traceReader: TraceReader;
  readonly reflectionEngine: ReflectionEngine;
  readonly memoryWriter: MemoryWriter;
  readonly reportSink: ReportSink;
  readonly verifier: ConstitutionVerifierPort;
  readonly extractor?: DeltaExtractor;
  readonly logger?: BrainWorkerLogger;
  /** Override for tests; defaults to `new Date()`. */
  readonly clock?: { now(): Date };
  readonly windowMs?: number;
  readonly concurrency?: number;
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The whole nightly sweep — list tenants, iterate with bounded
 * concurrency, return summary. Never throws.
 */
export async function runNightlySweep(
  deps: NightlySweepDeps,
): Promise<TenantIterationSummary> {
  const tenantIds = await safeListTenants(deps);
  if (tenantIds.length === 0) {
    deps.logger?.info?.({}, 'brain-evolution-worker: no tenants — sweep is a no-op');
    return {
      totalTenants: 0,
      ok: 0,
      skipped: 0,
      errored: 0,
      totalDeltasApplied: 0,
      totalDeltasEscalated: 0,
      totalDeltasBlocked: 0,
      results: [],
    };
  }

  return iterateTenants({
    tenantIds,
    ...(deps.concurrency !== undefined ? { concurrency: deps.concurrency } : {}),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    runForTenant: (tenantId) => runForTenant(deps, tenantId),
  });
}

/**
 * Pipeline for a single tenant. Each stage runs through its dedicated
 * port; failures degrade gracefully — the run produces a report even
 * when an upstream stage produced zero data.
 */
async function runForTenant(
  deps: NightlySweepDeps,
  tenantId: string,
): Promise<TenantRunResult> {
  const now = (deps.clock ?? { now: () => new Date() }).now();
  const windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS;
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - windowMs);
  const runId = `brevo_${windowEnd.getTime()}_${randomBytes(4).toString('hex')}`;

  const traceResult = await readDailyTraces(deps.traceReader, {
    tenantId,
    windowStart,
    windowEnd,
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  });

  if (traceResult.traces.length === 0) {
    deps.logger?.info?.(
      { tenantId, runId },
      'brain-evolution-worker: no traces — skipping reflection',
    );
    return {
      tenantId,
      status: 'skipped',
      tracesRead: 0,
      deltasApplied: 0,
      deltasEscalated: 0,
      deltasBlocked: 0,
      errorMessage: null,
      report: null,
    };
  }

  const reflection = await reflectOnDay(deps.reflectionEngine, {
    tenantId,
    windowStart: traceResult.windowStart,
    windowEnd: traceResult.windowEnd,
    traces: traceResult.traces,
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  });

  const reflectionDeltas = extractDeltas({
    reflection,
    ...(deps.extractor !== undefined ? { extractor: deps.extractor } : {}),
  });

  // Stage 06 — autobiography deltas. Mixed into the same review-gate +
  // write path as reflection-derived deltas so the constitution gets
  // first say on every narrative the brain commits to its persona block.
  const autobiographyDeltas = generateAutobiographyDeltas({
    tenantId,
    windowStart: traceResult.windowStart,
    windowEnd: traceResult.windowEnd,
    traces: traceResult.traces,
    ...(deps.logger ? { logger: deps.logger } : {}),
  });

  const deltas = [...reflectionDeltas, ...autobiographyDeltas];

  // Run each delta through the review gate IN SERIES — the verifier is
  // sync so parallelism would just rack up event-loop microtasks.
  const approvals: DeltaApplicationResult[] = deltas.map((delta) =>
    reviewDelta(
      {
        verifier: deps.verifier,
        jurisdictionFor: (id) => deps.directory.jurisdictionFor(id),
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      },
      delta,
    ),
  );

  const writeResults = await writeApprovedDeltas(deps.memoryWriter, {
    deltas,
    approvals,
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  });

  const report = await emitEvolutionReport(deps.reportSink, {
    tenantId,
    runId,
    reflection,
    deltas,
    results: writeResults,
    tracesRead: traceResult.traces.length,
    emittedAt: windowEnd,
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  });

  const applied = writeResults.filter((r) => r.applied).length;
  const escalated = writeResults.filter((r) => !r.applied && r.escalated).length;
  const blocked = writeResults.filter((r) => !r.applied && !r.escalated).length;

  return {
    tenantId,
    status: 'ok',
    tracesRead: traceResult.traces.length,
    deltasApplied: applied,
    deltasEscalated: escalated,
    deltasBlocked: blocked,
    errorMessage: null,
    report,
  };
}

async function safeListTenants(
  deps: NightlySweepDeps,
): Promise<ReadonlyArray<string>> {
  try {
    return await deps.directory.listActiveTenants();
  } catch (error) {
    deps.logger?.warn?.(
      { err: error instanceof Error ? error.message : String(error) },
      'brain-evolution-worker: tenant directory failed — sweep aborted',
    );
    return [];
  }
}
