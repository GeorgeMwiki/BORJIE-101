/**
 * Decision Retrospective Worker — Wave DECISION-LEGIBILITY.
 *
 * Ticks every 24 hours. For each decision whose prediction horizon
 * has passed (joined with related_prediction_id) and that does not
 * yet have a row in `decision_outcomes`, the worker:
 *
 *   1. Reads the matched reconciliation row from
 *      `outcome_reconciliations` (status + drift_score).
 *   2. Maps reconciliation status to retrospective grade:
 *        matched      -> good (decision aligned with outcome)
 *        divergent    -> bad if the divergence cost money (drift_score
 *                        > 0.5 OR observed_value_tzs < 0); neutral if
 *                        the divergence saved money
 *        undetermined -> undetermined
 *        expired      -> undetermined
 *   3. Generates a plain-language `learnings` text summarising the gap.
 *   4. Calls the recorder's `recordOutcome` so the decision_outcomes
 *      row is hash-chained.
 *
 * Decisions WITHOUT a related_prediction_id fall back to a "soft" grade
 * after a fixed wait (default 60d) using a simpler rubric — see
 * `softGradeForUnpredictedDecision`.
 *
 * Lifecycle:
 *   - `start()` arms an interval (default 24h, tunable via env).
 *   - `tickOnce()` exposed for tests.
 *   - `stop()` clears the timer.
 *
 * Failure containment:
 *   - No DB → no-op + warn once.
 *   - Per-row failures isolated; loop continues.
 *   - All errors logged via Pino (no console statements in services).
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { DecisionRecorder } from '../services/decision-journal/index.js';
import type { RetrospectiveGrade } from '../services/decision-journal/index.js';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH = 100;
const DEFAULT_SOFT_GRADE_WAIT_DAYS = 60;

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface PendingDecision {
  readonly id: string;
  readonly tenantId: string;
  readonly decisionSubject: string;
  readonly relatedPredictionId: string | null;
  readonly decidedAt: string;
  /** Joined columns from outcome_reconciliations (when present). */
  readonly reconciliationStatus: string | null;
  readonly driftScore: number | null;
  readonly observedValueTzs: number | null;
  readonly observedOutcomeSummary: string | null;
}

export interface DecisionRetrospectiveWorkerOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly recorder: DecisionRecorder;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly batchSize?: number;
  readonly softGradeWaitDays?: number;
  readonly now?: () => Date;
}

export interface DecisionRetrospectiveWorkerHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<RetrospectiveTickResult>;
}

export interface RetrospectiveTickResult {
  readonly considered: number;
  readonly graded: number;
  readonly skipped: number;
  readonly failed: number;
}

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function asString(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return typeof v === 'string' ? v : '';
}

function asNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const v = row[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNullableNumber(
  row: Record<string, unknown>,
  key: string,
): number | null {
  const v = row[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Map reconciliation status + drift + observed value to a grade.
 * - matched + small drift  -> good
 * - matched + medium drift -> good (still within band)
 * - divergent + cost-bearing (negative observed value OR drift > 0.5) -> bad
 * - divergent + benign     -> neutral
 * - undetermined / expired -> undetermined
 */
export function gradeFromReconciliation(
  status: string | null,
  driftScore: number | null,
  observedValueTzs: number | null,
): RetrospectiveGrade {
  if (status === 'matched') return 'good';
  if (status === 'divergent') {
    const drift = driftScore ?? 0;
    const observed = observedValueTzs ?? 0;
    if (drift > 0.5 || observed < 0) return 'bad';
    return 'neutral';
  }
  return 'undetermined';
}

/**
 * Generate a plain-language learning string the brain can later
 * surface when explaining the decision retrospectively.
 */
export function buildLearningsText(
  subject: string,
  grade: RetrospectiveGrade,
  driftScore: number | null,
  observedValueTzs: number | null,
  observedSummary: string | null,
): string {
  const driftPct =
    driftScore !== null ? Math.round(driftScore * 100) : null;
  const valueClause =
    observedValueTzs !== null
      ? observedValueTzs >= 0
        ? `Observed value: TZS ${Math.round(observedValueTzs).toLocaleString('en-US')} (saving / revenue).`
        : `Observed cost: TZS ${Math.round(Math.abs(observedValueTzs)).toLocaleString('en-US')}.`
      : null;
  const driftClause =
    driftPct !== null ? `Drift from predicted: ${driftPct}%.` : null;
  const summaryClause = observedSummary
    ? `Observation: ${observedSummary.slice(0, 200)}.`
    : null;
  const gradeNarrative = {
    good: `Decision on "${subject}" aligned with predicted outcome.`,
    neutral: `Decision on "${subject}" drifted but did not bear material cost.`,
    bad: `Decision on "${subject}" diverged at material cost. Worth reviewing.`,
    undetermined: `Decision on "${subject}" could not be graded yet (no clean observation).`,
  }[grade];
  return [gradeNarrative, valueClause, driftClause, summaryClause]
    .filter((s): s is string => s !== null)
    .join(' ');
}

/**
 * Fallback grade for decisions WITHOUT a related prediction. After
 * the soft-grade wait, we mark them `undetermined` so they show up in
 * the journal as "graded but inconclusive — owner can mark manually".
 */
export function softGradeForUnpredictedDecision(): RetrospectiveGrade {
  return 'undetermined';
}

export function createDecisionRetrospectiveWorker(
  options: DecisionRetrospectiveWorkerOptions,
): DecisionRetrospectiveWorkerHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const enabled = options.enabled ?? true;
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const softWaitDays = options.softGradeWaitDays ?? DEFAULT_SOFT_GRADE_WAIT_DAYS;
  const clock = options.now ?? (() => new Date());
  const logger = options.logger;

  let timer: ReturnType<typeof setInterval> | null = null;

  async function fetchPending(): Promise<readonly PendingDecision[]> {
    const softCutoff = new Date(
      clock().getTime() - softWaitDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const result = await options.db.execute(sql`
      SELECT d.id, d.tenant_id, d.decision_subject, d.related_prediction_id,
             d.decided_at,
             r.status                  AS reconciliation_status,
             r.drift_score             AS drift_score,
             obs.observed_value_tzs    AS observed_value_tzs,
             obs.observed_outcome::text AS observed_outcome_summary
        FROM decisions d
        LEFT JOIN outcome_reconciliations r
          ON d.tenant_id = r.tenant_id
         AND d.related_prediction_id = r.prediction_id
        LEFT JOIN outcome_observations obs
          ON d.tenant_id = obs.tenant_id
         AND d.related_prediction_id = obs.prediction_id
        LEFT JOIN decision_outcomes existing
          ON existing.decision_id = d.id
         AND existing.tenant_id = d.tenant_id
       WHERE existing.id IS NULL
         AND d.status = 'committed'
         AND (
              r.status IS NOT NULL
           OR (d.related_prediction_id IS NULL AND d.decided_at <= ${softCutoff}::timestamptz)
         )
       LIMIT ${batchSize}
    `);

    return asRows(result).map((row) => ({
      id: asString(row, 'id'),
      tenantId: asString(row, 'tenant_id'),
      decisionSubject: asString(row, 'decision_subject'),
      relatedPredictionId: asNullableString(row, 'related_prediction_id'),
      decidedAt: asString(row, 'decided_at'),
      reconciliationStatus: asNullableString(row, 'reconciliation_status'),
      driftScore: asNullableNumber(row, 'drift_score'),
      observedValueTzs: asNullableNumber(row, 'observed_value_tzs'),
      observedOutcomeSummary: asNullableString(
        row,
        'observed_outcome_summary',
      ),
    }));
  }

  async function gradeOne(pending: PendingDecision): Promise<'graded' | 'skipped' | 'failed'> {
    const grade: RetrospectiveGrade =
      pending.reconciliationStatus !== null
        ? gradeFromReconciliation(
            pending.reconciliationStatus,
            pending.driftScore,
            pending.observedValueTzs,
          )
        : softGradeForUnpredictedDecision();

    const learnings = buildLearningsText(
      pending.decisionSubject,
      grade,
      pending.driftScore,
      pending.observedValueTzs,
      pending.observedOutcomeSummary,
    );

    const summary =
      pending.reconciliationStatus !== null
        ? `Reconciliation status: ${pending.reconciliationStatus}.`
        : `No prediction was attached; graded after ${softWaitDays}-day soft wait.`;

    try {
      // Tenant-scoped: bind RLS GUC for this row.
      await options.db.execute(sql`SELECT set_config('app.tenant_id', ${pending.tenantId}, true)`);
      await options.recorder.recordOutcome({
        tenantId: pending.tenantId,
        decisionId: pending.id,
        outcomeSummary: summary,
        observedValueTzs: pending.observedValueTzs,
        observedAt: clock().toISOString(),
        retrospectiveGrade: grade,
        learnings,
        recordedBy: 'reconciler',
      });
      return 'graded';
    } catch (err) {
      logger.warn(
        {
          decisionId: pending.id,
          tenantId: pending.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'decision-retrospective-worker: grading failed',
      );
      return 'failed';
    }
  }

  async function tickOnce(): Promise<RetrospectiveTickResult> {
    let considered = 0;
    let graded = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const pending = await fetchPending();
      considered = pending.length;
      for (const row of pending) {
        if (row.id === '' || row.tenantId === '') {
          skipped += 1;
          continue;
        }
        const outcome = await gradeOne(row);
        if (outcome === 'graded') graded += 1;
        else if (outcome === 'failed') failed += 1;
        else skipped += 1;
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'decision-retrospective-worker: tick failed',
      );
    }
    return { considered, graded, skipped, failed };
  }

  function start(): void {
    if (!enabled || timer !== null) return;
    logger.info(
      { worker: 'decision-retrospective', intervalMs },
      'decision-retrospective: started',
    );
    timer = setInterval(() => {
      void tickOnce();
    }, intervalMs);
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
      logger.info(
        { worker: 'decision-retrospective' },
        'decision-retrospective: stopped',
      );
    }
  }

  return Object.freeze({ start, stop, tickOnce });
}
