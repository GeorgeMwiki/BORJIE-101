/**
 * Unit tests for `seedTrcElasticConfig`.
 *
 * Covers:
 *   - The merge into `tenants.settings.elasticConfig` preserves
 *     pre-existing keys (no clobbering of inviteCodes etc.).
 *   - All required elastic-config keys are present and carry the
 *     questionnaire-derived values (threshold = 500K TZS major,
 *     geo labels district→region→station→asset, super-admin cap 2,
 *     etc.).
 *   - Three approval policies (lease_exception, maintenance_cost,
 *     payment_flexibility) are inserted into `approval_policies`
 *     under TRC_TENANT_ID.
 *   - The lease_exception policy carries the conditionalBranches
 *     branch metadata (bareland vs developed routing).
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseClient } from '../../client.js';
import {
  seedTrcElasticConfig,
  TRC_ELASTIC_CONFIG,
  TRC_ELASTIC_CONFIG_APPROVAL_POLICIES,
} from '../trc-elastic-config.js';
import { TRC_TENANT_ID } from '../trc-test-org-seed.js';

interface UpdateRecord {
  readonly tableName: string;
  readonly setValue: Record<string, unknown>;
}

interface InsertRecord {
  readonly tableName: string;
  readonly row: Record<string, unknown>;
}

function tableName(table: unknown): string {
  const t = table as Record<string | symbol, unknown>;
  const nameSym = Symbol.for('drizzle:Name');
  const baseNameSym = Symbol.for('drizzle:BaseName');
  const originalNameSym = Symbol.for('drizzle:OriginalName');
  return (
    (t[nameSym] as string | undefined) ??
    (t[baseNameSym] as string | undefined) ??
    (t[originalNameSym] as string | undefined) ??
    'unknown_table'
  );
}

interface StubResult {
  client: DatabaseClient;
  readonly updates: ReadonlyArray<UpdateRecord>;
  readonly inserts: ReadonlyArray<InsertRecord>;
}

function makeStubDb(initialSettings: Record<string, unknown> = {}): StubResult {
  const updates: UpdateRecord[] = [];
  const inserts: InsertRecord[] = [];

  function makeSelectChain(table: unknown): unknown {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      then: (resolve: (rows: unknown) => unknown) => {
        if (tableName(table) === 'tenants') {
          return resolve([{ id: TRC_TENANT_ID, settings: initialSettings }]);
        }
        return resolve([]);
      },
    };
    return chain;
  }

  function makeUpdateChain(table: unknown): unknown {
    const captured: { setValue?: Record<string, unknown> } = {};
    const chain: Record<string, unknown> = {
      set: (v: Record<string, unknown>) => {
        captured.setValue = v;
        return chain;
      },
      where: () => chain,
      then: (resolve: (v: unknown) => unknown) => {
        if (captured.setValue) {
          updates.push({
            tableName: tableName(table),
            setValue: captured.setValue,
          });
        }
        return resolve(undefined);
      },
    };
    return chain;
  }

  function makeInsertChain(table: unknown): unknown {
    const chain: Record<string, unknown> = {
      values: (row: Record<string, unknown>) => {
        inserts.push({ tableName: tableName(table), row });
        return chain;
      },
      onConflictDoNothing: () => chain,
      then: (resolve: (v: unknown) => unknown) => resolve(undefined),
    };
    return chain;
  }

  const tx = {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        const chain = makeSelectChain(table);
        return chain;
      },
    }),
    update: (table: unknown) => makeUpdateChain(table),
    insert: (table: unknown) => makeInsertChain(table),
  };

  // Some drizzle call paths read `tx.select({...}).from(table).where(...)`
  // rather than `tx.select().from(table)`. Swap to a richer factory.
  tx.select = (_cols?: unknown) => {
    const builder: Record<string, unknown> = {
      from: (table: unknown) => makeSelectChain(table),
    };
    return builder as unknown as { from: (t: unknown) => unknown };
  };

  const db = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };

  return {
    client: db as unknown as DatabaseClient,
    get updates() {
      return updates;
    },
    get inserts() {
      return inserts;
    },
  };
}

describe('seedTrcElasticConfig', () => {
  it('returns the expected key count and approval-policy count', async () => {
    const stub = makeStubDb();

    const result = await seedTrcElasticConfig(stub.client);

    expect(result.elasticConfigKeys).toEqual(Object.keys(TRC_ELASTIC_CONFIG));
    expect(result.approvalPoliciesWritten).toBe(
      TRC_ELASTIC_CONFIG_APPROVAL_POLICIES.length,
    );
  });

  it('merges elasticConfig into tenants.settings WITHOUT clobbering existing keys', async () => {
    const stub = makeStubDb({
      inviteCodes: [{ code: 'TRC-EXAMPLE-001' }],
      otherSetting: 42,
    });

    await seedTrcElasticConfig(stub.client);

    const tenantsUpdate = stub.updates.find(
      (u) => u.tableName === 'tenants',
    );
    expect(tenantsUpdate).toBeDefined();
    const settings = tenantsUpdate?.setValue.settings as Record<string, unknown>;
    expect(settings.elasticConfig).toBeDefined();
    // Existing keys preserved.
    expect(settings.inviteCodes).toEqual([{ code: 'TRC-EXAMPLE-001' }]);
    expect(settings.otherSetting).toBe(42);
  });

  it('writes the TRC-specific values into elasticConfig', async () => {
    const stub = makeStubDb();

    await seedTrcElasticConfig(stub.client);

    const tenantsUpdate = stub.updates.find(
      (u) => u.tableName === 'tenants',
    );
    const settings = tenantsUpdate?.setValue.settings as Record<string, unknown>;
    const ec = settings.elasticConfig as Record<string, unknown>;

    // Approval thresholds in TZS major units (questionnaire Section 1).
    const thresholds = ec.approvalThresholds as Record<string, unknown>;
    expect(thresholds.bareland_dg_threshold_tzs).toBe(500_000);
    expect(thresholds.developed_dg_threshold_tzs).toBe(500_000);
    expect(thresholds.low_threshold_skip_dg).toBe(true);

    // Geo hierarchy — TRC's specific inversion (Section 2).
    expect(ec.geoHierarchyLabels).toEqual([
      'district',
      'region',
      'station',
      'asset',
    ]);
    expect(ec.geoHierarchyInverted).toBe(true);

    // Role hierarchy.
    const roles = ec.roleHierarchy as Record<string, unknown>;
    expect(roles.owner_mapping).toBe('Estate Management Unit (EMU)');
    expect(roles.super_admin_cap).toBe(2);
    expect(roles.admin_levels).toBe(4);
    expect(roles.station_master_is_tag).toBe(true);

    // Property classes adopted.
    expect(ec.propertyClassesAdopted).toContain('commercial');
    expect(ec.propertyClassesAdopted).toContain('bareland');
    expect(ec.propertyClassesAdopted).toContain('warehouses');

    // Payment + locale.
    const payment = ec.paymentRails as Record<string, unknown>;
    expect(payment.primary).toBe('gepg');
    expect(payment.currency).toBe('TZS');
    const locale = ec.localePosture as Record<string, unknown>;
    expect(locale.locale).toBe('sw-TZ');
    expect(locale.timezone).toBe('Africa/Dar_es_Salaam');
    expect(locale.defaultCurrency).toBe('TZS');

    // Source-doc breadcrumb so an operator can audit back to the memo.
    expect(typeof ec.sourceDoc).toBe('string');
    expect(String(ec.sourceDoc)).toContain('VOICE_MEMO_2026-04-18');
  });

  it('inserts three approval policies under TRC_TENANT_ID', async () => {
    const stub = makeStubDb();

    await seedTrcElasticConfig(stub.client);

    const policyInserts = stub.inserts.filter(
      (i) => i.tableName === 'approval_policies',
    );
    expect(policyInserts).toHaveLength(3);

    const types = policyInserts.map((i) => i.row.type).sort();
    expect(types).toEqual([
      'lease_exception',
      'maintenance_cost',
      'payment_flexibility',
    ]);

    for (const ins of policyInserts) {
      expect(ins.row.tenantId).toBe(TRC_TENANT_ID);
      expect(ins.row.policyJson).toBeDefined();
      expect(ins.row.updatedBy).toBe('system-seed-trc');
    }
  });

  it('embeds the bareland vs developed conditional routing on the lease_exception policy', async () => {
    const stub = makeStubDb();

    await seedTrcElasticConfig(stub.client);

    const leaseExc = stub.inserts.find(
      (i) =>
        i.tableName === 'approval_policies' &&
        i.row.type === 'lease_exception',
    );
    expect(leaseExc).toBeDefined();
    const policy = leaseExc?.row.policyJson as Record<string, unknown>;
    const branches = policy.conditionalBranches as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(Array.isArray(branches)).toBe(true);
    expect(branches.length).toBeGreaterThanOrEqual(2);

    const baselandBranch = branches.find(
      (b) => b.whenAssetType === 'bareland',
    );
    expect(baselandBranch).toBeDefined();
    expect(baselandBranch?.chain).toContain('DCEI_REVIEW');
    expect(baselandBranch?.chain).toContain('DIRECTOR_GENERAL');

    const developedBranch = branches.find(
      (b) => b.whenAssetType === 'developed',
    );
    expect(developedBranch).toBeDefined();
    expect(developedBranch?.chain).toContain('DIRECTOR_GENERAL');
  });
});
