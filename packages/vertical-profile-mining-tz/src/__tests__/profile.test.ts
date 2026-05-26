/**
 * Mining-TZ profile tests (Wave VP-1).
 *
 * Exercise the live profile + workflow definitions end-to-end against
 * the in-memory registry from `@borjie/vertical-profiles`.
 */

import { describe, it, expect } from 'vitest';

import {
  createInMemoryRegistry,
  loadSeedProfiles,
  VerticalProfileDefinitionSchema,
  VerticalWorkflowDefinitionSchema,
} from '@borjie/vertical-profiles';

import {
  buildMiningTzBundle,
  MINING_TZ_CAPABILITY_SEEDS,
  MINING_TZ_ENTITIES,
  MINING_TZ_GLOSSARY,
  MINING_TZ_PROFILE,
  MINING_TZ_WORKFLOWS,
  TRA_VAT_MONTHLY,
  TUMEMADINI_ANNUAL_ROYALTY,
  NEMC_EIA,
  BOT_FX_QUARTERLY,
  OSHA_TZ_SAFETY_AUDIT,
  BUYER_KYC_VERIFICATION,
} from '../index.js';

describe('mining-tz profile — shape + schema', () => {
  it('passes the VerticalProfileDefinition zod schema', () => {
    const parsed = VerticalProfileDefinitionSchema.safeParse(MINING_TZ_PROFILE);
    expect(parsed.success).toBe(true);
  });

  it('declares id=mining-tz, status=live, with the @borjie/vertical-profile-mining-tz impl package', () => {
    expect(MINING_TZ_PROFILE.id).toBe('mining-tz');
    expect(MINING_TZ_PROFILE.vertical).toBe('mining');
    expect(MINING_TZ_PROFILE.region).toBe('tz');
    expect(MINING_TZ_PROFILE.status).toBe('live');
    expect(MINING_TZ_PROFILE.implementationPackage).toBe(
      '@borjie/vertical-profile-mining-tz',
    );
  });

  it('ships ≥10 canonical entities including mine_site, pit, shaft, stockpile, buyer, royalty_filing, permit, licence, worker, shift', () => {
    expect(MINING_TZ_ENTITIES.length).toBeGreaterThanOrEqual(10);
    const keys = MINING_TZ_ENTITIES.map((e) => e.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'mine_site',
        'pit',
        'shaft',
        'stockpile',
        'buyer',
        'royalty_filing',
        'permit',
        'licence',
        'worker',
        'shift',
      ]),
    );
  });

  it('ships ≥30 bilingual EN+SW glossary entries', () => {
    expect(MINING_TZ_GLOSSARY.length).toBeGreaterThanOrEqual(30);
    for (const g of MINING_TZ_GLOSSARY) {
      expect(typeof g.translations['en']).toBe('string');
      expect(typeof g.translations['sw']).toBe('string');
    }
  });

  it('binds the 5 launch regulators (TRA + Tumemadini + NEMC + BoT + OSHA-TZ)', () => {
    const ids = MINING_TZ_PROFILE.regulatorBindings.map((b) => b.regulatorId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'tz-tra',
        'tz-tumemadini',
        'tz-nemc',
        'tz-bot',
        'tz-osha',
      ]),
    );
  });

  it('seeds ≥6 capability ids the LMBM auto-mounts for mining-tz tenants', () => {
    expect(MINING_TZ_CAPABILITY_SEEDS.length).toBeGreaterThanOrEqual(6);
    expect(MINING_TZ_CAPABILITY_SEEDS).toContain('compose_doc.tumemadini-royalty');
    expect(MINING_TZ_CAPABILITY_SEEDS).toContain('kyc.buyer-verify');
  });

  it('every provenance citation carries url + title + accessedAt', () => {
    expect(MINING_TZ_PROFILE.provenance.length).toBeGreaterThanOrEqual(4);
    for (const c of MINING_TZ_PROFILE.provenance) {
      expect(c.url).toMatch(/^https?:\/\//);
      expect(c.title.length).toBeGreaterThan(3);
      expect(c.accessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('mining-tz workflows — shape + schema', () => {
  it('ships exactly the 6 launch workflows', () => {
    expect(MINING_TZ_WORKFLOWS.length).toBe(6);
    const ids = MINING_TZ_WORKFLOWS.map((w) => w.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'mining-tz.tra-vat-monthly',
        'mining-tz.tumemadini-annual-royalty',
        'mining-tz.nemc-eia',
        'mining-tz.bot-fx-quarterly',
        'mining-tz.osha-tz-safety-audit',
        'mining-tz.buyer-kyc-verification',
      ]),
    );
  });

  it('every workflow passes the VerticalWorkflowDefinition schema', () => {
    for (const w of MINING_TZ_WORKFLOWS) {
      const parsed = VerticalWorkflowDefinitionSchema.safeParse(w);
      expect(parsed.success).toBe(true);
    }
  });

  it('TRA monthly VAT cadence=monthly, due 20th of next month', () => {
    expect(TRA_VAT_MONTHLY.cadence).toBe('monthly');
    expect(TRA_VAT_MONTHLY.dueDateRule).toContain('19d');
    expect(TRA_VAT_MONTHLY.regulatorBinding[0]?.regulatorId).toBe('tz-tra');
  });

  it('Tumemadini royalty cadence=annual, references Mining Act 2010', () => {
    expect(TUMEMADINI_ANNUAL_ROYALTY.cadence).toBe('annual');
    expect(TUMEMADINI_ANNUAL_ROYALTY.regulatorBinding[0]?.regulatorId).toBe(
      'tz-tumemadini',
    );
    const titles = TUMEMADINI_ANNUAL_ROYALTY.provenance.map((c) => c.title);
    expect(titles.some((t) => t.includes('Mining Act'))).toBe(true);
  });

  it('NEMC EIA cadence=event with a 90d window', () => {
    expect(NEMC_EIA.cadence).toBe('event');
    expect(NEMC_EIA.dueDateRule).toContain('90d');
  });

  it('BoT FX quarterly cadence=quarterly with a 30d window', () => {
    expect(BOT_FX_QUARTERLY.cadence).toBe('quarterly');
    expect(BOT_FX_QUARTERLY.dueDateRule).toContain('30d');
  });

  it('OSHA-TZ safety audit cadence=annual', () => {
    expect(OSHA_TZ_SAFETY_AUDIT.cadence).toBe('annual');
    expect(OSHA_TZ_SAFETY_AUDIT.regulatorBinding[0]?.filingKind).toBe(
      'workplace-safety-audit',
    );
  });

  it('Buyer KYC verification cadence=event with a 365d refresh window + FATF citation', () => {
    expect(BUYER_KYC_VERIFICATION.cadence).toBe('event');
    expect(BUYER_KYC_VERIFICATION.dueDateRule).toContain('365d');
    const urls = BUYER_KYC_VERIFICATION.provenance.map((c) => c.url);
    expect(urls.some((u) => u.includes('fatf-gafi.org'))).toBe(true);
  });
});

describe('mining-tz bundle — registry round-trip', () => {
  it('buildMiningTzBundle returns the live profile + 6 workflows', () => {
    const bundle = buildMiningTzBundle();
    expect(bundle.profiles).toHaveLength(1);
    expect(bundle.profiles[0]?.id).toBe('mining-tz');
    expect(bundle.workflows).toHaveLength(6);
  });

  it('seeds reserved + the mining-tz live bundle into the registry', async () => {
    const reg = createInMemoryRegistry();
    const result = await loadSeedProfiles(reg, [buildMiningTzBundle()]);
    expect(result.liveRegistered).toBe(1);
    expect(result.workflowsRegistered).toBe(6);
    const live = await reg.list({ status: 'live' });
    expect(live).toHaveLength(1);
    expect(live[0]?.id).toBe('mining-tz');
  });

  it('all 4 launch regulators (TRA + Tumemadini + NEMC + BoT) appear in mining-tz workflow bindings after seeding', async () => {
    const reg = createInMemoryRegistry();
    await loadSeedProfiles(reg, [buildMiningTzBundle()]);
    const workflows = await reg.workflowsFor('mining-tz');
    const regulatorIds = new Set(
      workflows.flatMap((w) => w.regulatorBinding.map((b) => b.regulatorId)),
    );
    expect(regulatorIds.has('tz-tra')).toBe(true);
    expect(regulatorIds.has('tz-tumemadini')).toBe(true);
    expect(regulatorIds.has('tz-nemc')).toBe(true);
    expect(regulatorIds.has('tz-bot')).toBe(true);
  });

  it('seeded catalogue has ≥35 profiles (74 reserved + 1 live)', async () => {
    const reg = createInMemoryRegistry();
    await loadSeedProfiles(reg, [buildMiningTzBundle()]);
    const { profiles, workflows } = await reg.count();
    expect(profiles).toBeGreaterThanOrEqual(35);
    expect(workflows).toBe(6);
  });

  it('idempotent re-seed converges to the same totals', async () => {
    const reg = createInMemoryRegistry();
    await loadSeedProfiles(reg, [buildMiningTzBundle()]);
    await loadSeedProfiles(reg, [buildMiningTzBundle()]);
    await loadSeedProfiles(reg, [buildMiningTzBundle()]);
    const { profiles, workflows } = await reg.count();
    expect(profiles).toBeGreaterThanOrEqual(35);
    expect(workflows).toBe(6);
  });
});
