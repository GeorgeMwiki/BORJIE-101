/**
 * Tests for routing-overrides: schema, in-memory adapter, repository.
 */

import { describe, expect, it } from 'vitest';
import {
  InMemoryOverrideAdapter,
  LOCKED_CATEGORIES,
  RoutingOverrideRepository,
  routingOverrideEntrySchema,
  routingOverridePatchSchema,
} from '../index.js';

describe('routingOverridePatchSchema.parse', () => {
  it('accepts a valid patch', () => {
    const r = routingOverridePatchSchema.parse({
      tenantId: 't1',
      taskCategory: 'rent_calculation',
      family: 'sonnet',
      reason: 'Anthropic outage',
    });
    expect(r.success).toBe(true);
    expect(r.data?.family).toBe('sonnet');
  });

  it('rejects unknown family', () => {
    const r = routingOverridePatchSchema.parse({
      tenantId: 't1',
      taskCategory: 'rent_calculation',
      family: 'made-up-family',
      reason: 'x',
    });
    expect(r.success).toBe(false);
    expect(r.issues?.join(' ')).toContain('family');
  });

  it('rejects locked category', () => {
    const r = routingOverridePatchSchema.parse({
      tenantId: 't1',
      taskCategory: 'lease_drafting',
      family: 'sonnet',
      reason: 'x',
    });
    expect(r.success).toBe(false);
    expect(r.issues?.join(' ')).toContain('locked');
  });

  it('rejects empty tenantId', () => {
    const r = routingOverridePatchSchema.parse({
      tenantId: '',
      taskCategory: 'rent_calculation',
      family: 'sonnet',
      reason: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-object', () => {
    const r = routingOverridePatchSchema.parse('not an object');
    expect(r.success).toBe(false);
  });
});

describe('routingOverrideEntrySchema.parse', () => {
  it('accepts a valid entry with createdAtMs', () => {
    const r = routingOverrideEntrySchema.parse({
      tenantId: 't1',
      taskCategory: 'rent_calculation',
      family: 'sonnet',
      reason: 'x',
      createdAtMs: Date.now(),
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing createdAtMs', () => {
    const r = routingOverrideEntrySchema.parse({
      tenantId: 't1',
      taskCategory: 'rent_calculation',
      family: 'sonnet',
      reason: 'x',
    });
    expect(r.success).toBe(false);
  });
});

describe('LOCKED_CATEGORIES', () => {
  it('contains the legal/safety-significant categories', () => {
    expect(LOCKED_CATEGORIES.has('lease_drafting')).toBe(true);
    expect(LOCKED_CATEGORIES.has('eviction_notice')).toBe(true);
    expect(LOCKED_CATEGORIES.has('financial_advice')).toBe(true);
    expect(LOCKED_CATEGORIES.has('legal_review')).toBe(true);
  });

  it('contains the capability-pinned categories', () => {
    expect(LOCKED_CATEGORIES.has('voice_transcribe')).toBe(true);
    expect(LOCKED_CATEGORIES.has('image_generation')).toBe(true);
  });
});

describe('InMemoryOverrideAdapter', () => {
  it('upsert + listForTenant roundtrip', async () => {
    const a = new InMemoryOverrideAdapter();
    await a.upsert({
      tenantId: 't1',
      taskCategory: 'rent_calculation',
      family: 'sonnet',
      reason: 'x',
      createdAtMs: 100,
    });
    const list = await a.listForTenant('t1');
    expect(list).toHaveLength(1);
    expect(list[0]?.family).toBe('sonnet');
  });

  it('filters by tenantId', async () => {
    const a = new InMemoryOverrideAdapter();
    await a.upsert({
      tenantId: 't1',
      taskCategory: 'a',
      family: 'sonnet',
      reason: 'x',
      createdAtMs: 100,
    });
    await a.upsert({
      tenantId: 't2',
      taskCategory: 'a',
      family: 'opus',
      reason: 'x',
      createdAtMs: 100,
    });
    expect(await a.listForTenant('t1')).toHaveLength(1);
    expect(await a.listForTenant('t2')).toHaveLength(1);
  });

  it('delete returns true iff existed', async () => {
    const a = new InMemoryOverrideAdapter();
    await a.upsert({
      tenantId: 't1',
      taskCategory: 'a',
      family: 'sonnet',
      reason: 'x',
      createdAtMs: 100,
    });
    expect(await a.delete('t1', 'a')).toBe(true);
    expect(await a.delete('t1', 'a')).toBe(false);
  });
});

describe('RoutingOverrideRepository', () => {
  it('warm + getOverrideFor', async () => {
    const a = new InMemoryOverrideAdapter();
    const repo = new RoutingOverrideRepository(a);
    await a.upsert({
      tenantId: 't1',
      taskCategory: 'rent_calculation',
      family: 'sonnet',
      reason: 'x',
      createdAtMs: 100,
    });
    expect(repo.getOverrideFor('t1', 'rent_calculation')).toBeNull();
    await repo.warm('t1');
    const out = repo.getOverrideFor('t1', 'rent_calculation');
    expect(out?.family).toBe('sonnet');
  });

  it('returns null for unknown category', async () => {
    const a = new InMemoryOverrideAdapter();
    const repo = new RoutingOverrideRepository(a);
    await repo.warm('t1');
    expect(repo.getOverrideFor('t1', 'something_unset')).toBeNull();
  });

  it('returns null for locked category even if injected directly', async () => {
    const a = new InMemoryOverrideAdapter();
    // Inject directly to bypass schema (simulating bad DB row)
    await a.upsert({
      tenantId: 't1',
      taskCategory: 'lease_drafting',
      family: 'haiku',
      reason: 'bad',
      createdAtMs: 100,
    });
    const repo = new RoutingOverrideRepository(a);
    await repo.warm('t1');
    expect(repo.getOverrideFor('t1', 'lease_drafting')).toBeNull();
  });

  it('upsert invalidates cache', async () => {
    const a = new InMemoryOverrideAdapter();
    const repo = new RoutingOverrideRepository(a);
    await repo.warm('t1');
    await repo.upsert({
      tenantId: 't1',
      taskCategory: 'rent_calculation',
      family: 'opus',
      reason: 'x',
    });
    // Cache is invalidated — needs re-warm
    expect(repo.getOverrideFor('t1', 'rent_calculation')).toBeNull();
    await repo.warm('t1');
    expect(repo.getOverrideFor('t1', 'rent_calculation')?.family).toBe('opus');
  });

  it('upsert throws on locked category', async () => {
    const a = new InMemoryOverrideAdapter();
    const repo = new RoutingOverrideRepository(a);
    await expect(
      repo.upsert({
        tenantId: 't1',
        taskCategory: 'lease_drafting',
        family: 'haiku',
        reason: 'x',
      }),
    ).rejects.toThrow(/locked/);
  });

  it('remove invalidates cache', async () => {
    const a = new InMemoryOverrideAdapter();
    const repo = new RoutingOverrideRepository(a);
    await repo.upsert({
      tenantId: 't1',
      taskCategory: 'rent_calculation',
      family: 'sonnet',
      reason: 'x',
    });
    await repo.warm('t1');
    expect(repo.getOverrideFor('t1', 'rent_calculation')).not.toBeNull();
    expect(await repo.remove('t1', 'rent_calculation')).toBe(true);
    expect(repo.getOverrideFor('t1', 'rent_calculation')).toBeNull();
  });

  it('warm dedupes concurrent calls', async () => {
    let calls = 0;
    const fakeAdapter = {
      async listForTenant() {
        calls += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        return [];
      },
      async upsert() {},
      async delete() {
        return false;
      },
    };
    const repo = new RoutingOverrideRepository(fakeAdapter);
    await Promise.all([repo.warm('t1'), repo.warm('t1'), repo.warm('t1')]);
    expect(calls).toBe(1);
  });
});
