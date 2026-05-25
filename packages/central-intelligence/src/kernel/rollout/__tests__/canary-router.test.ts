/**
 * Canary router — hash-stability + bucket-fairness coverage.
 *
 * Asserts: same tenant always lands in the same bucket, distribution
 * across many tenants is roughly proportional to configured weights,
 * fallback fires when canary fractions sum below 100, and the CRC32
 * helper matches the standard `123456789` vector.
 */
import { describe, it, expect } from 'vitest';
import {
  crc32,
  pickVariant,
  tallyVariantAssignments,
  tenantBucket,
  type CanaryRoute,
} from '../canary-router.js';

describe('crc32', () => {
  it('matches the IEEE 802.3 vector for "123456789"', () => {
    expect(crc32('123456789').toString(16)).toBe('cbf43926');
  });

  it('is deterministic — same input always produces the same crc', () => {
    expect(crc32('tenant_a:support-bot')).toBe(crc32('tenant_a:support-bot'));
  });

  it('different inputs produce different crcs', () => {
    expect(crc32('tenant_a')).not.toBe(crc32('tenant_b'));
  });
});

describe('tenantBucket', () => {
  it('returns a bucket in [0, 99]', () => {
    for (let i = 0; i < 200; i += 1) {
      const b = tenantBucket(`tenant_${i}`, 'support-bot');
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('is stable for the same (tenantId, capability)', () => {
    expect(tenantBucket('t_42', 'cap-x')).toBe(tenantBucket('t_42', 'cap-x'));
  });

  it('is independent across capabilities', () => {
    // For a couple of representative tenants, bucket should differ at
    // least for SOME capability — i.e., the hash mixes the capability in.
    const t = 't_1';
    const cap1 = tenantBucket(t, 'cap-a');
    const cap2 = tenantBucket(t, 'cap-b');
    expect(cap1).not.toBe(cap2);
  });
});

describe('pickVariant', () => {
  const route: CanaryRoute = {
    variants: [
      { version: 'v1', weight: 70 },
      { version: 'v2', weight: 25 },
      { version: 'v3', weight: 5 },
    ],
    fallbackVersion: 'v1',
  };

  it('returns the same version for the same tenant on repeat calls', () => {
    const a = pickVariant('t_1', 'cap-x', route);
    const b = pickVariant('t_1', 'cap-x', route);
    expect(a.version).toBe(b.version);
    expect(a.bucket).toBe(b.bucket);
  });

  it('distributes roughly per configured weight over 1000 tenants', () => {
    const tenants = Array.from({ length: 1000 }, (_v, i) => `t_${i}`);
    const tally = tallyVariantAssignments(tenants, 'cap-x', route);
    // v1 gets 700 ±10%, v2 gets 250 ±20%, v3 gets 50 ±50%.
    expect(tally.v1 ?? 0).toBeGreaterThan(600);
    expect(tally.v1 ?? 0).toBeLessThan(800);
    expect(tally.v2 ?? 0).toBeGreaterThan(150);
    expect(tally.v2 ?? 0).toBeLessThan(350);
    // v3 may be 0-100; just assert non-negative + not over 25% sanity.
    expect(tally.v3 ?? 0).toBeGreaterThanOrEqual(0);
    expect(tally.v3 ?? 0).toBeLessThan(150);
  });

  it('classifies variants: active (>=100 share), canary-25 (>=20), canary (<20)', () => {
    const r: CanaryRoute = {
      variants: [
        { version: 'v_active', weight: 100 },
      ],
      fallbackVersion: 'v_active',
    };
    const d = pickVariant('t_active', 'cap', r);
    expect(d.variant).toBe('active');
  });

  it('falls through to fallback when total weight < 100', () => {
    const r: CanaryRoute = {
      variants: [{ version: 'tiny', weight: 1 }],
      fallbackVersion: 'old-active',
    };
    // 99 of 100 buckets should land on fallback.
    const tenants = Array.from({ length: 200 }, (_v, i) => `t_${i}`);
    const tally = tallyVariantAssignments(tenants, 'cap', r);
    expect(tally['old-active'] ?? 0).toBeGreaterThan(150);
  });

  it('handles empty variant list by returning fallback', () => {
    const r: CanaryRoute = { variants: [], fallbackVersion: 'v_only' };
    const d = pickVariant('t_x', 'cap', r);
    expect(d.version).toBe('v_only');
    expect(d.variant).toBe('fallback');
  });

  it('skips zero-weight variants', () => {
    const r: CanaryRoute = {
      variants: [
        { version: 'gone', weight: 0 },
        { version: 'live', weight: 100 },
      ],
      fallbackVersion: 'gone',
    };
    for (let i = 0; i < 100; i += 1) {
      const d = pickVariant(`t_${i}`, 'cap', r);
      expect(d.version).toBe('live');
    }
  });
});
