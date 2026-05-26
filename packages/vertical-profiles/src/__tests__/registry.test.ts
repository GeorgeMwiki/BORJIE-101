/**
 * Vertical-profile registry tests (Wave VP-1).
 *
 * Targets the in-memory adapter directly; the SQL adapter ships in
 * a follow-up wave once the schemas package has the typed query
 * surface for migration 0057.
 */

import { describe, it, expect } from 'vitest';

import {
  createInMemoryRegistry,
  loadSeedProfiles,
  RESERVED_PROFILES,
  VerticalProfileError,
  VERTICAL_ANCHORS,
  VERTICAL_ENTITY_TEMPLATES,
  type VerticalProfileDefinition,
  type VerticalWorkflowDefinition,
} from '../index.js';

function mkMiningTzLikeProfile(
  overrides: Partial<VerticalProfileDefinition> = {},
): VerticalProfileDefinition {
  const base: VerticalProfileDefinition = {
    id: 'mining-tz',
    vertical: 'mining',
    region: 'tz',
    displayName: 'Mining (Tanzania)',
    status: 'live',
    description:
      'Live profile — Tanzanian mining sector. Regulators: TRA, Tumemadini (Mining Commission), NEMC, BoT, OSHA-TZ.',
    entities: VERTICAL_ENTITY_TEMPLATES.mining,
    glossary: [],
    regulatorBindings: [
      { regulatorId: 'tz-tra', filingKinds: ['vat-monthly'] },
      { regulatorId: 'tz-tumemadini', filingKinds: ['royalty-annual'] },
      { regulatorId: 'tz-nemc', filingKinds: ['eia'] },
      { regulatorId: 'tz-bot', filingKinds: ['fx-quarterly'] },
    ],
    capabilitySeeds: ['compose_doc.tumemadini'],
    provenance: VERTICAL_ANCHORS.mining ?? [],
    implementationPackage: '@borjie/vertical-profile-mining-tz',
  };
  return { ...base, ...overrides };
}

function mkWorkflow(
  overrides: Partial<VerticalWorkflowDefinition> = {},
): VerticalWorkflowDefinition {
  const base: VerticalWorkflowDefinition = {
    id: 'mining-tz.tra-vat-monthly',
    profileId: 'mining-tz',
    name: 'TRA Monthly VAT Filing',
    cadence: 'monthly',
    regulatorBinding: [{ regulatorId: 'tz-tra', filingKind: 'vat-monthly' }],
    dueDateRule: 'last-day-of-month + 20d',
    gracePeriodHours: 168,
    escalationHours: 24,
    inputContract: {
      fields: [
        { key: 'taxableSupplies', kind: 'number', required: true },
        { key: 'inputTaxClaimed', kind: 'number', required: true },
        { key: 'periodLabel', kind: 'string', required: true },
      ],
    },
    outputContract: {
      fields: [
        { key: 'vatPayable', kind: 'number', required: true },
        { key: 'controlNumber', kind: 'string', required: false },
      ],
    },
    provenance: [
      {
        url: 'https://www.tra.go.tz/index.php/value-added-tax-vat',
        title: 'TRA — Value Added Tax (VAT) Guidance',
        accessedAt: '2026-05-27',
      },
    ],
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe('VerticalProfileRegistry — CRUD', () => {
  it('upserts a profile and finds it by id', async () => {
    const reg = createInMemoryRegistry();
    const p = mkMiningTzLikeProfile();
    const stored = await reg.upsert(p);
    expect(stored.id).toBe('mining-tz');

    const found = await reg.findById('mining-tz');
    expect(found).not.toBeNull();
    expect(found?.status).toBe('live');
  });

  it('returns null on findById for unknown id', async () => {
    const reg = createInMemoryRegistry();
    const found = await reg.findById('mining-jp');
    expect(found).toBeNull();
  });

  it('finds by (vertical, region)', async () => {
    const reg = createInMemoryRegistry();
    await reg.upsert(mkMiningTzLikeProfile());
    const found = await reg.findByVerticalRegion('mining', 'tz');
    expect(found?.id).toBe('mining-tz');
  });

  it('upsert is idempotent — re-running with the same row succeeds', async () => {
    const reg = createInMemoryRegistry();
    await reg.upsert(mkMiningTzLikeProfile());
    await reg.upsert(mkMiningTzLikeProfile());
    await reg.upsert(mkMiningTzLikeProfile());
    const { profiles } = await reg.count();
    expect(profiles).toBe(1);
  });

  it('upsert validates with zod and rejects bad shapes', async () => {
    const reg = createInMemoryRegistry();
    const bad = mkMiningTzLikeProfile({ id: 'BAD-ID' });
    await expect(reg.upsert(bad)).rejects.toBeInstanceOf(VerticalProfileError);
  });

  it('reserved profile with non-null implementationPackage is rejected', async () => {
    const reg = createInMemoryRegistry();
    const bad = mkMiningTzLikeProfile({
      status: 'reserved',
      // implementationPackage must be null for reserved
    });
    await expect(reg.upsert(bad)).rejects.toBeInstanceOf(VerticalProfileError);
  });
});

// ---------------------------------------------------------------------------
// Listing + filtering
// ---------------------------------------------------------------------------

describe('VerticalProfileRegistry — listing + filtering', () => {
  it('lists all profiles sorted by id', async () => {
    const reg = createInMemoryRegistry();
    await loadSeedProfiles(reg);
    const all = await reg.list();
    expect(all.length).toBe(RESERVED_PROFILES.length);
    const sorted = [...all]
      .map((p) => p.id)
      .every((id, i, arr) => i === 0 || arr[i - 1]! <= id);
    expect(sorted).toBe(true);
  });

  it('filters by status — only reserved after the seed load', async () => {
    const reg = createInMemoryRegistry();
    await loadSeedProfiles(reg);
    const reserved = await reg.list({ status: 'reserved' });
    expect(reserved.length).toBe(RESERVED_PROFILES.length);
    expect(reserved.every((p) => p.status === 'reserved')).toBe(true);
    const live = await reg.list({ status: 'live' });
    expect(live.length).toBe(0);
  });

  it('filters by vertical', async () => {
    const reg = createInMemoryRegistry();
    await loadSeedProfiles(reg);
    const oil = await reg.list({ vertical: 'oilgas' });
    expect(oil.length).toBeGreaterThanOrEqual(9);
    expect(oil.every((p) => p.vertical === 'oilgas')).toBe(true);
  });

  it('filters by region (subdivision-aware)', async () => {
    const reg = createInMemoryRegistry();
    await loadSeedProfiles(reg);
    const usTx = await reg.list({ region: 'us-tx' });
    expect(usTx.length).toBeGreaterThanOrEqual(1);
    expect(usTx[0]?.region).toBe('us-tx');
  });
});

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

describe('VerticalProfileRegistry — workflows', () => {
  it('refuses to bind a workflow to an unknown profile', async () => {
    const reg = createInMemoryRegistry();
    await expect(reg.upsertWorkflow(mkWorkflow())).rejects.toMatchObject({
      code: 'WORKFLOW_PROFILE_MISMATCH',
    });
  });

  it('binds workflows and lists them via workflowsFor', async () => {
    const reg = createInMemoryRegistry();
    await reg.upsert(mkMiningTzLikeProfile());
    await reg.upsertWorkflow(mkWorkflow());
    await reg.upsertWorkflow(
      mkWorkflow({
        id: 'mining-tz.tumemadini-annual-royalty',
        name: 'Tumemadini Annual Royalty Filing',
        cadence: 'annual',
        regulatorBinding: [
          { regulatorId: 'tz-tumemadini', filingKind: 'royalty-annual' },
        ],
        dueDateRule: 'fiscal-year-end + 31d',
        provenance: [
          {
            url: 'https://www.madini.go.tz',
            title: 'Mining Commission — Tumemadini Royalty Filings',
            accessedAt: '2026-05-27',
          },
        ],
      }),
    );
    const flows = await reg.workflowsFor('mining-tz');
    expect(flows.length).toBe(2);
    const regulatorIds = flows
      .flatMap((w) => w.regulatorBinding.map((b) => b.regulatorId))
      .sort();
    expect(regulatorIds).toContain('tz-tra');
    expect(regulatorIds).toContain('tz-tumemadini');
  });

  it('rejects a workflow whose id is not prefixed by its profile id', async () => {
    const reg = createInMemoryRegistry();
    await reg.upsert(mkMiningTzLikeProfile());
    await expect(
      reg.upsertWorkflow(mkWorkflow({ id: 'oilgas-no.something' })),
    ).rejects.toBeInstanceOf(VerticalProfileError);
  });

  it('workflow upsert is idempotent', async () => {
    const reg = createInMemoryRegistry();
    await reg.upsert(mkMiningTzLikeProfile());
    await reg.upsertWorkflow(mkWorkflow());
    await reg.upsertWorkflow(mkWorkflow());
    const { workflows } = await reg.count();
    expect(workflows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Seed loader + mining-tz live-tenant workflow contract
// ---------------------------------------------------------------------------

describe('Seed loader + mining-tz live workflow bindings', () => {
  it('seeds 74 reserved profiles (no live profiles supplied)', async () => {
    const reg = createInMemoryRegistry();
    const result = await loadSeedProfiles(reg);
    expect(result.reservedRegistered).toBe(RESERVED_PROFILES.length);
    expect(result.reservedRegistered).toBeGreaterThanOrEqual(74);
    expect(result.liveRegistered).toBe(0);
    const { profiles, workflows } = await reg.count();
    expect(profiles).toBeGreaterThanOrEqual(35);
    expect(workflows).toBe(0);
  });

  it('seeds reserved + a supplied live mining-tz bundle and exposes TRA + Tumemadini + NEMC + BoT bindings', async () => {
    const reg = createInMemoryRegistry();
    const live = mkMiningTzLikeProfile();
    const workflows: ReadonlyArray<VerticalWorkflowDefinition> = [
      mkWorkflow(),
      mkWorkflow({
        id: 'mining-tz.tumemadini-annual-royalty',
        name: 'Tumemadini Annual Royalty Filing',
        cadence: 'annual',
        regulatorBinding: [
          { regulatorId: 'tz-tumemadini', filingKind: 'royalty-annual' },
        ],
        dueDateRule: 'fiscal-year-end + 31d',
      }),
      mkWorkflow({
        id: 'mining-tz.nemc-eia',
        name: 'NEMC EIA Submission',
        cadence: 'event',
        regulatorBinding: [{ regulatorId: 'tz-nemc', filingKind: 'eia' }],
        dueDateRule: 'trigger-event + 90d',
        provenance: [
          {
            url: 'https://www.nemc.or.tz',
            title: 'National Environment Management Council — EIA',
            accessedAt: '2026-05-27',
          },
        ],
      }),
      mkWorkflow({
        id: 'mining-tz.bot-fx-quarterly',
        name: 'BoT Gold-Window FX Quarterly Reporting',
        cadence: 'quarterly',
        regulatorBinding: [
          { regulatorId: 'tz-bot', filingKind: 'fx-quarterly' },
        ],
        dueDateRule: 'quarter-end + 30d',
        provenance: [
          {
            url: 'https://www.bot.go.tz',
            title: 'Bank of Tanzania — Gold Window Directive',
            accessedAt: '2026-05-27',
          },
        ],
      }),
    ];

    const result = await loadSeedProfiles(reg, [
      { profiles: [live], workflows },
    ]);
    expect(result.liveRegistered).toBe(1);
    expect(result.workflowsRegistered).toBe(4);

    const flows = await reg.workflowsFor('mining-tz');
    const regulatorIds = new Set(
      flows.flatMap((f) => f.regulatorBinding.map((b) => b.regulatorId)),
    );
    expect(regulatorIds.has('tz-tra')).toBe(true);
    expect(regulatorIds.has('tz-tumemadini')).toBe(true);
    expect(regulatorIds.has('tz-nemc')).toBe(true);
    expect(regulatorIds.has('tz-bot')).toBe(true);

    const { profiles: profileCount } = await reg.count();
    expect(profileCount).toBe(RESERVED_PROFILES.length + 1);
    expect(profileCount).toBeGreaterThanOrEqual(35);
  });

  it('seed loader is idempotent across multiple invocations', async () => {
    const reg = createInMemoryRegistry();
    const before = await loadSeedProfiles(reg);
    const after = await loadSeedProfiles(reg);
    expect(before.reservedRegistered).toBe(after.reservedRegistered);
    const { profiles } = await reg.count();
    expect(profiles).toBe(RESERVED_PROFILES.length);
  });

  it('every reserved profile carries ≥1 regulator binding and ≥1 provenance citation', async () => {
    for (const p of RESERVED_PROFILES) {
      expect(p.regulatorBindings.length).toBeGreaterThanOrEqual(1);
      expect(p.provenance.length).toBeGreaterThanOrEqual(1);
      expect(p.entities.length).toBeGreaterThanOrEqual(6);
      expect(p.implementationPackage).toBeNull();
      expect(p.status).toBe('reserved');
    }
  });

  it('reserved catalogue covers every vertical', async () => {
    const verticals = new Set(RESERVED_PROFILES.map((p) => p.vertical));
    expect(verticals.size).toBe(8);
    for (const v of [
      'mining',
      'agri',
      'oilgas',
      'fisheries',
      'forestry',
      'manufacturing',
      'tourism',
      'realestate',
    ]) {
      expect(verticals.has(v as never)).toBe(true);
    }
  });
});
