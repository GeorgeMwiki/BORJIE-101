/**
 * artifact-repository — read on `document_artifacts`.
 *
 * Tenant-scoped via `app.tenant_id` GUC; this repository never bypasses
 * RLS. The worker scans across tenants by switching the GUC for each
 * tenant iteration (matches existing brain-evolution-worker pattern).
 */

import type { ApprovalState, DocumentArtifactRow } from '../types.js';
import type { SqlPort } from './recipe-repository.js';

export interface ArtifactRepository {
  countByRecipeWindow(args: {
    readonly recipe_id: string;
    readonly recipe_version: number;
    readonly window_start_iso: string;
    readonly window_end_iso: string;
  }): Promise<number>;
  /** New pending Tier-2 artifacts that have not yet been emitted to the queue. */
  listPendingTier2(args: {
    readonly tier2_classes: ReadonlyArray<string>;
    readonly since_iso: string;
    readonly limit: number;
  }): Promise<ReadonlyArray<DocumentArtifactRow>>;
  updateApprovalState(args: {
    readonly artifact_id: string;
    readonly approval_state: ApprovalState;
    readonly approved_by: string | null;
  }): Promise<void>;
  findById(id: string): Promise<DocumentArtifactRow | null>;
}

export function createArtifactRepository(sql: SqlPort): ArtifactRepository {
  return {
    async countByRecipeWindow(args) {
      const rows = await sql<{ count: string }>`
        select count(*)::text as count
        from document_artifacts
        where recipe_id = ${args.recipe_id}
          and recipe_version = ${args.recipe_version}
          and generated_at >= ${args.window_start_iso}::timestamptz
          and generated_at <= ${args.window_end_iso}::timestamptz
      `;
      const raw = rows[0]?.count ?? '0';
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    },
    async listPendingTier2(args) {
      // The join to document_recipes filters to Tier-2 recipes; the
      // approval-pending state is the queue entry condition.
      return sql<DocumentArtifactRow>`
        select a.id, a.tenant_id, a.recipe_id, a.recipe_version, a.format,
               a.storage_key, a.checksum,
               coalesce(a.span_citations, '[]'::jsonb) as span_citations,
               a.audit_hash, a.approval_state, a.approved_by, a.approved_at,
               a.generated_at
        from document_artifacts a
        join document_recipes r
          on r.id = a.recipe_id and r.version = a.recipe_version
        where a.approval_state = 'pending'
          and r.authority_tier = 2
          and r.class = any(${args.tier2_classes as ReadonlyArray<string> as unknown as string[]})
          and a.generated_at >= ${args.since_iso}::timestamptz
        order by a.generated_at asc
        limit ${args.limit}
      `;
    },
    async updateApprovalState(args) {
      if (args.approval_state === 'approved') {
        await sql`
          update document_artifacts
          set approval_state = ${args.approval_state},
              approved_by = ${args.approved_by},
              approved_at = now()
          where id = ${args.artifact_id}
        `;
      } else {
        await sql`
          update document_artifacts
          set approval_state = ${args.approval_state}
          where id = ${args.artifact_id}
        `;
      }
    },
    async findById(id) {
      const rows = await sql<DocumentArtifactRow>`
        select id, tenant_id, recipe_id, recipe_version, format, storage_key,
               checksum,
               coalesce(span_citations, '[]'::jsonb) as span_citations,
               audit_hash, approval_state, approved_by, approved_at, generated_at
        from document_artifacts
        where id = ${id}
        limit 1
      `;
      return rows[0] ?? null;
    },
  };
}
