/**
 * Postgres-backed ApprovalGrantRepository — Wave 27 Agent D.
 *
 * Persists per-tenant approval grants to the `approval_grants` table
 * (migration 0112). Every read path uses Postgres `NOW()` so clock drift
 * on any client cannot bypass the expiry/validity window. Writes are
 * tenant-scoped by construction — the composition root pins tenantId to
 * the JWT before calling the service.
 *
 * No business logic lives here — that's in `ApprovalGrantService`. This
 * file is a thin adapter.
 */

import { sql } from 'drizzle-orm';
import type {
  ApprovalGrant,
  ApprovalGrantKind,
  ApprovalGrantDomain,
  ApprovalGrantRepository,
  ApprovalGrantUsage,
  ListActiveFilters,
  ListHistoryFilters,
} from '@borjie/ai-copilot/approval-grants';

interface ApprovalGrantRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly kind: string;
  readonly domain: string;
  readonly action_category: string;
  readonly scope_json: Record<string, unknown>;
  readonly valid_from: string;
  readonly valid_to: string | null;
  readonly used_count: number;
  readonly max_uses: number | null;
  readonly notes: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly revoked_at: string | null;
  readonly revoked_by: string | null;
  readonly revoke_reason: string | null;
}

export class PostgresApprovalGrantRepository
  implements ApprovalGrantRepository
{
  constructor(private readonly db: unknown) {}

  async insert(grant: ApprovalGrant): Promise<ApprovalGrant> {
    const scopeLiteral = JSON.stringify(grant.scope);
    try {
      await this.exec(
        sql`INSERT INTO approval_grants (
              id, tenant_id, kind, domain, action_category, scope_json,
              valid_from, valid_to, used_count, max_uses, notes,
              created_by, created_at, revoked_at, revoked_by, revoke_reason
            ) VALUES (
              ${grant.id}, ${grant.tenantId}, ${grant.kind}, ${grant.domain},
              ${grant.actionCategory}, ${scopeLiteral}::jsonb,
              ${grant.validFrom}::timestamptz,
              ${grant.validTo}::timestamptz,
              ${grant.usedCount}, ${grant.maxUses}, ${grant.notes},
              ${grant.createdBy}, ${grant.createdAt}::timestamptz,
              ${grant.revokedAt}::timestamptz, ${grant.revokedBy},
              ${grant.revokeReason}
            )`,
      );
      return grant;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/uniq_approval_grants_pending_single|duplicate key/i.test(msg)) {
        throw new Error(
          'A pending single-action grant already exists for this target',
        );
      }
      throw err;
    }
  }

  async findById(
    tenantId: string,
    grantId: string,
  ): Promise<ApprovalGrant | null> {
    const rows = await this.queryRows(
      sql`SELECT * FROM approval_grants
          WHERE tenant_id = ${tenantId} AND id = ${grantId}
          LIMIT 1`,
    );
    return rows[0] ? rowToGrant(rows[0]) : null;
  }

  async findActiveForCategory(
    tenantId: string,
    actionCategory: string,
    _nowIso: string,
  ): Promise<readonly ApprovalGrant[]> {
    // We intentionally IGNORE the caller's nowIso and use NOW() — any clock
    // drift on the caller side cannot bypass the grant's validity window.
    const rows = await this.queryRows(
      sql`SELECT * FROM approval_grants
          WHERE tenant_id = ${tenantId}
            AND action_category = ${actionCategory}
            AND revoked_at IS NULL
            AND valid_from <= NOW()
            AND (valid_to IS NULL OR valid_to > NOW())
            AND (max_uses IS NULL OR used_count < max_uses)
          ORDER BY
            CASE kind WHEN 'single_action' THEN 0 ELSE 1 END,
            created_at ASC`,
    );
    return rows.map(rowToGrant);
  }

  async listActive(
    tenantId: string,
    filters: ListActiveFilters,
    _nowIso: string,
  ): Promise<readonly ApprovalGrant[]> {
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    const domain = filters.domain ?? null;
    const kind = filters.kind ?? null;
    const actionCategory = filters.actionCategory ?? null;
    const rows = await this.queryRows(
      sql`SELECT * FROM approval_grants
          WHERE tenant_id = ${tenantId}
            AND revoked_at IS NULL
            AND valid_from <= NOW()
            AND (valid_to IS NULL OR valid_to > NOW())
            AND (max_uses IS NULL OR used_count < max_uses)
            AND (${domain}::text IS NULL OR domain = ${domain})
            AND (${kind}::text IS NULL OR kind = ${kind})
            AND (${actionCategory}::text IS NULL OR action_category = ${actionCategory})
          ORDER BY created_at DESC
          LIMIT ${limit}`,
    );
    return rows.map(rowToGrant);
  }

  async listHistory(
    tenantId: string,
    filters: ListHistoryFilters,
  ): Promise<readonly ApprovalGrant[]> {
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    const offset = Math.max(filters.offset ?? 0, 0);
    const includeRevoked = filters.includeRevoked ?? true;
    const domain = filters.domain ?? null;
    const kind = filters.kind ?? null;
    const actionCategory = filters.actionCategory ?? null;
    const rows = await this.queryRows(
      sql`SELECT * FROM approval_grants
          WHERE tenant_id = ${tenantId}
            AND (${includeRevoked}::boolean OR revoked_at IS NULL)
            AND (${domain}::text IS NULL OR domain = ${domain})
            AND (${kind}::text IS NULL OR kind = ${kind})
            AND (${actionCategory}::text IS NULL OR action_category = ${actionCategory})
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
    );
    return rows.map(rowToGrant);
  }

  async incrementUsage(
    grantId: string,
    tenantId: string,
    usage: ApprovalGrantUsage,
  ): Promise<{ usedCount: number; idempotent: boolean; usageId: string }> {
    // Step 1: try to INSERT the usage row. The (grant_id, action_ref) unique
    // constraint makes this idempotent — retries with the same actionRef
    // return the existing row without incrementing.
    const metaLiteral = JSON.stringify(usage.metadata ?? {});
    const inserted = await this.queryRows<{ id: string }>(
      sql`INSERT INTO approval_grant_usages (
            id, grant_id, tenant_id, action_ref, consumed_at, actor, metadata
          ) VALUES (
            ${usage.id}, ${grantId}, ${tenantId}, ${usage.actionRef},
            ${usage.consumedAt}::timestamptz, ${usage.actor},
            ${metaLiteral}::jsonb
          )
          ON CONFLICT (grant_id, action_ref) DO NOTHING
          RETURNING id`,
    );

    if (inserted.length === 0) {
      // Idempotent retry — find the existing usage row and return current
      // used_count without incrementing.
      const existing = await this.queryRows<{ id: string }>(
        sql`SELECT id FROM approval_grant_usages
            WHERE grant_id = ${grantId} AND action_ref = ${usage.actionRef}
            LIMIT 1`,
      );
      const grant = await this.queryRows<{ used_count: number }>(
        sql`SELECT used_count FROM approval_grants
            WHERE id = ${grantId} AND tenant_id = ${tenantId}
            LIMIT 1`,
      );
      return {
        usedCount: grant[0]?.used_count ?? 0,
        idempotent: true,
        usageId: existing[0]?.id ?? usage.id,
      };
    }

    // Step 2: bump the grant's used_count atomically.
    const updated = await this.queryRows<{ used_count: number }>(
      sql`UPDATE approval_grants
          SET used_count = used_count + 1
          WHERE id = ${grantId} AND tenant_id = ${tenantId}
            AND (max_uses IS NULL OR used_count < max_uses)
            AND revoked_at IS NULL
          RETURNING used_count`,
    );

    if (updated.length === 0) {
      // Grant was revoked / exhausted between insert-usage and increment.
      // Delete the orphan usage row to keep invariants tight.
      await this.exec(
        sql`DELETE FROM approval_grant_usages WHERE id = ${usage.id}`,
      );
      throw new Error('Grant revoked or exhausted during consume');
    }

    return {
      usedCount: updated[0]!.used_count,
      idempotent: false,
      usageId: usage.id,
    };
  }

  async revoke(
    grantId: string,
    tenantId: string,
    revokedBy: string,
    reason: string,
    nowIso: string,
  ): Promise<ApprovalGrant | null> {
    const rows = await this.queryRows(
      sql`UPDATE approval_grants
          SET revoked_at = ${nowIso}::timestamptz,
              revoked_by = ${revokedBy},
              revoke_reason = ${reason}
          WHERE id = ${grantId}
            AND tenant_id = ${tenantId}
            AND revoked_at IS NULL
          RETURNING *`,
    );
    return rows[0] ? rowToGrant(rows[0]) : null;
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------
  private async exec(q: unknown): Promise<void> {
    await (this.db as {
      execute: (q: unknown) => Promise<unknown>;
    }).execute(q);
  }

  private async queryRows<T = ApprovalGrantRow>(q: unknown): Promise<readonly T[]> {
    const res = await (this.db as {
      execute: (q: unknown) => Promise<unknown>;
    }).execute(q);
    if (Array.isArray(res)) return res as readonly T[];
    const maybe = res as { rows?: readonly T[] };
    return maybe?.rows ?? [];
  }
}

function rowToGrant(row: ApprovalGrantRow): ApprovalGrant {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind as ApprovalGrantKind,
    domain: row.domain as ApprovalGrantDomain,
    actionCategory: row.action_category,
    scope: (row.scope_json ?? {}) as ApprovalGrant['scope'],
    validFrom: toIso(row.valid_from),
    validTo: row.valid_to ? toIso(row.valid_to) : null,
    usedCount: row.used_count,
    maxUses: row.max_uses,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    revokedBy: row.revoked_by,
    revokeReason: row.revoke_reason,
  };
}

function toIso(v: string | Date): string {
  return typeof v === 'string' ? v : new Date(v).toISOString();
}
