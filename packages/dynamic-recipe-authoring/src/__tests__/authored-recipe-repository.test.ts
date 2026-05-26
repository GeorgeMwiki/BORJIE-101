import { describe, it, expect } from 'vitest';
import { createInMemoryAuthoredRecipeRepository } from '../repositories/authored-recipe-repository.js';

const sampleSpec = Object.freeze({
  id: 'pit-safety-kpis-by-shift',
  brand: 'borjie',
}) as Readonly<Record<string, unknown>>;

describe('authored-recipe-repository (in-memory)', () => {
  it('inserts a draft row, hashes against the genesis prev_hash for the first row', async () => {
    const repo = createInMemoryAuthoredRecipeRepository();
    const inserted = await repo.insert({
      tenantId: 't1',
      kind: 'tab',
      name: 'pit-safety-kpis-by-shift',
      version: '0.1.0',
      spec: sampleSpec,
      authoredBy: 'mr-mwikila',
    });
    expect(inserted.lifecycleState).toBe('draft');
    expect(inserted.auditHash.length).toBeGreaterThan(0);
    expect(inserted.prevHash.length).toBeGreaterThan(0);
  });

  it('chains subsequent inserts (row N+1.prev_hash === row N.audit_hash)', async () => {
    const repo = createInMemoryAuthoredRecipeRepository();
    const first = await repo.insert({
      tenantId: 't1',
      kind: 'tab',
      name: 'first',
      version: '0.1.0',
      spec: sampleSpec,
      authoredBy: 'mr-mwikila',
    });
    const second = await repo.insert({
      tenantId: 't1',
      kind: 'doc',
      name: 'second',
      version: '0.1.0',
      spec: sampleSpec,
      authoredBy: 'mr-mwikila',
    });
    expect(second.prevHash).toBe(first.auditHash);
  });

  it('rejects duplicates on (tenant, kind, name, version)', async () => {
    const repo = createInMemoryAuthoredRecipeRepository();
    await repo.insert({
      tenantId: 't1',
      kind: 'tab',
      name: 'duplicate',
      version: '0.1.0',
      spec: sampleSpec,
      authoredBy: 'mr-mwikila',
    });
    await expect(
      repo.insert({
        tenantId: 't1',
        kind: 'tab',
        name: 'duplicate',
        version: '0.1.0',
        spec: sampleSpec,
        authoredBy: 'mr-mwikila',
      }),
    ).rejects.toThrow(/duplicate authored recipe/);
  });

  it('findById returns null across tenant boundaries', async () => {
    const repo = createInMemoryAuthoredRecipeRepository();
    const inserted = await repo.insert({
      tenantId: 't1',
      kind: 'tab',
      name: 'private',
      version: '0.1.0',
      spec: sampleSpec,
      authoredBy: 'mr-mwikila',
    });
    expect(await repo.findById('t1', inserted.id)).not.toBeNull();
    expect(await repo.findById('t2', inserted.id)).toBeNull();
  });

  it('transitionLifecycle advances draft → shadow → live', async () => {
    const repo = createInMemoryAuthoredRecipeRepository();
    const inserted = await repo.insert({
      tenantId: 't1',
      kind: 'tab',
      name: 'lifecycle-flow',
      version: '0.1.0',
      spec: sampleSpec,
      authoredBy: 'mr-mwikila',
    });
    const shadow = await repo.transitionLifecycle('t1', inserted.id, 'shadow');
    expect(shadow.lifecycleState).toBe('shadow');
    const live = await repo.transitionLifecycle('t1', inserted.id, 'live');
    expect(live.lifecycleState).toBe('live');
  });

  it('transitionLifecycle refuses invalid transitions (e.g. draft → live)', async () => {
    const repo = createInMemoryAuthoredRecipeRepository();
    const inserted = await repo.insert({
      tenantId: 't1',
      kind: 'tab',
      name: 'reject-skip',
      version: '0.1.0',
      spec: sampleSpec,
      authoredBy: 'mr-mwikila',
    });
    await expect(
      repo.transitionLifecycle('t1', inserted.id, 'live'),
    ).rejects.toThrow(/not allowed/);
  });

  it('listForTenant filters by kind + lifecycle and orders newest first', async () => {
    let nowMs = 1_700_000_000_000;
    const repo = createInMemoryAuthoredRecipeRepository({
      now: () => new Date(nowMs),
    });
    await repo.insert({
      tenantId: 't1',
      kind: 'tab',
      name: 'a',
      version: '0.1.0',
      spec: sampleSpec,
      authoredBy: 'mr-mwikila',
    });
    nowMs += 1000;
    await repo.insert({
      tenantId: 't1',
      kind: 'doc',
      name: 'b',
      version: '0.1.0',
      spec: sampleSpec,
      authoredBy: 'mr-mwikila',
    });
    nowMs += 1000;
    await repo.insert({
      tenantId: 't1',
      kind: 'tab',
      name: 'c',
      version: '0.1.0',
      spec: sampleSpec,
      authoredBy: 'mr-mwikila',
    });

    const allTabs = await repo.listForTenant('t1', { kind: 'tab' });
    expect(allTabs.map((r) => r.name)).toEqual(['c', 'a']);

    const draftTabs = await repo.listForTenant('t1', {
      kind: 'tab',
      lifecycleState: 'draft',
    });
    expect(draftTabs).toHaveLength(2);

    const liveTabs = await repo.listForTenant('t1', {
      kind: 'tab',
      lifecycleState: 'live',
    });
    expect(liveTabs).toHaveLength(0);
  });
});
