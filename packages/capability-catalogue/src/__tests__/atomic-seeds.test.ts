import { describe, it, expect } from 'vitest';

import {
  ATOMIC_CAPABILITY_SEEDS,
  createInMemoryCapabilityRegistry,
  registerAtomicCapabilities,
  SEED_TENANT_ID,
} from '../index.js';

describe('atomic capability seeds', () => {
  it('declares exactly five atomic capabilities', () => {
    expect(ATOMIC_CAPABILITY_SEEDS).toHaveLength(5);
    const names = ATOMIC_CAPABILITY_SEEDS.map((s) => s.name).sort();
    expect(names).toEqual([
      'compose_campaign_v1',
      'compose_doc_v1',
      'compose_media_v1',
      'compose_tab_v1',
      'research_v1',
    ]);
  });

  it('every seed is kind=atomic, provenance=seed, tenant=__seed__', () => {
    for (const s of ATOMIC_CAPABILITY_SEEDS) {
      expect(s.kind).toBe('atomic');
      expect(s.provenanceClass).toBe('seed');
      expect(s.tenantId).toBe(SEED_TENANT_ID);
      expect(s.dependencies).toEqual([]);
      expect(s.contract.latencyBudgetMs).toBeGreaterThan(0);
    }
  });

  it('registers all five into a registry idempotently', async () => {
    const reg = createInMemoryCapabilityRegistry();
    const r1 = await registerAtomicCapabilities(reg);
    expect(r1).toHaveLength(5);

    const r2 = await registerAtomicCapabilities(reg);
    expect(r2).toHaveLength(5);
    expect(r2.map((r) => r.id).sort()).toEqual(r1.map((r) => r.id).sort());
  });
});
