/**
 * Mr. Mwikila delegation store.
 *
 * Thin Drizzle-backed CRUD over `owner_delegation_prefs`. Read-side
 * collapses to the kernel `resolveDelegation` helper; write-side is
 * the `PATCH /v1/owner/delegation` endpoint handler.
 *
 * Tenant isolation lives at the RLS layer — recorder NEVER double-
 * filters by tenant. Validate the tenantId is set in the call to
 * trigger explicit failure paths in test doubles.
 */

import { sql } from 'drizzle-orm';

import { autonomy } from '@borjie/central-intelligence';
import { MwikilaError } from './types.js';
import type { DelegationCategory, DelegationTier } from './types.js';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ExecRow {
  readonly [key: string]: unknown;
}

function rowsOf(result: unknown): ReadonlyArray<ExecRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ExecRow>;
  const wrapped = result as { rows?: ReadonlyArray<ExecRow> };
  return wrapped?.rows ?? [];
}

function rowToPref(row: ExecRow): autonomy.DelegationPref {
  return Object.freeze({
    tenantId: row.tenant_id as string,
    category: row.category as DelegationCategory,
    tier: row.tier as DelegationTier,
    reversalWindowHours:
      row.reversal_window_hours === null ||
      row.reversal_window_hours === undefined
        ? null
        : Number(row.reversal_window_hours),
    envelopeThresholdTzs:
      row.envelope_threshold_tzs === null ||
      row.envelope_threshold_tzs === undefined
        ? null
        : Number(row.envelope_threshold_tzs),
    setByUserId: (row.set_by_user_id as string) ?? null,
    setAt: row.set_at as string,
    notes: (row.notes as string) ?? null,
  });
}

export interface MwikilaDelegationStoreDeps {
  readonly db: DbLike;
  readonly now?: () => Date;
}

export interface MwikilaDelegationStore {
  list(args: { readonly tenantId: string }): Promise<
    ReadonlyArray<autonomy.DelegationPref>
  >;
  get(args: {
    readonly tenantId: string;
    readonly category: DelegationCategory;
  }): Promise<autonomy.DelegationPref | null>;
  resolve(args: {
    readonly tenantId: string;
    readonly category: DelegationCategory;
  }): Promise<autonomy.ResolvedDelegation>;
  upsert(args: {
    readonly tenantId: string;
    readonly category: DelegationCategory;
    readonly tier: DelegationTier;
    readonly reversalWindowHours?: number | null;
    readonly envelopeThresholdTzs?: number | null;
    readonly setByUserId: string;
    readonly notes?: string | null;
  }): Promise<autonomy.DelegationPref>;
}

export function createMwikilaDelegationStore(
  deps: MwikilaDelegationStoreDeps,
): MwikilaDelegationStore {
  return Object.freeze({
    async list({ tenantId }) {
      if (!tenantId) {
        throw new MwikilaError('invalid_input', 'tenantId required');
      }
      const rows = rowsOf(
        await deps.db.execute(sql`
          SELECT * FROM owner_delegation_prefs
           WHERE tenant_id = ${tenantId}
           ORDER BY category ASC
        `),
      );
      return rows.map(rowToPref);
    },

    async get({ tenantId, category }) {
      if (!tenantId) {
        throw new MwikilaError('invalid_input', 'tenantId required');
      }
      const rows = rowsOf(
        await deps.db.execute(sql`
          SELECT * FROM owner_delegation_prefs
           WHERE tenant_id = ${tenantId}
             AND category = ${category}
           LIMIT 1
        `),
      );
      if (rows.length === 0) return null;
      return rowToPref(rows[0] as ExecRow);
    },

    async resolve({ tenantId, category }) {
      const pref = await this.get({ tenantId, category });
      return autonomy.resolveDelegation(pref, category);
    },

    async upsert({
      tenantId,
      category,
      tier,
      reversalWindowHours,
      envelopeThresholdTzs,
      setByUserId,
      notes,
    }) {
      if (!tenantId) {
        throw new MwikilaError('invalid_input', 'tenantId required');
      }
      const rows = rowsOf(
        await deps.db.execute(sql`
          INSERT INTO owner_delegation_prefs (
            tenant_id, category, tier, reversal_window_hours,
            envelope_threshold_tzs, set_by_user_id, notes
          ) VALUES (
            ${tenantId}, ${category}, ${tier},
            ${reversalWindowHours ?? null},
            ${envelopeThresholdTzs ?? null},
            ${setByUserId},
            ${notes ?? null}
          )
          ON CONFLICT (tenant_id, category) DO UPDATE
            SET tier = EXCLUDED.tier,
                reversal_window_hours = EXCLUDED.reversal_window_hours,
                envelope_threshold_tzs = EXCLUDED.envelope_threshold_tzs,
                set_by_user_id = EXCLUDED.set_by_user_id,
                set_at = NOW(),
                notes = EXCLUDED.notes,
                updated_at = NOW()
          RETURNING *
        `),
      );
      return rowToPref(rows[0] as ExecRow);
    },
  });
}
