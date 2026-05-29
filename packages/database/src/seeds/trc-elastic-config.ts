/**
 * TRC elastic-config seeder (internal test data only).
 *
 * Operational counterpart to `trc-questionnaire-baseline.ts`. Whereas the
 * baseline writes brain memory + lessons, this writes the structured
 * configuration the runtime consults at request time:
 *
 *   1. `tenants.settings.elasticConfig` — JSONB blob holding the
 *      elastic-architecture choices TRC made (approval thresholds, geo
 *      labels, role caps, property classes, payment rail, locale).
 *      Read by `tenant-config-service` / approval-router / geo-hierarchy
 *      validators at request time.
 *
 *   2. `approval_policies` — three rows (lease_exception, maintenance_
 *      cost, payment_flexibility) encoding the IF/ELIF approval flow from
 *      the questionnaire's Section 1, in the same JSON shape the demo-
 *      org seed uses so the approval-router treats both tenants the
 *      same way.
 *
 * Idempotency:
 *   - `tenants.settings` is read first then merged in-process; the merge
 *     preserves any existing settings keys (e.g. the inviteCodes the
 *     base scaffold writes).
 *   - `approval_policies` uses ON CONFLICT DO NOTHING on the composite
 *     (tenant_id, type) primary key — re-runs are no-ops.
 *
 * Disclaimer:
 *   trc-* test tenant only. Do NOT reference TRC in productized copy.
 */

import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import { tenants, approvalPolicies } from '../schemas/index.js';
import { TRC_TENANT_ID } from './trc-test-org-seed.js';

// ---------------------------------------------------------------------------
// Currency conversion — TZS has 2 minor units (10_000_00 minor = 100K TZS).
// 500K TZS major = 50_000_000 minor. Matches demo-org-seed convention.
// ---------------------------------------------------------------------------

const TZS_500K_MAJOR = 500_000;
const TZS_500K_MINOR = 50_000_000;

// ---------------------------------------------------------------------------
// Public shape — the JSONB blob written to tenants.settings.elasticConfig.
// Frozen-at-build so callers can introspect without re-reading the file.
// ---------------------------------------------------------------------------

export interface TrcApprovalThresholds {
  readonly bareland_dg_threshold_tzs: number;
  readonly developed_dg_threshold_tzs: number;
  readonly low_threshold_skip_dg: boolean;
}

export interface TrcRoleHierarchy {
  readonly owner_mapping: string;
  readonly super_admin_cap: number;
  readonly admin_levels: number;
  readonly station_master_is_tag: boolean;
}

export interface TrcElasticConfig {
  readonly approvalThresholds: TrcApprovalThresholds;
  readonly geoHierarchyLabels: ReadonlyArray<string>;
  readonly geoHierarchyInverted: boolean;
  readonly roleHierarchy: TrcRoleHierarchy;
  readonly propertyClassesAdopted: ReadonlyArray<string>;
  readonly paymentRails: {
    readonly primary: string;
    readonly currency: string;
  };
  readonly localePosture: {
    readonly locale: string;
    readonly timezone: string;
    readonly defaultCurrency: string;
  };
  readonly configurableWorkflows: ReadonlyArray<string>;
  readonly sourceDoc: string;
  readonly seedVersion: string;
}

export const TRC_ELASTIC_CONFIG: TrcElasticConfig = {
  approvalThresholds: {
    bareland_dg_threshold_tzs: TZS_500K_MAJOR,
    developed_dg_threshold_tzs: TZS_500K_MAJOR,
    low_threshold_skip_dg: true,
  },
  // Section 2 directive — TRC's specific inversion (Districts contain Regions).
  geoHierarchyLabels: ['district', 'region', 'station', 'asset'],
  geoHierarchyInverted: true,
  roleHierarchy: {
    owner_mapping: 'Estate Management Unit (EMU)',
    super_admin_cap: 2,
    admin_levels: 4,
    station_master_is_tag: true,
  },
  propertyClassesAdopted: [
    'commercial',
    'mixed_use',
    'villas',
    'hotels',
    'plots',
    'warehouses',
    'bareland',
  ],
  paymentRails: {
    primary: 'gepg',
    currency: 'TZS',
  },
  localePosture: {
    locale: 'sw-TZ',
    timezone: 'Africa/Dar_es_Salaam',
    defaultCurrency: 'TZS',
  },
  configurableWorkflows: [
    'lease_exception',
    'maintenance_cost',
    'payment_flexibility',
    'document_expiry',
    'station_routing_by_proximity',
  ],
  sourceDoc:
    'Docs/requirements/VOICE_MEMO_2026-04-18_questionnaire_analysis.md',
  seedVersion: '2026-04-18-baseline',
};

// ---------------------------------------------------------------------------
// Approval policies — three rows mirroring the demo-org-seed shape so the
// approval-router code path treats TRC and demo identically. The threshold
// values come from the questionnaire's Section 1 IF/ELIF pseudocode.
// ---------------------------------------------------------------------------

const TRC_LEASE_EXCEPTION_POLICY = {
  type: 'lease_exception',
  currency: 'TZS',
  thresholds: [
    {
      maxAmountMinor: TZS_500K_MINOR,
      approver: 'ESTATE_MANAGER',
      description:
        'Rent <= 500K TZS — Department / EMU may sign; no DG involvement.',
    },
    {
      maxAmountMinor: null,
      approver: 'DIRECTOR_GENERAL',
      description:
        'Rent > 500K TZS — bareland routes via DCEI then DG; developed routes direct to DG.',
    },
  ],
  autoApproveRules: [],
  approvalChain: ['ESTATE_MANAGER', 'DIRECTOR_GENERAL'],
  defaultTimeoutHours: 120,
  autoEscalateToRole: 'DIRECTOR_GENERAL',
  /** Section-1 specific branch the router consults when asset_type=bareland. */
  conditionalBranches: [
    {
      whenAssetType: 'bareland',
      whenMinorGte: TZS_500K_MINOR,
      chain: ['DCEI_REVIEW', 'DIRECTOR_GENERAL'],
    },
    {
      whenAssetType: 'developed',
      whenMinorGte: TZS_500K_MINOR,
      chain: ['DIRECTOR_GENERAL'],
    },
  ],
};

const TRC_MAINTENANCE_POLICY = {
  type: 'maintenance_cost',
  currency: 'TZS',
  thresholds: [
    {
      maxAmountMinor: TZS_500K_MINOR,
      approver: 'ESTATE_MANAGER',
      description: 'Up to 500K TZS maintenance cost — EMU approves.',
    },
    {
      maxAmountMinor: null,
      approver: 'DIRECTOR_GENERAL',
      description: '>500K TZS — DG approval required.',
    },
  ],
  autoApproveRules: [],
  approvalChain: ['ESTATE_MANAGER', 'DIRECTOR_GENERAL'],
  defaultTimeoutHours: 72,
  autoEscalateToRole: 'DIRECTOR_GENERAL',
};

const TRC_PAYMENT_FLEXIBILITY_POLICY = {
  type: 'payment_flexibility',
  currency: 'TZS',
  thresholds: [
    {
      maxMonthsLate: 3,
      approver: 'ESTATE_MANAGER',
      description: 'Up to 3 months late — EMU may grant flexibility plan.',
    },
    {
      maxMonthsLate: null,
      approver: 'DIRECTOR_GENERAL',
      description: '>3 months late — DG review required.',
    },
  ],
  autoApproveRules: [],
  approvalChain: ['ESTATE_MANAGER', 'DIRECTOR_GENERAL'],
  defaultTimeoutHours: 168,
  autoEscalateToRole: 'DIRECTOR_GENERAL',
};

const TRC_APPROVAL_POLICIES = [
  TRC_LEASE_EXCEPTION_POLICY,
  TRC_MAINTENANCE_POLICY,
  TRC_PAYMENT_FLEXIBILITY_POLICY,
] as const;

// ---------------------------------------------------------------------------
// Public seed entrypoint.
// ---------------------------------------------------------------------------

export interface TrcElasticConfigResult {
  readonly elasticConfigKeys: ReadonlyArray<string>;
  readonly approvalPoliciesWritten: number;
}

export async function seedTrcElasticConfig(
  db: DatabaseClient,
): Promise<TrcElasticConfigResult> {
  console.log('[trc-elastic] starting elastic-config seed');

  await db.transaction(async (tx) => {
    // 1. Merge elasticConfig into tenants.settings. We read-then-write so
    //    we don't clobber unrelated keys (e.g. inviteCodes) other seeds
    //    may write.
    const rows = await tx
      .select({ id: tenants.id, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, TRC_TENANT_ID));

    const existing =
      (rows[0]?.settings as Record<string, unknown> | null | undefined) ?? {};

    const merged = {
      ...existing,
      elasticConfig: TRC_ELASTIC_CONFIG,
    };

    await tx
      .update(tenants)
      .set({ settings: merged })
      .where(eq(tenants.id, TRC_TENANT_ID));

    // 2. Approval policies — composite PK on (tenant_id, type).
    for (const policy of TRC_APPROVAL_POLICIES) {
      await tx
        .insert(approvalPolicies)
        .values({
          tenantId: TRC_TENANT_ID,
          type: policy.type,
          policyJson: policy,
          updatedBy: 'system-seed-trc',
        })
        .onConflictDoNothing();
    }
  });

  const result: TrcElasticConfigResult = {
    elasticConfigKeys: Object.keys(TRC_ELASTIC_CONFIG),
    approvalPoliciesWritten: TRC_APPROVAL_POLICIES.length,
  };

  console.log(
    `[trc-elastic] elastic_config_keys=${result.elasticConfigKeys.length} approval_policies=${result.approvalPoliciesWritten}`,
  );
  return result;
}

// Re-exports for tests.
export const TRC_ELASTIC_CONFIG_APPROVAL_POLICIES = TRC_APPROVAL_POLICIES;
