import { describe, it, expect } from 'vitest';
import {
  canTransition,
  requiresOwnerSign,
} from '../lifecycle/tool-lifecycle.js';

describe('tool-lifecycle', () => {
  it('allows draft → staged → live for T1 tools without owner-sign', () => {
    expect(
      canTransition({
        from: 'draft',
        to: 'staged',
        authorityTier: 'T1',
      }).ok,
    ).toBe(true);
    expect(
      canTransition({
        from: 'staged',
        to: 'live',
        authorityTier: 'T1',
      }).ok,
    ).toBe(true);
    expect(
      canTransition({
        from: 'live',
        to: 'archived',
        authorityTier: 'T1',
      }).ok,
    ).toBe(true);
  });

  it('rejects T2 staged → live without an owner-sign', () => {
    const result = canTransition({
      from: 'staged',
      to: 'live',
      authorityTier: 'T2',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('ownerSign');
    }
  });

  it('accepts T2 staged → live when an owner-sign is supplied', () => {
    const result = canTransition({
      from: 'staged',
      to: 'live',
      authorityTier: 'T2',
      ownerSign: 'mr-mwikila-owner-jwt-v1',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects transitions out of archived (terminal)', () => {
    const r = canTransition({
      from: 'archived',
      to: 'live',
      authorityTier: 'T1',
    });
    expect(r.ok).toBe(false);
  });

  it('requiresOwnerSign returns true only for T2 staged → live', () => {
    expect(requiresOwnerSign('staged', 'live', 'T2')).toBe(true);
    expect(requiresOwnerSign('staged', 'live', 'T1')).toBe(false);
    expect(requiresOwnerSign('draft', 'staged', 'T2')).toBe(false);
  });
});
