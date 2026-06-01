/**
 * Onboarding / growth driver — `detect_onboarding_gaps`.
 *
 * This is the "always thinking about how to onboard / grow / get more data"
 * driver the audit found missing (background-wiring's `buildTaskData`
 * returned all `[]`). For one tenant it asks the simplest, highest-leverage
 * growth question: *does this tenant have the core mining entities yet?* —
 *
 *   - no SITES     → can't run production, safety, or geology.
 *   - no WORKERS   → can't run shifts, payroll, or attendance.
 *   - no LICENCES  → can't run royalty/compliance and is operating at risk.
 *
 * For every missing entity it writes ONE Mr. Mwikila inbox row
 * (`mwikila_actions_inbox`, status `proposed`, tier `T0` so the owner
 * reviews) prompting the next onboarding step. The row surfaces in the
 * owner cockpit's "Acting on your behalf" inbox and pulses the cockpit bus
 * (the recorder publishes `mwikila.proposes`), so the owner is nudged to
 * complete setup.
 *
 * IDEMPOTENCY (one nudge per gap per cadence): before inserting, we check
 * for an OPEN row (`status = 'proposed'`) with the same `action_kind` for
 * this tenant. If one exists we skip — the detector never spams. The insert
 * is a single guarded `INSERT ... SELECT ... WHERE NOT EXISTS` so two
 * overlapping ticks cannot double-write either.
 *
 * Tenant-scoping: the caller binds the tenant GUC; every query also carries
 * `tenant_id`. RLS FORCE holds on the out-of-band scheduler path.
 *
 * Pino only; never throws — a per-gap failure is logged and the next gap is
 * still attempted. Returns the number of nudge rows written this tick.
 *
 * NOTE on category mapping: `mwikila_actions_inbox.category` has a CHECK
 * constraint limited to the 12 delegation categories, so each gap is mapped
 * to its closest existing category. The semantics are honest — a
 * missing-licences gap genuinely belongs to `license-renewal-reminders`,
 * missing-workers to `worker-hires`, missing-sites to `capex` (site
 * stand-up is the foundational capital step).
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/** One core-entity gap the detector knows how to nudge. */
interface OnboardingGapSpec {
  /** Stable verb stored in `action_kind` — also the dedup key. */
  readonly actionKind: string;
  /** Table whose emptiness defines the gap. */
  readonly table: 'sites' | 'employees' | 'licences';
  /** Closest valid delegation category (CHECK-constrained column). */
  readonly category:
    | 'capex'
    | 'worker-hires'
    | 'license-renewal-reminders';
  readonly summaryEn: string;
  readonly summarySw: string;
  readonly rationaleEn: string;
}

const ONBOARDING_GAPS: readonly OnboardingGapSpec[] = [
  {
    actionKind: 'onboarding.add_first_site',
    table: 'sites',
    category: 'capex',
    summaryEn: 'Add your first mining site to unlock production & safety',
    summarySw: 'Ongeza tovuti yako ya kwanza ya uchimbaji ili kuwezesha uzalishaji na usalama',
    rationaleEn:
      'No mining sites exist yet. Adding a site unlocks shift production, safety reporting, and geology — the foundation of the operating system.',
  },
  {
    actionKind: 'onboarding.add_first_worker',
    table: 'employees',
    category: 'worker-hires',
    summaryEn: 'Add your first worker to run shifts & payroll',
    summarySw: 'Ongeza mfanyakazi wako wa kwanza ili kuendesha zamu na malipo',
    rationaleEn:
      'No workers are registered yet. Adding workers unlocks shift scheduling, attendance, and payroll.',
  },
  {
    actionKind: 'onboarding.add_first_licence',
    table: 'licences',
    category: 'license-renewal-reminders',
    summaryEn: 'Register your mining licence to stay compliant',
    summarySw: 'Sajili leseni yako ya uchimbaji ili kubaki kufuata sheria',
    rationaleEn:
      'No mining licences are on file. Registering your licence enables royalty filing, renewal reminders, and compliance tracking — operating without it carries regulatory risk.',
  },
];

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

/**
 * Resolve the tenant's owner user id (the `acting_on_user_id` the inbox row
 * references). Returns null when no flagged owner exists — without an owner
 * the row's FK would fail, so we skip the tenant.
 */
async function resolveOwnerUserId(
  db: DbLike,
  tenantId: string,
): Promise<string | null> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT id FROM users
       WHERE tenant_id = ${tenantId}
         AND is_owner  = TRUE
         AND status    = 'active'
       ORDER BY created_at ASC
       LIMIT 1
    `),
  );
  const id = rows[0]?.id;
  return typeof id === 'string' ? id : null;
}

/**
 * True when the core table has at least one row for the tenant. Each table
 * is a literal `sql` template (NOT interpolated) so there is no injection
 * surface and the query text is stable for tests.
 */
async function tableHasRows(
  db: DbLike,
  tenantId: string,
  table: OnboardingGapSpec['table'],
): Promise<boolean> {
  let query;
  switch (table) {
    case 'sites':
      query = sql`SELECT 1 FROM sites WHERE tenant_id = ${tenantId} LIMIT 1`;
      break;
    case 'employees':
      query = sql`SELECT 1 FROM employees WHERE tenant_id = ${tenantId} LIMIT 1`;
      break;
    case 'licences':
      query = sql`SELECT 1 FROM licences WHERE tenant_id = ${tenantId} LIMIT 1`;
      break;
  }
  const rows = rowsOf(await db.execute(query));
  return rows.length > 0;
}

export interface DetectOnboardingGapsInput {
  readonly db: DbLike;
  readonly tenantId: string;
  readonly logger: Logger;
}

/**
 * Detect missing core mining entities for one tenant and write a single
 * idempotent Mr. Mwikila nudge per gap. Returns the count of nudges written
 * this tick (0 when fully onboarded or already nudged).
 */
export async function detectOnboardingGaps(
  input: DetectOnboardingGapsInput,
): Promise<number> {
  const { db, tenantId, logger } = input;

  let ownerUserId: string | null;
  try {
    ownerUserId = await resolveOwnerUserId(db, tenantId);
  } catch (err) {
    logger.warn(
      {
        worker: 'detect-onboarding-gaps',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'onboarding-gaps: owner lookup failed; skipping tenant',
    );
    return 0;
  }
  if (!ownerUserId) {
    logger.debug(
      { worker: 'detect-onboarding-gaps', tenantId },
      'onboarding-gaps: no active owner; skipping tenant',
    );
    return 0;
  }

  let written = 0;
  for (const gap of ONBOARDING_GAPS) {
    try {
      const present = await tableHasRows(db, tenantId, gap.table);
      if (present) continue; // entity exists → no gap → no nudge.

      // Guarded insert: writes the nudge ONLY when no OPEN (proposed) row
      // with the same action_kind already exists for this tenant. This is
      // the "one nudge per gap per cadence" idempotency guarantee — two
      // overlapping ticks cannot double-write because the NOT EXISTS is
      // evaluated inside the same statement.
      const inserted = rowsOf(
        await db.execute(sql`
          INSERT INTO mwikila_actions_inbox (
            tenant_id, acting_on_user_id, action_kind, category,
            delegation_tier, status, summary, summary_sw, rationale,
            payload, proposed_at, provenance
          )
          SELECT ${tenantId}::uuid,
                 ${ownerUserId},
                 ${gap.actionKind},
                 ${gap.category},
                 'T0',
                 'proposed',
                 ${gap.summaryEn},
                 ${gap.summarySw},
                 ${gap.rationaleEn},
                 ${JSON.stringify({ gap: gap.actionKind, missingEntity: gap.table })}::jsonb,
                 NOW(),
                 ${JSON.stringify({ via: 'detect_onboarding_gaps' })}::jsonb
          WHERE NOT EXISTS (
            SELECT 1 FROM mwikila_actions_inbox
             WHERE tenant_id   = ${tenantId}::uuid
               AND action_kind = ${gap.actionKind}
               AND status      = 'proposed'
          )
          RETURNING id
        `),
      );
      if (inserted.length > 0) {
        written += 1;
        logger.info(
          {
            worker: 'detect-onboarding-gaps',
            tenantId,
            gap: gap.actionKind,
            missingEntity: gap.table,
          },
          'onboarding-gaps: wrote Mr. Mwikila nudge for incomplete onboarding',
        );
      }
    } catch (err) {
      logger.warn(
        {
          worker: 'detect-onboarding-gaps',
          tenantId,
          gap: gap.actionKind,
          err: err instanceof Error ? err.message : String(err),
        },
        'onboarding-gaps: failed to evaluate/write one gap',
      );
    }
  }
  return written;
}

/** Exposed for direct unit testing of the gap catalogue. */
export const __testing = {
  ONBOARDING_GAPS,
  resolveOwnerUserId,
  tableHasRows,
};
