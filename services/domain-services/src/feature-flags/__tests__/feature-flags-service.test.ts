/**
 * Feature Flags Service tests — Wave 9 enterprise polish.
 *
 * Covers:
 *   - isEnabled(): tenant override precedence
 *   - isEnabled(): platform default fallback
 *   - isEnabled(): unknown flag returns false (closed-by-default)
 *   - list(): merges defaults with per-tenant overrides
 *   - setOverride(): creates + updates (idempotent on second call)
 *   - setOverride(): rejects unknown flags
 *   - setOverride(): validates inputs
 *   - cross-tenant isolation (tenant A's override cannot leak to tenant B)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createFeatureFlagsService,
  FeatureFlagError,
  type FeatureFlag,
  type FeatureFlagsRepository,
  type TenantFeatureFlagOverride,
} from '../feature-flags-service.js';

function makeRepo(
  initialFlags: readonly FeatureFlag[] = [],
): {
  repo: FeatureFlagsRepository;
  flags: FeatureFlag[];
  overrides: TenantFeatureFlagOverride[];
} {
  const flags: FeatureFlag[] = [...initialFlags];
  const overrides: TenantFeatureFlagOverride[] = [];

  const repo: FeatureFlagsRepository = {
    async listFlags() {
      return flags.map((f) => ({ ...f }));
    },
    async findFlagByKey(flagKey) {
      const found = flags.find((f) => f.flagKey === flagKey);
      return found ? { ...found } : null;
    },
    async listOverridesForTenant(tenantId) {
      return overrides
        .filter((o) => o.tenantId === tenantId)
        .map((o) => ({ ...o }));
    },
    async findOverride(tenantId, flagKey) {
      const found = overrides.find(
        (o) => o.tenantId === tenantId && o.flagKey === flagKey,
      );
      return found ? { ...found } : null;
    },
    async upsertOverride(row) {
      const idx = overrides.findIndex(
        (o) => o.tenantId === row.tenantId && o.flagKey === row.flagKey,
      );
      if (idx >= 0) {
        overrides[idx] = { ...row };
      } else {
        overrides.push({ ...row });
      }
      return { ...row };
    },
  };

  return { repo, flags, overrides };
}

const sampleFlags: FeatureFlag[] = [
  {
    id: 'ff_ai_negotiation',
    flagKey: 'enable_ai_negotiation',
    description: 'AI-guided negotiation turns.',
    defaultEnabled: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
  {
    id: 'ff_predictive_maint',
    flagKey: 'enable_predictive_maintenance',
    description: 'Predictive maintenance signals.',
    defaultEnabled: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
  {
    id: 'ff_gdpr_delete',
    flagKey: 'enable_gdpr_delete',
    description: 'GDPR deletion.',
    defaultEnabled: false,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
];

const fixedNow = () => new Date('2026-04-19T12:00:00.000Z');
let idCounter = 0;
function resetIds() {
  idCounter = 0;
}
function fixedId() {
  return `id_${++idCounter}`;
}

describe('FeatureFlagsService.isEnabled', () => {
  beforeEach(() => resetIds());

  it('returns the platform default when no override exists', async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await expect(
      svc.isEnabled('tenant_a', 'enable_ai_negotiation'),
    ).resolves.toBe(true);
    await expect(
      svc.isEnabled('tenant_a', 'enable_gdpr_delete'),
    ).resolves.toBe(false);
  });

  it('tenant override takes precedence over platform default', async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    // Default for enable_ai_negotiation is TRUE — disable it for tenant_a.
    await svc.setOverride('tenant_a', 'enable_ai_negotiation', false);
    await expect(
      svc.isEnabled('tenant_a', 'enable_ai_negotiation'),
    ).resolves.toBe(false);
  });

  it('tenant override can flip a default-off flag to on', async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await svc.setOverride('tenant_a', 'enable_gdpr_delete', true);
    await expect(
      svc.isEnabled('tenant_a', 'enable_gdpr_delete'),
    ).resolves.toBe(true);
  });

  it('unknown flag returns false (closed-by-default)', async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await expect(
      svc.isEnabled('tenant_a', 'enable_something_nonexistent'),
    ).resolves.toBe(false);
  });

  it('rejects empty tenantId', async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await expect(
      svc.isEnabled('', 'enable_ai_negotiation'),
    ).rejects.toBeInstanceOf(FeatureFlagError);
  });

  it('rejects invalid flagKey format', async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await expect(
      svc.isEnabled('tenant_a', 'Enable-Bad-Key'),
    ).rejects.toBeInstanceOf(FeatureFlagError);
  });
});

describe('FeatureFlagsService.list', () => {
  beforeEach(() => resetIds());

  it('returns every flag with override metadata', async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await svc.setOverride('tenant_a', 'enable_ai_negotiation', false);
    const list = await svc.list('tenant_a');
    expect(list).toHaveLength(3);

    const ai = list.find((f) => f.flagKey === 'enable_ai_negotiation');
    expect(ai).toBeDefined();
    expect(ai!.enabled).toBe(false);
    expect(ai!.isOverridden).toBe(true);
    expect(ai!.overrideValue).toBe(false);
    expect(ai!.defaultEnabled).toBe(true);

    const pm = list.find(
      (f) => f.flagKey === 'enable_predictive_maintenance',
    );
    expect(pm!.enabled).toBe(true);
    expect(pm!.isOverridden).toBe(false);
    expect(pm!.overrideValue).toBeNull();
  });

  it('returns empty overrideValue for flags without overrides', async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    const list = await svc.list('tenant_a');
    for (const f of list) {
      expect(f.isOverridden).toBe(false);
      expect(f.overrideValue).toBeNull();
      expect(f.enabled).toBe(f.defaultEnabled);
    }
  });
});

describe('FeatureFlagsService.setOverride', () => {
  beforeEach(() => resetIds());

  it('creates a new override row', async () => {
    const { repo, overrides } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    const res = await svc.setOverride(
      'tenant_a',
      'enable_ai_negotiation',
      false,
    );
    expect(res.tenantId).toBe('tenant_a');
    expect(res.flagKey).toBe('enable_ai_negotiation');
    expect(res.enabled).toBe(false);
    expect(overrides).toHaveLength(1);
  });

  it('updates an existing override in place (does not duplicate)', async () => {
    const { repo, overrides } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await svc.setOverride('tenant_a', 'enable_ai_negotiation', false);
    await svc.setOverride('tenant_a', 'enable_ai_negotiation', true);
    expect(overrides).toHaveLength(1);
    expect(overrides[0].enabled).toBe(true);
  });

  it('rejects unknown flag', async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await expect(
      svc.setOverride('tenant_a', 'enable_unknown', true),
    ).rejects.toMatchObject({ code: 'UNKNOWN_FLAG' });
  });

  it('rejects non-boolean enabled', async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await expect(
      svc.setOverride(
        'tenant_a',
        'enable_ai_negotiation',
        'yes' as unknown as boolean,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('FeatureFlagsService cross-tenant isolation', () => {
  beforeEach(() => resetIds());

  it("tenant A's override does NOT affect tenant B", async () => {
    const { repo } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });

    // Disable AI negotiation for tenant_a only.
    await svc.setOverride('tenant_a', 'enable_ai_negotiation', false);

    // tenant_a sees FALSE.
    await expect(
      svc.isEnabled('tenant_a', 'enable_ai_negotiation'),
    ).resolves.toBe(false);

    // tenant_b still sees the platform default (TRUE).
    await expect(
      svc.isEnabled('tenant_b', 'enable_ai_negotiation'),
    ).resolves.toBe(true);

    // list() is also isolated.
    const listA = await svc.list('tenant_a');
    const listB = await svc.list('tenant_b');
    expect(
      listA.find((f) => f.flagKey === 'enable_ai_negotiation')!.enabled,
    ).toBe(false);
    expect(
      listB.find((f) => f.flagKey === 'enable_ai_negotiation')!.enabled,
    ).toBe(true);
  });

  it('two tenants can hold opposing overrides for the same flag', async () => {
    const { repo, overrides } = makeRepo(sampleFlags);
    const svc = createFeatureFlagsService({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await svc.setOverride('tenant_a', 'enable_ai_negotiation', false);
    await svc.setOverride('tenant_b', 'enable_ai_negotiation', true);
    expect(overrides).toHaveLength(2);
    await expect(
      svc.isEnabled('tenant_a', 'enable_ai_negotiation'),
    ).resolves.toBe(false);
    await expect(
      svc.isEnabled('tenant_b', 'enable_ai_negotiation'),
    ).resolves.toBe(true);
  });
});
