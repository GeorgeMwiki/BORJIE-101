/**
 * /api/v1/owner/commitment-governance — the owner's GOVERNANCE dial for the
 * living-MD organ.
 *
 * The owner tunes HOW much Mr. Mwikila is allowed to do autonomously on the
 * living plan, how often the "someday" review resurfaces deferred items, and
 * whether evidence-required enforcement is on. These set-points are read FRESH
 * each reconcile tick / post-turn hook by the living-MD organ — never cached —
 * so a change here takes effect immediately.
 *
 * Routes (scoped: platform-admin OR owner-self):
 *   GET /   read the tenant's governance preferences (honest defaults if unset)
 *   PUT /   upsert the tenant's governance preferences (zod-validated)
 *
 * The `owner_governance_preferences` table is owned by the concurrent
 * living-MD BACKEND agent's migration (0340). At the time this file is written
 * the `@borjie/database` schema export for it may not exist yet, so this route
 * reads/writes via RAW SQL against the table with a typed shape. When the schema
 * export lands, the raw SQL can be swapped for the Drizzle table with no shape
 * change. Every read/write is tenant-scoped under the RLS GUC the database
 * middleware bound.
 *
 * No `console.*` (pino logger only). Immutable response shaping. zod-validated
 * mutation. Honest defaults — an unconfigured tenant gets the safe baseline, not
 * an error.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { isPlatformAdmin, UserRole } from '../../types/user-role';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-commitment-governance');

// ---------------------------------------------------------------------------
// The governance set-points + safe defaults.
// ---------------------------------------------------------------------------

/**
 * The graded autonomy ceiling. `nudge` (only surface a reminder) is the most
 * conservative; `delegate` is the highest the MD is EVER allowed (the
 * owner-direct safe-halt — itself a HITL park). The cap can never be raised
 * above `delegate`; money/licence/sovereign stay HITL forever regardless.
 */
const AUTONOMY_CAPS = ['nudge', 'draft', 'delegate'] as const;
type AutonomyCap = (typeof AUTONOMY_CAPS)[number];

interface GovernancePreferences {
  readonly autonomyCap: AutonomyCap;
  /** How often (days) the someday review resurfaces deferred items. */
  readonly somedayReviewCadenceDays: number;
  /** Whether the evidence-required hard rule is enforced for this tenant. */
  readonly evidenceRequirementEnforced: boolean;
}

/**
 * The conservative baseline an unconfigured tenant inherits: the full graded
 * ladder up to `delegate`, a weekly someday review, and evidence-required ON
 * (the hard rule — only an explicit owner change can relax it).
 */
const DEFAULT_PREFERENCES: GovernancePreferences = Object.freeze({
  autonomyCap: 'delegate',
  somedayReviewCadenceDays: 7,
  evidenceRequirementEnforced: true,
});

const UpdateSchema = z
  .object({
    autonomyCap: z.enum(AUTONOMY_CAPS).optional(),
    somedayReviewCadenceDays: z.number().int().min(1).max(365).optional(),
    evidenceRequirementEnforced: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one preference field is required',
  });

// ---------------------------------------------------------------------------
// Persistence — raw SQL against owner_governance_preferences (migration 0340).
// ---------------------------------------------------------------------------

interface PreferenceRow {
  readonly autonomy_cap: string;
  readonly someday_review_cadence_days: number | string;
  readonly evidence_requirement_enforced: boolean;
}

function rowsOf(result: unknown): ReadonlyArray<PreferenceRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<PreferenceRow>;
  const r = (result as { rows?: ReadonlyArray<unknown> }).rows;
  return (r ?? []) as ReadonlyArray<PreferenceRow>;
}

function normalizeCap(value: string): AutonomyCap {
  return (AUTONOMY_CAPS as ReadonlyArray<string>).includes(value)
    ? (value as AutonomyCap)
    : DEFAULT_PREFERENCES.autonomyCap;
}

function toPreferences(row: PreferenceRow): GovernancePreferences {
  return Object.freeze({
    autonomyCap: normalizeCap(row.autonomy_cap),
    somedayReviewCadenceDays: Number(row.someday_review_cadence_days),
    evidenceRequirementEnforced: Boolean(row.evidence_requirement_enforced),
  });
}

type DbExec = { execute: (q: unknown) => Promise<unknown> };

async function readPreferences(
  db: DbExec,
  tenantId: string,
): Promise<GovernancePreferences> {
  const result = await db.execute(sql`
    SELECT autonomy_cap,
           someday_review_cadence_days,
           evidence_requirement_enforced
      FROM owner_governance_preferences
     WHERE tenant_id = ${tenantId}
     LIMIT 1
  `);
  const rows = rowsOf(result);
  return rows[0] ? toPreferences(rows[0]) : DEFAULT_PREFERENCES;
}

/**
 * Upsert the tenant's preferences. Reads the current row (or default) and
 * merges the supplied partial so a PUT that sets only one field leaves the
 * others intact. Tenant-scoped INSERT … ON CONFLICT under the RLS GUC.
 */
async function upsertPreferences(
  db: DbExec,
  tenantId: string,
  patch: z.infer<typeof UpdateSchema>,
): Promise<GovernancePreferences> {
  const current = await readPreferences(db, tenantId);
  const next: GovernancePreferences = Object.freeze({
    autonomyCap: patch.autonomyCap ?? current.autonomyCap,
    somedayReviewCadenceDays:
      patch.somedayReviewCadenceDays ?? current.somedayReviewCadenceDays,
    evidenceRequirementEnforced:
      patch.evidenceRequirementEnforced ?? current.evidenceRequirementEnforced,
  });
  await db.execute(sql`
    INSERT INTO owner_governance_preferences
      (tenant_id, autonomy_cap, someday_review_cadence_days,
       evidence_requirement_enforced, updated_at)
    VALUES
      (${tenantId}, ${next.autonomyCap}, ${next.somedayReviewCadenceDays},
       ${next.evidenceRequirementEnforced}, now())
    ON CONFLICT (tenant_id) DO UPDATE
      SET autonomy_cap = EXCLUDED.autonomy_cap,
          someday_review_cadence_days = EXCLUDED.someday_review_cadence_days,
          evidence_requirement_enforced = EXCLUDED.evidence_requirement_enforced,
          updated_at = now()
  `);
  return next;
}

// ---------------------------------------------------------------------------
// Scope guard — platform-admin OR owner-self.
// ---------------------------------------------------------------------------

function isAllowed(role: UserRole): boolean {
  return isPlatformAdmin(role) || role === UserRole.OWNER;
}

function dbUnavailable(c: { json: (b: unknown, s: number) => Response }) {
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

function forbidden(c: { json: (b: unknown, s: number) => Response }) {
  return c.json(
    {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Governance preferences are owner / platform-admin only',
      },
    },
    403,
  );
}

export function createCommitmentGovernanceRouter(): Hono {
  const router = new Hono();
  router.use('*', authMiddleware);
  router.use('*', databaseMiddleware);

  router.get('/', async (c) => {
    const auth = c.get('auth');
    if (!isAllowed(auth.role)) return forbidden(c);
    const db = c.get('db');
    if (!db) return dbUnavailable(c);
    try {
      const prefs = await readPreferences(db as DbExec, auth.tenantId);
      return c.json({ success: true, data: prefs });
    } catch (err) {
      moduleLogger.error('commitment-governance read failed', {
        tenantId: auth.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'GOVERNANCE_READ_FAILED',
            message: 'Could not read governance preferences right now',
          },
        },
        500,
      );
    }
  });

  router.put('/', zValidator('json', UpdateSchema), async (c) => {
    const auth = c.get('auth');
    if (!isAllowed(auth.role)) return forbidden(c);
    const db = c.get('db');
    if (!db) return dbUnavailable(c);
    const patch = c.req.valid('json');
    try {
      const prefs = await upsertPreferences(db as DbExec, auth.tenantId, patch);
      moduleLogger.info('commitment-governance updated', {
        tenantId: auth.tenantId,
        autonomyCap: prefs.autonomyCap,
        somedayReviewCadenceDays: prefs.somedayReviewCadenceDays,
        evidenceRequirementEnforced: prefs.evidenceRequirementEnforced,
      });
      return c.json({ success: true, data: prefs });
    } catch (err) {
      moduleLogger.error('commitment-governance update failed', {
        tenantId: auth.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'GOVERNANCE_UPDATE_FAILED',
            message: 'Could not save governance preferences right now',
          },
        },
        500,
      );
    }
  });

  return router;
}

/** Stable export the index seam mounts at /owner/commitment-governance. */
export const commitmentGovernanceRouter = createCommitmentGovernanceRouter();
