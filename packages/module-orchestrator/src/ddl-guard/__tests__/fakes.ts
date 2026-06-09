/**
 * fakes.ts — shared builders for ddl-guard tests.
 *
 * `buildAcceptedDdl` produces a realistic, compiler-shaped migration
 * for the canonical `tenant_mod_{tenantId}_` namespace, including the
 * auto-injected canonical FORCE-RLS block. This is the "happy path"
 * every rejection test mutates one statement away from.
 *
 * `buildApprovalView` produces a valid four-eye approval record view
 * the gate accepts; tests flip individual fields to assert rejection.
 */

import { buildCanonicalRlsBlock } from '../rls-force-injector.js';
import type { FourEyeApprovalView } from '../four-eye-gate.js';

export const TENANT = 'acme_mining';

export function ns(slug: string, tenantId = TENANT): string {
  return `tenant_mod_${tenantId}_${slug}`;
}

/**
 * A real-shaped CREATE TABLE for a spawned entity — system columns
 * (with the canonical system DEFAULTs) + a few safe author columns.
 */
export function buildEntityTable(slug: string, tenantId = TENANT): string {
  const table = ns(slug, tenantId);
  return [
    `CREATE TABLE IF NOT EXISTS ${table} (`,
    '  id                  TEXT PRIMARY KEY,',
    '  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,',
    '  module_id           TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,',
    "  display_name        TEXT NOT NULL,",
    "  lifecycle_state     TEXT NOT NULL DEFAULT 'active',",
    '  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
    '  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
    '  deleted_at          TIMESTAMPTZ,',
    '  grade_pct           NUMERIC(18, 4),',
    '  sample_ref          VARCHAR(120),',
    '  assayed             BOOLEAN,',
    '  shipped_on          DATE,',
    '  ticket_count        INTEGER,',
    '  external_id         UUID,',
    '  metadata            JSONB',
    ');',
  ].join('\n');
}

export function buildIndexes(slug: string, tenantId = TENANT): string {
  const table = ns(slug, tenantId);
  return [
    `CREATE INDEX IF NOT EXISTS ${table}_tenant_idx ON ${table} (tenant_id) WHERE deleted_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS ${table}_grade_idx ON ${table} (grade_pct);`,
  ].join('\n');
}

/** Full accepted migration: header comment + table + indexes + RLS. */
export function buildAcceptedDdl(
  slug = 'assay',
  tenantId = TENANT,
): string {
  const table = ns(slug, tenantId);
  return [
    `-- Generated module migration for ${tenantId} / ${slug}`,
    buildEntityTable(slug, tenantId),
    buildIndexes(slug, tenantId),
    buildCanonicalRlsBlock(tenantId, [table]),
  ].join('\n\n');
}

export function buildApprovalView(
  overrides: Partial<{
    status: string;
    proposerUserId: string;
    approverIds: string[];
    toolName: string;
    tenantId: string | null;
    specSqlHash: string;
    moduleId: string;
    specId: string;
    executed: boolean;
  }> = {},
): FourEyeApprovalView {
  const proposerUserId = overrides.proposerUserId ?? 'user_proposer';
  const approverIds = overrides.approverIds ?? ['user_admin_a', 'user_admin_b'];
  return {
    action: {
      id: 'appr_1',
      proposerUserId,
      toolName: overrides.toolName ?? 'module.apply',
      tenantId: overrides.tenantId === undefined ? TENANT : overrides.tenantId,
      payload: {
        specSqlHash: overrides.specSqlHash ?? 'sha256:deadbeef',
        moduleId: overrides.moduleId ?? 'mod_0001',
        specId: overrides.specId ?? 'mspec_0001',
      },
    },
    status: overrides.status ?? 'approved',
    signatures: approverIds.map((id) => ({
      approverUserId: id,
      verdict: 'approve' as const,
    })),
    executed: overrides.executed ?? false,
  };
}
