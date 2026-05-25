/**
 * Postgres-backed MoveOutRepository (Wave 26 Agent Z3).
 *
 * Persists `MoveOutChecklist` aggregates to the `move_out_checklists`
 * table (migration 0097). The full aggregate is stored as JSON in the
 * `checklist_json` column with a mirrored `is_finalized` flag so the
 * "pending finalization" dashboard query can run without unpacking
 * JSONB.
 *
 * Tenant isolation: every SELECT / UPSERT includes `WHERE tenant_id =
 * :ctx`; the (tenant_id, lease_id) composite primary key prevents two
 * tenants from colliding on the same lease_id literal.
 */

import { sql } from 'drizzle-orm';
import type {
  MoveOutChecklist,
  MoveOutRepository,
} from '@borjie/domain-services/lease';
import type { TenantId } from '@borjie/domain-models';

interface MoveOutChecklistRow {
  readonly tenant_id: string;
  readonly lease_id: string;
  readonly checklist_json: Record<string, unknown>;
  readonly is_finalized: boolean;
  readonly currency: string;
  readonly total_deposit: string | number;
  readonly created_at: string;
  readonly updated_at: string;
}

function extractRows<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as T[];
  const maybe = (res as { rows?: T[] } | null)?.rows;
  return maybe ?? [];
}

export class PostgresMoveOutRepository implements MoveOutRepository {
  constructor(private readonly db: unknown) {}

  async findByLeaseId(
    leaseId: string,
    tenantId: TenantId,
  ): Promise<MoveOutChecklist | null> {
    if (!leaseId || !tenantId) return null;
    const res = await (this.db as {
      execute: (q: unknown) => Promise<unknown>;
    }).execute(
      sql`SELECT tenant_id, lease_id, checklist_json, is_finalized,
                 currency, total_deposit, created_at, updated_at
          FROM move_out_checklists
          WHERE tenant_id = ${tenantId as unknown as string}
            AND lease_id = ${leaseId}
          LIMIT 1`,
    );
    const rows = extractRows<MoveOutChecklistRow>(res);
    const first = rows[0];
    if (!first) return null;
    const json = (first.checklist_json ?? {}) as Partial<MoveOutChecklist>;
    return {
      ...(json as MoveOutChecklist),
      leaseId: first.lease_id,
      tenantId: first.tenant_id as unknown as TenantId,
    };
  }

  async save(checklist: MoveOutChecklist): Promise<MoveOutChecklist> {
    const jsonLiteral = JSON.stringify(checklist);
    const totalDeposit = checklist.depositReconciliation.totalDeposit ?? 0;
    const currency = checklist.depositReconciliation.currency ?? 'KES';
    const isFinalized =
      checklist.finalInspection.status === 'completed' &&
      checklist.utilityReadings.status === 'completed' &&
      checklist.depositReconciliation.status === 'completed' &&
      checklist.residencyProofLetter.status === 'completed';
    await (this.db as {
      execute: (q: unknown) => Promise<unknown>;
    }).execute(
      sql`INSERT INTO move_out_checklists (
            tenant_id, lease_id, checklist_json, is_finalized,
            currency, total_deposit, created_at, updated_at
          ) VALUES (
            ${checklist.tenantId as unknown as string},
            ${checklist.leaseId},
            ${jsonLiteral}::jsonb,
            ${isFinalized},
            ${currency},
            ${totalDeposit},
            ${checklist.createdAt},
            ${checklist.updatedAt}
          )
          ON CONFLICT (tenant_id, lease_id) DO UPDATE SET
            checklist_json = EXCLUDED.checklist_json,
            is_finalized   = EXCLUDED.is_finalized,
            currency       = EXCLUDED.currency,
            total_deposit  = EXCLUDED.total_deposit,
            updated_at     = EXCLUDED.updated_at`,
    );
    return checklist;
  }
}
