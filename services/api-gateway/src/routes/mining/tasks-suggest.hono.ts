/**
 * /api/v1/mining/tasks/:id/suggest-assignee
 *
 * Per `Docs/research/manager-dispatch-sota.md` §3 (AI-suggest assignee).
 * Single endpoint, intentionally split out of `tasks.hono.ts` (owned by
 * the B-WorkerTasks wave) so this wave can ship the suggestion surface
 * without touching the in-flight tasks router.
 *
 * Algorithm (deterministic v1):
 *   - load the task (tenant-scoped)
 *   - load active employees on the task's site
 *   - score each candidate against four signals:
 *       certification match (full)        : +0.5
 *       no overlapping shift right now    : +0.2
 *       most-recent shift on same site    : +0.2
 *       lowest current fatigue            : +0.1
 *   - return top candidate + top 3 with confidence
 *
 * The scorer is exposed behind a `SuggestAssigneePort` so the
 * brain-llm-router can swap in an LLM ranker later without touching
 * this router.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import {
  tasks as tasksTable,
  employees as employeesTable,
  attendance as attendanceTable,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

// ---------------------------------------------------------------------------
// Port — pluggable scorer (rules-based v1; LLM later).
// ---------------------------------------------------------------------------

export interface SuggestAssigneeInput {
  task: typeof tasksTable.$inferSelect;
  candidates: ReadonlyArray<CandidateSnapshot>;
}

export interface CandidateSnapshot {
  employee: typeof employeesTable.$inferSelect;
  /** Most-recent attendance row for this employee, or null. */
  lastAttendance: typeof attendanceTable.$inferSelect | null;
  /** Whether a current shift exists overlapping "now" (used as conflict signal). */
  hasActiveShiftNow: boolean;
  /** Estimated fatigue 0..1 (higher = more tired). */
  fatigueScore: number;
}

export interface SuggestAssigneeResult {
  userId: string | null;
  confidence: number;
  reasoning: { sw: string; en: string };
  top: ReadonlyArray<{ userId: string; confidence: number; reasoning: { sw: string; en: string } }>;
}

export interface SuggestAssigneePort {
  rank(input: SuggestAssigneeInput): SuggestAssigneeResult;
}

/**
 * Default deterministic rules-based scorer. Pure function so it is
 * trivially testable. Confidence in [0, 1].
 */
export const rulesBasedSuggestPort: SuggestAssigneePort = {
  rank(input: SuggestAssigneeInput): SuggestAssigneeResult {
    const { task, candidates } = input;
    if (candidates.length === 0) {
      return {
        userId: null,
        confidence: 0,
        reasoning: {
          sw: 'Hakuna mfanyakazi anayepatikana',
          en: 'No candidates available',
        },
        top: [],
      };
    }

    const requiredCert = extractRequiredCert(task);
    const taskSiteId = task.siteId ?? null;

    const scored = candidates.map((cand) => {
      const certHit = certificationMatches(cand.employee, requiredCert);
      const noConflict = !cand.hasActiveShiftNow;
      const sameSite =
        cand.lastAttendance !== null &&
        taskSiteId !== null &&
        cand.lastAttendance.siteId === taskSiteId;
      // Lower fatigue is better; map (0..1) -> (1..0) contribution.
      const fatigueContribution = clamp01(1 - cand.fatigueScore);

      const confidence = clamp01(
        (certHit ? 0.5 : 0) +
          (noConflict ? 0.2 : 0) +
          (sameSite ? 0.2 : 0) +
          0.1 * fatigueContribution,
      );

      const reasonsSw: string[] = [];
      const reasonsEn: string[] = [];
      if (certHit) {
        reasonsSw.push('cheti kinapatana');
        reasonsEn.push('certification match');
      }
      if (noConflict) {
        reasonsSw.push('hayuko kwenye zamu');
        reasonsEn.push('no current shift');
      }
      if (sameSite) {
        reasonsSw.push('uzoefu wa eneo hili');
        reasonsEn.push('site experience');
      }
      if (cand.fatigueScore <= 0.3) {
        reasonsSw.push('uchovu chini');
        reasonsEn.push('low fatigue');
      }
      const sw = reasonsSw.length > 0 ? reasonsSw.join(', ') : 'sababu chache';
      const en = reasonsEn.length > 0 ? reasonsEn.join(', ') : 'few matching signals';

      return {
        userId: cand.employee.userId ?? cand.employee.id,
        confidence,
        reasoning: { sw, en },
      };
    });

    const sorted = scored.slice().sort((a, b) => b.confidence - a.confidence);
    const winner = sorted[0];
    const top = sorted.slice(0, 3);
    if (!winner) {
      return {
        userId: null,
        confidence: 0,
        reasoning: {
          sw: 'Hakuna mfanyakazi anayepatikana',
          en: 'No candidates available',
        },
        top: [],
      };
    }
    return {
      userId: winner.userId,
      confidence: winner.confidence,
      reasoning: winner.reasoning,
      top,
    };
  },
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const paramSchema = z.object({
  id: z.string().uuid().or(z.string().min(1).max(128)),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// Bind port lazily so tests can override (see __tests__/tasks-suggest.test.ts).
let activePort: SuggestAssigneePort = rulesBasedSuggestPort;
export function setSuggestPortForTesting(port: SuggestAssigneePort): void {
  activePort = port;
}
export function resetSuggestPortForTesting(): void {
  activePort = rulesBasedSuggestPort;
}

app.post('/:id/suggest-assignee', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');

  const idParam = c.req.param('id');
  const parsed = paramSchema.safeParse({ id: idParam });
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid task id' } },
      400,
    );
  }
  const taskId = parsed.data.id;

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.tenantId, tenantId), eq(tasksTable.id, taskId)))
    .limit(1);

  if (!task) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } },
      404,
    );
  }

  // Pull active employees on this site (or tenant-wide if siteId is null).
  const employeeConds = [
    eq(employeesTable.tenantId, tenantId),
    eq(employeesTable.status, 'active'),
  ];
  if (task.siteId) employeeConds.push(eq(employeesTable.siteId, task.siteId));

  const employeeRows = await db
    .select()
    .from(employeesTable)
    .where(and(...employeeConds))
    .limit(200);

  // Snapshot per candidate: last attendance row + fatigue proxy + active-shift flag.
  const snapshots: CandidateSnapshot[] = await Promise.all(
    employeeRows.map(async (emp: typeof employeesTable.$inferSelect) => {
      const recent = await db
        .select()
        .from(attendanceTable)
        .where(
          and(
            eq(attendanceTable.tenantId, tenantId),
            eq(attendanceTable.employeeId, emp.id),
          ),
        )
        .orderBy(desc(attendanceTable.workDate))
        .limit(5);

      const lastAttendance =
        recent.length > 0
          ? (recent[0] as typeof attendanceTable.$inferSelect)
          : null;

      // Active shift heuristic: latest row is today AND status='present'.
      const today = isoDay(new Date());
      const hasActiveShiftNow =
        lastAttendance !== null &&
        lastAttendance.workDate === today &&
        lastAttendance.status === 'present';

      // Fatigue proxy: number of shifts in last 5 days normalised.
      const fatigueScore = clamp01(recent.length / 5);

      return {
        employee: emp,
        lastAttendance,
        hasActiveShiftNow,
        fatigueScore,
      };
    }),
  );

  const result = activePort.rank({ task, candidates: snapshots });
  return c.json({ success: true, data: result }, 200);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function extractRequiredCert(
  task: typeof tasksTable.$inferSelect,
): string | null {
  // Task certifications live in `attributes.requiredCertification` per
  // the DATA_MODEL convention. Defensive read — attributes is jsonb.
  const attrs = (task.attributes ?? {}) as Record<string, unknown>;
  const cert = attrs.requiredCertification;
  return typeof cert === 'string' && cert.length > 0 ? cert : null;
}

function certificationMatches(
  employee: typeof employeesTable.$inferSelect,
  requiredCert: string | null,
): boolean {
  if (!requiredCert) return false;
  const attrs = (employee.attributes ?? {}) as Record<string, unknown>;
  const held = attrs.certifications;
  if (!Array.isArray(held)) return false;
  return held.some((c) => typeof c === 'string' && c === requiredCert);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const miningTasksSuggestRouter = app;
