/**
 * governance-store.ts — the per-tenant governance set-points the LIVING-MD
 * organ reads FRESH on every tick (never cached).
 *
 * THE RAIL (felt-plan edge-case): the autonomy cap — and the someday cadence,
 * the evidence-required toggle, the closure probe map — MUST take effect
 * IMMEDIATELY. If the owner lowers their MD's autonomy mid-session, the very
 * next reconcile tick / post-turn hook must clamp to the new ceiling. So this
 * store NEVER caches: every `read(tenantId)` hits `owner_governance_preferences`
 * (migration 0340) fresh, and an absent row / absent table resolves to the safe
 * in-code defaults (so the organ governs at the platform floor when nothing is
 * persisted, never crashes).
 *
 * `autonomyCap` is clamped ≤ 'delegate' on the read path as defence in depth —
 * the column CHECK already bounds it, but a code-side clamp guarantees the MD
 * can never be configured to auto-actuate a sovereign action (the safe-halt
 * hard rail). `evidenceRequirementEnforced` is floored true unless explicitly
 * persisted false (the CLAUDE.md evidence-required hard rule).
 *
 * Out-of-band RLS: reads/writes run inside `withServiceRoleContext` and are
 * explicitly tenant-scoped in SQL. Best-effort reads never throw (a fault
 * degrades to defaults). No `console.*` (Pino shim only). Immutable returns.
 */

import { sql } from 'drizzle-orm';
import { withServiceRoleContext } from '@borjie/database';
import type { OwnerAutonomyCap } from '@borjie/database/schemas';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';

export interface GovernancePreferences {
  readonly autonomyCap: OwnerAutonomyCap;
  readonly somedayReviewCadenceDays: number;
  readonly evidenceRequirementEnforced: boolean;
  readonly confirmationProbeMappings: Readonly<Record<string, string>>;
}

export interface GovernanceUpdate {
  readonly autonomyCap?: OwnerAutonomyCap;
  readonly somedayReviewCadenceDays?: number;
  readonly evidenceRequirementEnforced?: boolean;
  readonly confirmationProbeMappings?: Readonly<Record<string, string>>;
}

export interface GovernanceStore {
  /** Read the tenant's set-points FRESH (never cached). Defaults when absent. */
  read(tenantId: string): Promise<GovernancePreferences>;
  /** Upsert the tenant's set-points. Returns the post-write fresh read. */
  upsert(tenantId: string, patch: GovernanceUpdate): Promise<GovernancePreferences>;
}

/** The safe platform-floor defaults (an absent row / table resolves to these). */
export const DEFAULT_GOVERNANCE: GovernancePreferences = Object.freeze({
  autonomyCap: 'delegate' as OwnerAutonomyCap,
  somedayReviewCadenceDays: 7,
  evidenceRequirementEnforced: true,
  confirmationProbeMappings: Object.freeze({}),
});

/** The autonomy ladder, ascending. The cap is clamped to its top ('delegate'). */
const AUTONOMY_LADDER: ReadonlyArray<OwnerAutonomyCap> = [
  'observe',
  'nudge',
  'draft',
  'delegate',
];

/** Clamp any inbound cap to a known rung ≤ 'delegate' (the safe-halt ceiling). */
function clampCap(raw: unknown): OwnerAutonomyCap {
  const v = typeof raw === 'string' ? raw : '';
  return AUTONOMY_LADDER.includes(v as OwnerAutonomyCap)
    ? (v as OwnerAutonomyCap)
    : 'delegate';
}

function clampCadence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_GOVERNANCE.somedayReviewCadenceDays;
  return Math.min(365, Math.max(1, Math.trunc(n)));
}

export interface GovernanceDbLike {
  execute(query: unknown): Promise<unknown>;
  transaction?: unknown;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })
    ?.rows;
  return Array.isArray(rows) ? rows : [];
}

function rowToPrefs(row: Record<string, unknown>): GovernancePreferences {
  const probes = row.confirmation_probe_mappings;
  const probeMap: Record<string, string> = {};
  if (probes && typeof probes === 'object' && !Array.isArray(probes)) {
    for (const [k, v] of Object.entries(probes as Record<string, unknown>)) {
      if (typeof v === 'string') probeMap[k] = v;
    }
  }
  return Object.freeze({
    autonomyCap: clampCap(row.autonomy_cap),
    somedayReviewCadenceDays: clampCadence(row.someday_review_cadence_days),
    // Floor TRUE unless explicitly persisted false (evidence-required hard rule).
    evidenceRequirementEnforced: row.evidence_requirement_enforced !== false,
    confirmationProbeMappings: Object.freeze(probeMap),
  });
}

/**
 * Build the governance store. When `db` is null the store returns the safe
 * defaults on read and the patch-clamped values on upsert (a pure in-code
 * degrade) so the organ still governs at the platform floor without a DB.
 */
export function createGovernanceStore(deps: {
  readonly db: GovernanceDbLike | null;
  readonly logger?: PinoLikeLogger;
}): GovernanceStore {
  const logger = deps.logger ?? createPinoLikeLogger('md-governance-store');
  const db = deps.db;

  return {
    async read(tenantId: string): Promise<GovernancePreferences> {
      if (!db) return DEFAULT_GOVERNANCE;
      try {
        const rows = await withServiceRoleContext(
          db as unknown as Parameters<typeof withServiceRoleContext>[0],
          async (tx) => {
            const txDb = tx as unknown as GovernanceDbLike;
            return rowsOf(
              await txDb.execute(sql`
                SELECT autonomy_cap, someday_review_cadence_days,
                       evidence_requirement_enforced, confirmation_probe_mappings
                  FROM owner_governance_preferences
                 WHERE tenant_id = ${tenantId}
                 LIMIT 1
              `),
            );
          },
        );
        if (rows.length === 0) return DEFAULT_GOVERNANCE;
        return rowToPrefs(rows[0] as Record<string, unknown>);
      } catch (err) {
        // Fail-safe read: a fault degrades to the safe floor, never throws.
        logger.warn(
          {
            wiring: 'md-governance-store',
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'md-governance-store: read failed — degrading to safe defaults',
        );
        return DEFAULT_GOVERNANCE;
      }
    },

    async upsert(
      tenantId: string,
      patch: GovernanceUpdate,
    ): Promise<GovernancePreferences> {
      // Resolve the merged, clamped target over the current fresh read.
      const current = await this.read(tenantId);
      const next: GovernancePreferences = Object.freeze({
        autonomyCap:
          patch.autonomyCap !== undefined
            ? clampCap(patch.autonomyCap)
            : current.autonomyCap,
        somedayReviewCadenceDays:
          patch.somedayReviewCadenceDays !== undefined
            ? clampCadence(patch.somedayReviewCadenceDays)
            : current.somedayReviewCadenceDays,
        evidenceRequirementEnforced:
          patch.evidenceRequirementEnforced !== undefined
            ? patch.evidenceRequirementEnforced !== false
            : current.evidenceRequirementEnforced,
        confirmationProbeMappings:
          patch.confirmationProbeMappings !== undefined
            ? Object.freeze({ ...patch.confirmationProbeMappings })
            : current.confirmationProbeMappings,
      });

      if (!db) return next;
      try {
        await withServiceRoleContext(
          db as unknown as Parameters<typeof withServiceRoleContext>[0],
          async (tx) => {
            const txDb = tx as unknown as GovernanceDbLike;
            await txDb.execute(sql`
              INSERT INTO owner_governance_preferences
                (tenant_id, autonomy_cap, someday_review_cadence_days,
                 evidence_requirement_enforced, confirmation_probe_mappings,
                 updated_at)
              VALUES
                (${tenantId}, ${next.autonomyCap},
                 ${next.somedayReviewCadenceDays},
                 ${next.evidenceRequirementEnforced},
                 ${JSON.stringify(next.confirmationProbeMappings)}::jsonb,
                 now())
              ON CONFLICT (tenant_id) DO UPDATE SET
                autonomy_cap = EXCLUDED.autonomy_cap,
                someday_review_cadence_days = EXCLUDED.someday_review_cadence_days,
                evidence_requirement_enforced = EXCLUDED.evidence_requirement_enforced,
                confirmation_probe_mappings = EXCLUDED.confirmation_probe_mappings,
                updated_at = now()
            `);
          },
        );
      } catch (err) {
        logger.warn(
          {
            wiring: 'md-governance-store',
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'md-governance-store: upsert failed (returning the merged target unwritten)',
        );
      }
      return next;
    },
  };
}
