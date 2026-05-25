/**
 * Postgres-backed autonomy policy repository.
 *
 * Persists the per-tenant `AutonomyPolicy` to the `autonomy_policies`
 * table. The full policy JSON goes in `policy_json`; the
 * `autonomousModeEnabled` master switch, escalation IDs, version, and
 * `updatedBy` are mirrored into their own columns so operators can
 * query them directly without unpacking JSONB.
 *
 * This repo is an adapter — no business logic lives here. Merging /
 * defaults live in `AutonomyPolicyService`. The repo is tenant-scoped
 * by construction (tenantId is the primary key), so callers cannot
 * leak rows across tenants even if they pass a forged id because the
 * upstream middleware pins tenantId to the JWT.
 */

import { sql } from 'drizzle-orm';
import type {
  AutonomyPolicy,
  AutonomyPolicyRepository,
} from '@borjie/ai-copilot/autonomy';
import { buildDefaultPolicy } from '@borjie/ai-copilot/autonomy';
import { logger } from '../utils/logger.js';

interface AutonomyPolicyRow {
  readonly tenant_id: string;
  readonly autonomous_mode_enabled: boolean;
  readonly policy_json: Record<string, unknown>;
  readonly escalation_primary_user_id: string | null;
  readonly escalation_secondary_user_id: string | null;
  readonly version: number;
  readonly updated_at: string;
  readonly updated_by: string | null;
}

export class PostgresAutonomyPolicyRepository
  implements AutonomyPolicyRepository
{
  constructor(private readonly db: unknown) {}

  async get(tenantId: string): Promise<AutonomyPolicy | null> {
    if (!tenantId) return null;
    try {
      const res = await (this.db as unknown as {
        execute: (q: unknown) => Promise<unknown>;
      }).execute(
        sql`SELECT tenant_id, autonomous_mode_enabled, policy_json,
                   escalation_primary_user_id, escalation_secondary_user_id,
                   version, updated_at, updated_by
            FROM autonomy_policies
            WHERE tenant_id = ${tenantId}
            LIMIT 1`,
      );
      const rows = extractRows<AutonomyPolicyRow>(res);
      const first = rows[0];
      if (!first) return null;
      return rowToPolicy(first);
    } catch (err) {
      // Never throw across tenants — return null so the service falls
      // back to defaults. The caller's observability pipeline will log
      // the underlying error.
      logger.error('PostgresAutonomyPolicyRepository.get failed', { error: err });
      return null;
    }
  }

  async upsert(policy: AutonomyPolicy): Promise<AutonomyPolicy> {
    if (!policy.tenantId) {
      throw new Error('AutonomyPolicy.tenantId is required');
    }
    const json = policyToJson(policy);
    const jsonLiteral = JSON.stringify(json);
    await (this.db as unknown as {
      execute: (q: unknown) => Promise<unknown>;
    }).execute(
      sql`INSERT INTO autonomy_policies (
            tenant_id, autonomous_mode_enabled, policy_json,
            escalation_primary_user_id, escalation_secondary_user_id,
            version, updated_at, updated_by
          ) VALUES (
            ${policy.tenantId}, ${policy.autonomousModeEnabled}, ${jsonLiteral}::jsonb,
            ${policy.escalation.primaryUserId}, ${policy.escalation.secondaryUserId},
            ${policy.version}, ${policy.updatedAt}::timestamptz, ${policy.updatedBy}
          )
          ON CONFLICT (tenant_id) DO UPDATE SET
            autonomous_mode_enabled = EXCLUDED.autonomous_mode_enabled,
            policy_json = EXCLUDED.policy_json,
            escalation_primary_user_id = EXCLUDED.escalation_primary_user_id,
            escalation_secondary_user_id = EXCLUDED.escalation_secondary_user_id,
            version = EXCLUDED.version,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by`,
    );
    return policy;
  }
}

function extractRows<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as readonly T[];
  const maybe = res as { rows?: readonly T[] };
  return maybe?.rows ?? [];
}

function policyToJson(policy: AutonomyPolicy): Record<string, unknown> {
  // Everything except tenantId (which is the PK column) is serialised
  // into `policy_json`. Escalation contacts are duplicated into their
  // own columns by the upsert above — both shapes stay in sync.
  return {
    autonomousModeEnabled: policy.autonomousModeEnabled,
    finance: policy.finance,
    leasing: policy.leasing,
    maintenance: policy.maintenance,
    compliance: policy.compliance,
    communications: policy.communications,
    // Wave 27 Part B.9 — six additional domains serialised alongside.
    marketing: policy.marketing,
    hr: policy.hr,
    procurement: policy.procurement,
    insurance: policy.insurance,
    legal_proceedings: policy.legal_proceedings,
    tenant_welfare: policy.tenant_welfare,
    escalation: policy.escalation,
    version: policy.version,
    updatedAt: policy.updatedAt,
    updatedBy: policy.updatedBy,
  };
}

function rowToPolicy(row: AutonomyPolicyRow): AutonomyPolicy {
  const json = (row.policy_json ?? {}) as Partial<AutonomyPolicy>;
  const defaults = buildDefaultPolicy(row.tenant_id);
  return {
    tenantId: row.tenant_id,
    autonomousModeEnabled: row.autonomous_mode_enabled,
    finance: { ...defaults.finance, ...(json.finance ?? {}) },
    leasing: { ...defaults.leasing, ...(json.leasing ?? {}) },
    maintenance: { ...defaults.maintenance, ...(json.maintenance ?? {}) },
    compliance: {
      ...defaults.compliance,
      ...(json.compliance ?? {}),
      // Safety-critical invariant: legal notices NEVER auto-send
      // regardless of what a stale row claims.
      autoSendLegalNotices: false,
    },
    communications: {
      ...defaults.communications,
      ...(json.communications ?? {}),
    },
    // Wave 27 Part B.9 — merge defaults forward so rows written before
    // the expansion gain the new blocks transparently (no migration
    // needed — policy_json is jsonb).
    marketing: { ...defaults.marketing, ...(json.marketing ?? {}) },
    hr: { ...defaults.hr, ...(json.hr ?? {}) },
    procurement: { ...defaults.procurement, ...(json.procurement ?? {}) },
    insurance: { ...defaults.insurance, ...(json.insurance ?? {}) },
    legal_proceedings: {
      ...defaults.legal_proceedings,
      ...(json.legal_proceedings ?? {}),
      // Safety-critical invariant (same pattern as compliance.autoSendLegalNotices):
      // tribunal filings NEVER auto-submit regardless of stale row state.
      autoFileToTribunal: false,
    },
    tenant_welfare: {
      ...defaults.tenant_welfare,
      ...(json.tenant_welfare ?? {}),
    },
    escalation: {
      primaryUserId:
        row.escalation_primary_user_id ??
        json.escalation?.primaryUserId ??
        null,
      secondaryUserId:
        row.escalation_secondary_user_id ??
        json.escalation?.secondaryUserId ??
        null,
      fallbackEmails: json.escalation?.fallbackEmails ?? [],
    },
    version: row.version ?? json.version ?? 1,
    updatedAt:
      typeof row.updated_at === 'string'
        ? row.updated_at
        : new Date(row.updated_at as unknown as string).toISOString(),
    updatedBy: row.updated_by ?? json.updatedBy ?? null,
  };
}
