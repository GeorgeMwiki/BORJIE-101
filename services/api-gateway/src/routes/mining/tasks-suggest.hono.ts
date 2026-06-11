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
import {
  rankCandidates,
  type MatchCandidate,
  type MatchNeed,
} from '@borjie/workforce-orchestrator';
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
 *
 * REFACTORED: the scoring math is now the single-source pure kernel
 * `rankCandidates` from `@borjie/workforce-orchestrator`. This port maps
 * each `CandidateSnapshot` into the kernel's `MatchCandidate` shape (with
 * the spine's load/skill/role signals NEUTRALISED — see `toMatchCandidate`)
 * so the score is byte-identical to the prior inline scorer, then re-derives
 * the bilingual sw/en reasoning from the same four signal booleans. Behaviour
 * is unchanged; the weights now live in ONE place.
 */
export const rulesBasedSuggestPort: SuggestAssigneePort = {
  rank(input: SuggestAssigneeInput): SuggestAssigneeResult {
    const { task, candidates } = input;
    if (candidates.length === 0) {
      return noCandidates();
    }

    const requiredCert = extractRequiredCert(task);
    const taskSiteId = task.siteId ?? null;

    // The need: the route's signals are cert (requiredCert) + same-site
    // (siteId). We deliberately omit competenceDomain/desiredRole so the
    // kernel's skill/role budgets stay inert — preserving the legacy score.
    // Conditional spread at the package boundary: the kernel treats absent
    // and null identically (`?? null`), and the package's non-strict d.ts
    // collapses `string | null` to `string` in optional slots.
    const need: MatchNeed = {
      ...(requiredCert !== null ? { requiredCert } : {}),
      ...(taskSiteId !== null ? { siteId: taskSiteId } : {}),
    };

    // Stable id → snapshot map so we can re-attach the bilingual reasoning
    // after the kernel ranks by score.
    const matchCandidates: MatchCandidate[] = candidates.map((c) =>
      toMatchCandidate(c, taskSiteId),
    );
    const ranked = rankCandidates(matchCandidates, need);

    const byId = new Map<string, CandidateSnapshot>();
    for (const cand of candidates) {
      byId.set(cand.employee.userId ?? cand.employee.id, cand);
    }

    const scored = ranked.map((r) => {
      const snap = byId.get(r.employeeId);
      const reasoning = snap
        ? bilingualReasoning(snap, requiredCert, taskSiteId)
        : { sw: 'sababu chache', en: 'few matching signals' };
      return { userId: r.employeeId, confidence: r.score, reasoning };
    });

    const winner = scored[0];
    if (!winner) return noCandidates();
    return {
      userId: winner.userId,
      confidence: winner.confidence,
      reasoning: winner.reasoning,
      top: scored.slice(0, 3),
    };
  },
};

function noCandidates(): SuggestAssigneeResult {
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

/**
 * Map a route snapshot into the kernel's MatchCandidate with the spine's
 * load/skill/role signals NEUTRALISED so the kernel reproduces the route's
 * exact four-signal score:
 *   - openAssignmentCount = LOAD_SATURATION (5) ⇒ zero load contribution.
 *   - no skillDomains ⇒ skill signal zero (need has no competenceDomain).
 *   - role omitted ⇒ role signal zero (need has no desiredRole).
 *   - successRateByDomain null ⇒ neutral learned multiplier.
 */
function toMatchCandidate(
  cand: CandidateSnapshot,
  taskSiteId: string | null,
): MatchCandidate {
  const attrs = (cand.employee.attributes ?? {}) as Record<string, unknown>;
  const held = Array.isArray(attrs.certifications)
    ? (attrs.certifications as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : [];
  return {
    employeeId: cand.employee.userId ?? cand.employee.id,
    certifications: held,
    lastSiteId:
      cand.lastAttendance !== null && taskSiteId !== null
        ? cand.lastAttendance.siteId
        : null,
    hasActiveShiftNow: cand.hasActiveShiftNow,
    fatigueScore: cand.fatigueScore,
    openAssignmentCount: KERNEL_LOAD_SATURATION,
    successRateByDomain: null,
  };
}

/** Mirrors the kernel's LOAD_SATURATION so the load contribution is zero. */
const KERNEL_LOAD_SATURATION = 5;

/** Re-derive the route's bilingual reasoning from the four signal booleans. */
function bilingualReasoning(
  cand: CandidateSnapshot,
  requiredCert: string | null,
  taskSiteId: string | null,
): { sw: string; en: string } {
  const certHit = certificationMatches(cand.employee, requiredCert);
  const noConflict = !cand.hasActiveShiftNow;
  const sameSite =
    cand.lastAttendance !== null &&
    taskSiteId !== null &&
    cand.lastAttendance.siteId === taskSiteId;

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
  return {
    sw: reasonsSw.length > 0 ? reasonsSw.join(', ') : 'sababu chache',
    en: reasonsEn.length > 0 ? reasonsEn.join(', ') : 'few matching signals',
  };
}

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
