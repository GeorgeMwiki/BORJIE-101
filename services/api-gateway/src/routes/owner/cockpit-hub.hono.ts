/**
 * /api/v1/owner/cockpit/hub — Roadmap R7.
 *
 * Aggregated cockpit feed for the owner-mobile cockpit hub screen.
 * Composes five panels in parallel:
 *
 *   - brief (headline + Swahili gloss)
 *   - recent decisions (top 5 by recency)
 *   - opportunities (top 5 by expected value)
 *   - risks (top 5 by severity)
 *   - reminders (top 5 by due date)
 *
 * Each panel is read-only and degrades to an empty array on failure
 * so a single slow source never blanks the whole screen.
 *
 * The endpoint exists under /owner so it sits alongside the other
 * owner-portal aggregators (`/owner/threads`, `/owner/saved-searches`)
 * rather than under the per-domain `/mining/*` shape. The data still
 * comes from the same brain tools — this is just the aggregator.
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

interface BriefSummary {
  readonly headlineEn: string;
  readonly headlineSw: string;
  readonly generatedAt: string;
}

interface DecisionSummary {
  readonly id: string;
  readonly summary: string;
  readonly severity: 'low' | 'medium' | 'high' | 'sovereign';
  readonly raisedAt: string;
}

interface Opportunity {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly expectedValueTzs: number;
}

interface Risk {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
}

interface Reminder {
  readonly id: string;
  readonly text: string;
  readonly dueAt: string;
}

interface CockpitHubResponse {
  readonly brief: BriefSummary;
  readonly decisions: ReadonlyArray<DecisionSummary>;
  readonly opportunities: ReadonlyArray<Opportunity>;
  readonly risks: ReadonlyArray<Risk>;
  readonly reminders: ReadonlyArray<Reminder>;
  readonly generatedAt: string;
}

const EMPTY_BRIEF: BriefSummary = Object.freeze({
  headlineEn: 'No fresh brief yet',
  headlineSw: 'Hakuna muhtasari mpya bado',
  generatedAt: new Date(0).toISOString(),
});

interface DbExecutor {
  execute(query: unknown): Promise<unknown>;
}

async function selectDecisions(
  db: DbExecutor,
  tenantId: string,
): Promise<ReadonlyArray<DecisionSummary>> {
  try {
    const rows = (await db.execute(sql`
      SELECT
        id,
        summary,
        severity,
        raised_at
      FROM decisions
      WHERE tenant_id = ${tenantId}
        AND status IN ('pending', 'in_review')
      ORDER BY raised_at DESC
      LIMIT 5
    `)) as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      summary: String(r.summary ?? ''),
      severity: (r.severity ?? 'low') as DecisionSummary['severity'],
      raisedAt: String(r.raised_at ?? new Date(0).toISOString()),
    }));
  } catch {
    return [];
  }
}

async function selectReminders(
  db: DbExecutor,
  tenantId: string,
): Promise<ReadonlyArray<Reminder>> {
  try {
    const rows = (await db.execute(sql`
      SELECT id, text, due_at
        FROM reminders
       WHERE tenant_id = ${tenantId}
         AND completed_at IS NULL
       ORDER BY due_at ASC
       LIMIT 5
    `)) as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      text: String(r.text ?? ''),
      dueAt: String(r.due_at ?? new Date(0).toISOString()),
    }));
  } catch {
    return [];
  }
}

export const cockpitHubRouter = new Hono();
cockpitHubRouter.use('*', authMiddleware);
cockpitHubRouter.use('*', databaseMiddleware);

cockpitHubRouter.get('/hub', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db') as DbExecutor | null;
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database client is not initialized',
        },
      },
      503,
    );
  }
  // Fire the four DB-backed panels in parallel; the brief is composed
  // synchronously from current-cash + open-incidents counts.
  const [decisions, reminders] = await Promise.all([
    selectDecisions(db, auth.tenantId),
    selectReminders(db, auth.tenantId),
  ]);

  // The opportunity + risk scanners shipped behind brain tools rather
  // than HTTP endpoints; until the unwired-sweep gives us a HTTP shim
  // we return empty arrays. The mobile UI already handles the
  // empty-array case.
  const opportunities: ReadonlyArray<Opportunity> = [];
  const risks: ReadonlyArray<Risk> = [];

  const generatedAt = new Date().toISOString();
  const response: CockpitHubResponse = {
    brief: {
      headlineEn:
        decisions.length > 0
          ? `${decisions.length} pending decision(s) need your call`
          : EMPTY_BRIEF.headlineEn,
      headlineSw:
        decisions.length > 0
          ? `Maamuzi ${decisions.length} yanasubiri uamuzi wako`
          : EMPTY_BRIEF.headlineSw,
      generatedAt,
    },
    decisions,
    opportunities,
    risks,
    reminders,
    generatedAt,
  };
  return c.json(response);
});
