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

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const wrapped = result as { rows?: Record<string, unknown>[] };
  return wrapped?.rows ?? [];
}

/**
 * owner-cockpithub-1: the original query hit a non-existent `decisions`
 * table shape (`summary` / `raised_at` / status `pending`|`in_review`).
 * The owner's real "decisions that need your call" queue is the Mr.
 * Mwikila open-actions inbox (`mwikila_actions_inbox`): rows still
 * `proposed` (awaiting the owner's tap) or `owner_approved` (approved but
 * not yet executed) are exactly the items the cockpit promises. Tier maps
 * to severity (T3/sovereign > T2 high > T1 medium > T0 low) so the panel
 * keeps a severity badge without inventing a column.
 */
async function selectDecisions(
  db: DbExecutor,
  tenantId: string,
): Promise<ReadonlyArray<DecisionSummary>> {
  try {
    const rows = rowsOf(
      await db.execute(sql`
        SELECT id, summary, delegation_tier, proposed_at
          FROM mwikila_actions_inbox
         WHERE tenant_id = ${tenantId}
           AND status IN ('proposed', 'owner_approved')
         ORDER BY proposed_at DESC
         LIMIT 5
      `),
    );
    return rows.map((r) => ({
      id: String(r.id),
      summary: String(r.summary ?? ''),
      severity: tierToSeverity(String(r.delegation_tier ?? 'T0')),
      raisedAt: String(r.proposed_at ?? new Date(0).toISOString()),
    }));
  } catch {
    return [];
  }
}

function tierToSeverity(tier: string): DecisionSummary['severity'] {
  switch (tier) {
    case 'T3':
      return 'sovereign';
    case 'T2':
      return 'high';
    case 'T1':
      return 'medium';
    default:
      return 'low';
  }
}

/**
 * owner-cockpithub-1: clean column rename onto the REAL `reminders` table
 * (owner-reminders.schema.ts) — `title`→text, `trigger_at`→dueAt — with
 * the lifecycle filter `status='scheduled'` (there is no `completed_at`
 * column) and only future triggers so the panel shows upcoming reminders.
 */
async function selectReminders(
  db: DbExecutor,
  tenantId: string,
): Promise<ReadonlyArray<Reminder>> {
  try {
    const rows = rowsOf(
      await db.execute(sql`
        SELECT id, title, trigger_at
          FROM reminders
         WHERE tenant_id = ${tenantId}
           AND status = 'scheduled'
           AND trigger_at > now()
         ORDER BY trigger_at ASC
         LIMIT 5
      `),
    );
    return rows.map((r) => ({
      id: String(r.id),
      text: String(r.title ?? ''),
      dueAt: String(r.trigger_at ?? new Date(0).toISOString()),
    }));
  } catch {
    return [];
  }
}

/**
 * owner-cockpithub-2: real opportunities feed. The owner's top
 * opportunities by expected value are the active marketplace listings the
 * tenant has posted (off-take / sell-side), ordered by their TZS asking
 * price. Purely a read; degrades to [] on any error.
 */
async function selectOpportunities(
  db: DbExecutor,
  tenantId: string,
): Promise<ReadonlyArray<Opportunity>> {
  try {
    const rows = rowsOf(
      await db.execute(sql`
        SELECT id, category, title, price_tzs
          FROM marketplace_listings
         WHERE tenant_id = ${tenantId}
           AND status = 'active'
         ORDER BY price_tzs DESC NULLS LAST
         LIMIT 5
      `),
    );
    return rows.map((r) => ({
      id: String(r.id),
      kind: String(r.category ?? 'listing'),
      summary: String(r.title ?? ''),
      expectedValueTzs: Number(r.price_tzs ?? 0),
    }));
  } catch {
    return [];
  }
}

/**
 * owner-cockpithub-2: real risks feed — the union of open high/critical
 * incidents and licences expiring within 60 days. Both are read-only and
 * already governed by the same RLS GUC the cockpit binds. Capped to 5.
 */
async function selectRisks(
  db: DbExecutor,
  tenantId: string,
): Promise<ReadonlyArray<Risk>> {
  try {
    const rows = rowsOf(
      await db.execute(sql`
        SELECT id, kind, summary, severity FROM (
          SELECT id::text AS id,
                 'incident' AS kind,
                 COALESCE(description, kind, 'Open incident') AS summary,
                 CASE WHEN severity IN ('critical', 'high') THEN severity
                      ELSE 'high' END AS severity,
                 occurred_at AS sort_at
            FROM incidents
           WHERE tenant_id = ${tenantId}
             AND status = 'open'
             AND severity IN ('critical', 'high')
          UNION ALL
          SELECT id::text AS id,
                 'licence' AS kind,
                 ('Licence ' || COALESCE(number, kind) ||
                  ' expires ' || COALESCE(expiry_date::text, 'soon')) AS summary,
                 'medium' AS severity,
                 (expiry_date::timestamptz) AS sort_at
            FROM licences
           WHERE tenant_id = ${tenantId}
             AND status = 'active'
             AND expiry_date IS NOT NULL
             AND expiry_date <= (now() + interval '60 days')::date
        ) risks
        ORDER BY sort_at ASC NULLS LAST
        LIMIT 5
      `),
    );
    return rows.map((r) => ({
      id: String(r.id),
      kind: String(r.kind ?? 'risk'),
      summary: String(r.summary ?? ''),
      severity: (r.severity ?? 'medium') as Risk['severity'],
    }));
  } catch {
    return [];
  }
}

export const cockpitHubRouter = new Hono();
cockpitHubRouter.use('*', authMiddleware);
cockpitHubRouter.use('*', databaseMiddleware);

// owner-cockpithub-3: the router is mounted at `/owner/cockpit`, so the
// canonical URL is `/owner/cockpit/hub`. Register the same handler on the
// bare mount path `/` too, so a client that calls `/owner/cockpit`
// (without the trailing `/hub`) also resolves instead of 404-ing. The
// top-level `/owner/hub` compatibility alias (if any FE still uses it)
// must be added at the index.ts mount layer — see needsAttention.
const cockpitHubHandler = async (c: any) => {
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
  // Fire the four DB-backed panels in parallel. Each selector degrades to
  // [] on its own failure (try/catch inside), so one slow/failed source
  // never blanks the whole screen.
  const [decisions, reminders, opportunities, risks] = await Promise.all([
    selectDecisions(db, auth.tenantId),
    selectReminders(db, auth.tenantId),
    selectOpportunities(db, auth.tenantId),
    selectRisks(db, auth.tenantId),
  ]);

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
};

cockpitHubRouter.get('/hub', cockpitHubHandler);
cockpitHubRouter.get('/', cockpitHubHandler);
