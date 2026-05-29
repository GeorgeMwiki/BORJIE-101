/**
 * Tab config validator (CT-4) — guards against brain hallucinations.
 */

import { describe, expect, it } from 'vitest';

import { validateTabConfig } from '../config-validator';

describe('validateTabConfig', () => {
  it('accepts a valid finance config with known keys', () => {
    const r = validateTabConfig('finance', {
      mineralKind: 'gold',
      window: 'quarter',
      groupBy: 'region',
      since: '2026-01-01',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config).toEqual({
        mineralKind: 'gold',
        window: 'quarter',
        groupBy: 'region',
        since: '2026-01-01',
      });
      expect(r.droppedKeys).toHaveLength(0);
    }
  });

  it('drops unknown keys + reports them', () => {
    const r = validateTabConfig('finance', {
      mineralKind: 'gold',
      hallucinatedKey: 'oops',
      anotherBadOne: 42,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config).toEqual({ mineralKind: 'gold' });
      expect(r.droppedKeys.sort()).toEqual(['anotherBadOne', 'hallucinatedKey']);
    }
  });

  it('rejects an unknown tab type', () => {
    const r = validateTabConfig('rocket-science', { focus: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasonEn).toContain('Unknown tab type');
      expect(r.reasonSw).toContain('haijulikani');
    }
  });

  it('rejects an oversized config blob', () => {
    const huge = { focus: 'x'.repeat(5000) };
    const r = validateTabConfig('finance', huge);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasonEn).toContain('exceeds');
    }
  });

  it('rejects array-as-config', () => {
    const r = validateTabConfig('finance', ['a', 'b']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasonEn).toContain('JSON object');
    }
  });

  it('uses the default permissive schema for uncurated types', () => {
    const r = validateTabConfig('chat', { random: 'value', count: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config).toEqual({ random: 'value', count: 5 });
    }
  });

  it('rejects type mismatches on known keys (mineralKind=platinum)', () => {
    const r = validateTabConfig('compliance', { regulator: 'mining_commission' });
    expect(r.ok).toBe(true);
    const r2 = validateTabConfig('finance', { mineralKind: 'platinum' });
    // Strict enum — platinum not in enum. Salvage strips the bad key.
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.droppedKeys).toContain('mineralKind');
      expect(r2.config.mineralKind).toBeUndefined();
    }
  });
});
