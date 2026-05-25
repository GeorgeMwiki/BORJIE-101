/**
 * Canonical resolver tests — name match, fuzzy match, tenant isolation.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemoryCanonicalResolver,
  levenshteinAtMost,
} from '../canonical-resolver.js';

describe('createInMemoryCanonicalResolver', () => {
  it('exact name match returns 0.95 confidence', async () => {
    const { store, resolver } = createInMemoryCanonicalResolver();
    store.add({
      tenant_id: 't1',
      type: 'customer',
      canonical_id: 'cust_juma_1',
      canonical_name: 'Juma',
    });
    const r = await resolver({
      tenant_id: 't1',
      raw_type: 'customer',
      raw_value: 'Juma',
    });
    expect(r).not.toBeNull();
    expect(r?.canonical_id).toBe('cust_juma_1');
    expect(r?.confidence).toBe(0.95);
    expect(r?.source).toBe('exact_name');
  });

  it('alias match also returns 0.95', async () => {
    const { store, resolver } = createInMemoryCanonicalResolver();
    store.add({
      tenant_id: 't1',
      type: 'customer',
      canonical_id: 'cust_juma_1',
      canonical_name: 'Juma Mwakipesile',
      aliases: ['Juma', 'JM'],
    });
    const r = await resolver({
      tenant_id: 't1',
      raw_type: 'customer',
      raw_value: 'Juma',
    });
    expect(r?.canonical_id).toBe('cust_juma_1');
    expect(r?.confidence).toBe(0.95);
  });

  it('substring match returns 0.75', async () => {
    const { store, resolver } = createInMemoryCanonicalResolver();
    store.add({
      tenant_id: 't1',
      type: 'unit',
      canonical_id: 'u_godown_3',
      canonical_name: 'godown 3',
    });
    const r = await resolver({
      tenant_id: 't1',
      raw_type: 'unit',
      raw_value: 'godown',
    });
    expect(r?.canonical_id).toBe('u_godown_3');
    expect(r?.confidence).toBe(0.75);
  });

  it('fuzzy levenshtein match returns 0.6', async () => {
    const { store, resolver } = createInMemoryCanonicalResolver();
    store.add({
      tenant_id: 't1',
      type: 'customer',
      canonical_id: 'cust_kileo_1',
      canonical_name: 'Kileo',
    });
    const r = await resolver({
      tenant_id: 't1',
      raw_type: 'customer',
      raw_value: 'Kelio', // 2 swaps away
    });
    expect(r?.canonical_id).toBe('cust_kileo_1');
    expect(r?.confidence).toBe(0.6);
  });

  it('returns null for unresolved entities (no hallucination)', async () => {
    const { resolver } = createInMemoryCanonicalResolver();
    const r = await resolver({
      tenant_id: 't1',
      raw_type: 'customer',
      raw_value: 'Mr Nobody',
    });
    expect(r).toBeNull();
  });

  it('tenant isolation — t2 cannot see t1 entities', async () => {
    const { store, resolver } = createInMemoryCanonicalResolver();
    store.add({
      tenant_id: 't1',
      type: 'customer',
      canonical_id: 'cust_juma_1',
      canonical_name: 'Juma',
    });
    const r = await resolver({
      tenant_id: 't2',
      raw_type: 'customer',
      raw_value: 'Juma',
    });
    expect(r).toBeNull();
  });

  it('maps raw types tenant_name → customer', async () => {
    const { store, resolver } = createInMemoryCanonicalResolver();
    store.add({
      tenant_id: 't1',
      type: 'customer',
      canonical_id: 'cust_juma_1',
      canonical_name: 'Juma',
    });
    const r = await resolver({
      tenant_id: 't1',
      raw_type: 'tenant_name',
      raw_value: 'Juma',
    });
    expect(r?.type).toBe('customer');
    expect(r?.canonical_id).toBe('cust_juma_1');
  });

  it('maps unit_id → unit', async () => {
    const { store, resolver } = createInMemoryCanonicalResolver();
    store.add({
      tenant_id: 't1',
      type: 'unit',
      canonical_id: 'u_godown_3',
      canonical_name: 'godown 3',
    });
    const r = await resolver({
      tenant_id: 't1',
      raw_type: 'unit_id',
      raw_value: 'godown 3',
    });
    expect(r?.type).toBe('unit');
  });
});

describe('levenshteinAtMost', () => {
  it('returns true for equal strings', () => {
    expect(levenshteinAtMost('abc', 'abc', 0)).toBe(true);
  });

  it('returns false for length diff > maxDist', () => {
    expect(levenshteinAtMost('abc', 'abcdefg', 2)).toBe(false);
  });

  it('returns true within max distance', () => {
    expect(levenshteinAtMost('kileo', 'kelio', 2)).toBe(true);
  });

  it('returns false beyond max distance', () => {
    expect(levenshteinAtMost('foo', 'xyz', 2)).toBe(false);
  });
});
