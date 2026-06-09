/**
 * /api/v1/mining/copilots/worker-coach — employee performance coaching.
 *
 * Closes finding `wm-worker-coach-endpoint-missing`. The workforce-mobile
 * EmployeeHome PerformanceSnapshot calls
 * `GET /api/v1/mining/copilots/worker-coach?userId=…` via
 * `useNextStepCoach`. No route was mounted, so the section always errored
 * into a `PreviewBanner kind='env-missing'` and never showed guidance.
 *
 * The workforce-mobile mining client resolves `/copilots/worker-coach` under
 * the `/api/v1/mining` prefix, so this router is mounted in the mining
 * sub-app at `/copilots` (NOT a top-level `/copilots`).
 *
 * GROUNDED, EVIDENCE-REQUIRED (CLAUDE.md hard rule): the coaching suggestion is
 * derived from the worker's OWN `mining_tasks` rows — open / overdue / recently
 * completed counts — and every suggestion cites the concrete task ids it was
 * computed from as `evidenceIds`. No LLM call, no fabricated metric. When the
 * worker has no tasks the route honest-degrades to `{ suggestion: null }` (the
 * FE renders the empty state, not an error).
 *
 * Response (matches the mobile `CoachSuggestion` contract):
 *   { suggestion: { id, suggestionSw, suggestionEn, evidenceIds } | null }
 *
 * BILINGUAL (CLAUDE.md "EN/SW separation ABSOLUTE"): BOTH `suggestionSw` and
 * `suggestionEn` are always populated; the FE renders exactly one per the
 * active locale — the two strings never mix within a render.
 *
 * TENANT SCOPE: RLS FORCE on `app.current_tenant_id` + an explicit
 * `auth.tenantId` predicate. The coached worker defaults to the caller; a
 * manager may pass `?userId=` for a direct report (still tenant-scoped).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { miningTasks } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-worker-coach');

const QuerySchema = z.object({
  userId: z.string().uuid().optional(),
});

interface CoachSuggestion {
  readonly id: string;
  readonly suggestionSw: string;
  readonly suggestionEn: string;
  readonly evidenceIds: ReadonlyArray<string>;
}

function jsonError(
  code: string,
  message: string,
  status: 400 | 401 | 403 | 500 | 503,
) {
  return { status, body: { success: false as const, error: { code, message } } };
}

// ---------------------------------------------------------------------------
// Coaching rules — pure compute over the worker's own task rows. First rule
// that fires wins (most-actionable-first ordering). Each rule names the task
// ids it grounds on so the evidence chain is non-empty.
// ---------------------------------------------------------------------------

interface TaskLite {
  readonly id: string;
  readonly status: string;
  readonly dueAt: Date | null;
  readonly completedAt: Date | null;
}

function deriveSuggestion(
  workerId: string,
  tasks: ReadonlyArray<TaskLite>,
): CoachSuggestion | null {
  if (tasks.length === 0) return null;

  const now = Date.now();
  const overdue = tasks.filter(
    (t) =>
      (t.status === 'pending' || t.status === 'in_progress') &&
      t.dueAt instanceof Date &&
      t.dueAt.getTime() < now,
  );
  const blocked = tasks.filter((t) => t.status === 'blocked');
  const open = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'in_progress',
  );
  const doneRecently = tasks.filter((t) => t.status === 'done');

  // Stable id so the FE react-query cache key is steady within a state.
  const idFor = (tag: string) => `coach_${workerId}_${tag}`;

  if (overdue.length > 0) {
    const ids = overdue.slice(0, 3).map((t) => t.id);
    const n = overdue.length;
    return {
      id: idFor('overdue'),
      suggestionSw: `Una kazi ${n} zilizopitwa na muda. Anza na iliyochelewa zaidi ili kurudi kwenye ratiba.`,
      suggestionEn: `You have ${n} overdue task${n === 1 ? '' : 's'}. Start with the most overdue one to get back on schedule.`,
      evidenceIds: ids,
    };
  }

  if (blocked.length > 0) {
    const ids = blocked.slice(0, 3).map((t) => t.id);
    const n = blocked.length;
    return {
      id: idFor('blocked'),
      suggestionSw: `Kazi ${n} zimezuiliwa. Mwambie msimamizi wako kizuizi ili ziendelee.`,
      suggestionEn: `${n} task${n === 1 ? ' is' : 's are'} blocked. Flag the blocker to your supervisor so they can move forward.`,
      evidenceIds: ids,
    };
  }

  if (open.length > 0) {
    const ids = open.slice(0, 3).map((t) => t.id);
    const n = open.length;
    return {
      id: idFor('open'),
      suggestionSw: `Una kazi ${n} zinazoendelea. Maliza moja kwa wakati na uweke alama imekamilika unapomaliza.`,
      suggestionEn: `You have ${n} open task${n === 1 ? '' : 's'}. Finish them one at a time and mark each done as you go.`,
      evidenceIds: ids,
    };
  }

  // All tasks complete — positive reinforcement, grounded on the completions.
  const ids = doneRecently.slice(0, 3).map((t) => t.id);
  return {
    id: idFor('clear'),
    suggestionSw: `Umemaliza kazi zako zote. Kazi nzuri — angalia kama msimamizi ana kazi mpya.`,
    suggestionEn: `You have cleared all your tasks. Great work — check with your supervisor for what is next.`,
    evidenceIds: ids,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createMiningWorkerCoachRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  app.get('/worker-coach', zValidator('query', QuerySchema), async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      // Honest-degrade: no DB → no coaching, but a valid envelope (the FE
      // renders the empty state rather than an error banner).
      return c.json({ suggestion: null as CoachSuggestion | null }, 200);
    }

    const q = c.req.valid('query');
    // Default to the caller; a passed userId targets a direct report (still
    // tenant-scoped — never cross-tenant).
    const targetUserId = q.userId ?? userId;

    try {
      const rows = await db
        .select({
          id: miningTasks.id,
          status: miningTasks.status,
          dueAt: miningTasks.dueAt,
          completedAt: miningTasks.completedAt,
        })
        .from(miningTasks)
        .where(
          and(
            eq(miningTasks.tenantId, tenantId),
            eq(miningTasks.assignedToUserId, targetUserId),
            // Exclude cancelled — not actionable coaching signal.
            sql`${miningTasks.status} <> 'cancelled'`,
          ),
        )
        .orderBy(desc(miningTasks.createdAt))
        .limit(100);

      const suggestion = deriveSuggestion(targetUserId, rows as TaskLite[]);
      return c.json({ suggestion }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'coach failed';
      moduleLogger.error('worker coach failed', {
        evt: 'worker_coach_failed',
        tenantId,
        reason: message,
      });
      const e = jsonError(
        'WORKER_COACH_FAILED',
        'Failed to compute coaching',
        500,
      );
      return c.json(e.body, e.status);
    }
  });

  return app;
}

export const miningWorkerCoachRouter = createMiningWorkerCoachRouter();
