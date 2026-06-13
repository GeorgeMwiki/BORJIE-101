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
 * Tenant-scoping: the background scheduler hands us the raw shared client with
 * NO tenant GUC bound, so each DB unit runs inside `withTenantContext(db,
 * tenantId, …)` — that SET-LOCALs `app.current_tenant_id` so the FORCE-RLS
 * `tenant_isolation` policy (USING + WITH CHECK) passes for both the SELECT
 * probes and the guarded INSERT. Without it the SELECTs saw zero rows (always
 * "gap exists") and the INSERT failed `WITH CHECK`. Each gap gets its OWN
 * short transaction so a per-gap failure rolls back only that gap and the next
 * is still attempted (a single shared tx would poison the rest on first error).
 *
 * Pino only; never throws — a per-gap failure is logged (with the postgres
 * cause-chain via `describeDbError`) and the next gap is still attempted.
 * Returns the number of nudge rows written this tick.
 *
 * NOTE on category mapping: `mwikila_actions_inbox.category` has a CHECK
 * constraint limited to the 12 delegation categories, so each gap is mapped
 * to its closest existing category. The semantics are honest — a
 * missing-licences gap genuinely belongs to `license-renewal-reminders`,
 * missing-workers to `worker-hires`, missing-sites to `capex` (site
 * stand-up is the foundational capital step).
 *
 * NOTE on `tenant_id` type: `mwikila_actions_inbox.tenant_id` is TEXT (it FKs
 * `tenants.id`, a TEXT PK from the 0000 bootstrap), so the value is bound as a
 * plain string — NEVER cast `::uuid` (postgres has no uuid→text assignment
 * cast; the cast threw "column tenant_id is of type text but expression is of
 * type uuid" at plan time on every tick).
 */

import { sql } from 'drizzle-orm';
import { withTenantContext } from '@borjie/database';
import type { Logger } from 'pino';

/**
 * The transaction-capable client `withTenantContext` expects. Derived from the
 * helper's own signature rather than importing the barrel `DatabaseClient`
 * (which collides with a namespace export — same workaround as
 * `middleware/database.ts`).
 */
type TenantContextClient = Parameters<typeof withTenantContext>[0];

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Surface the ROOT cause of a DB error. Drizzle wraps postgres-js errors as
 * `DrizzleQueryError` whose `.message` is just "Failed query: <sql>" — the real
 * postgres error (code/detail) sits on `.cause`. Logging only `.message` hid
 * the root cause (this worker was failing every tick with an opaque "Failed
 * query"); this walks the cause chain so the failure is diagnosable in prod.
 * Mirrors the dispatcher-worker helper.
 */
function describeDbError(err: unknown): {
  err: string;
  cause?: string;
  code?: string;
} {
  const e = err as {
    message?: string;
    code?: string;
    cause?: { message?: string; code?: string };
  };
  const cause = e?.cause?.message;
  const code = e?.cause?.code ?? e?.code;
  return {
    err: e?.message ? String(e.message).slice(0, 200) : String(err),
    ...(cause ? { cause: String(cause).slice(0, 200) } : {}),
    ...(code ? { code: String(code) } : {}),
  };
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
  // The scheduler hands us the raw shared client; bind the tenant GUC so
  // FORCE-RLS passes. `withTenantContext` runs the callback directly when the
  // handle is a bare `{ execute }` test stub (no `.transaction`), so unit
  // tests are unaffected.
  const client = db as unknown as TenantContextClient;

  let ownerUserId: string | null;
  try {
    ownerUserId = await withTenantContext(client, tenantId, (tx) =>
      resolveOwnerUserId(tx as unknown as DbLike, tenantId),
    );
  } catch (err) {
    logger.warn(
      {
        worker: 'detect-onboarding-gaps',
        tenantId,
        ...describeDbError(err),
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
      // Own short transaction per gap (tenant GUC bound) so a per-gap failure
      // rolls back only this gap — a shared tx would poison the rest.
      const didWrite = await withTenantContext(client, tenantId, async (txc) => {
        const tx = txc as unknown as DbLike;
        const present = await tableHasRows(tx, tenantId, gap.table);
        if (present) return false; // entity exists → no gap → no nudge.

        // Guarded insert: writes the nudge ONLY when no OPEN (proposed) row
        // with the same action_kind already exists for this tenant. This is
        // the "one nudge per gap per cadence" idempotency guarantee — two
        // overlapping ticks cannot double-write because the NOT EXISTS is
        // evaluated inside the same statement.
        const inserted = rowsOf(
          await tx.execute(sql`
          INSERT INTO mwikila_actions_inbox (
            tenant_id, acting_on_user_id, action_kind, category,
            delegation_tier, status, summary, summary_sw, rationale,
            payload, proposed_at, provenance
          )
          SELECT ${tenantId},
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
             WHERE tenant_id   = ${tenantId}
               AND action_kind = ${gap.actionKind}
               AND status      = 'proposed'
          )
          RETURNING id
        `),
        );
        return inserted.length > 0;
      });
      if (didWrite) {
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
          ...describeDbError(err),
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
