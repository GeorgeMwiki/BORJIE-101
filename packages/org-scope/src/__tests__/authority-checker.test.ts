import { describe, expect, it } from 'vitest';
import { checkAuthority } from '../scope/authority-checker.js';

describe('checkAuthority', () => {
  it('allows when tier ≥ required AND in scope', () => {
    const v = checkAuthority({
      user_tier: 2,
      required_tier: 1,
      role: 'admin',
      in_scope: true,
    });
    expect(v.allowed).toBe(true);
    expect(v.reason).toBe('allowed');
  });

  it('blocks when scope mismatched', () => {
    const v = checkAuthority({
      user_tier: 2,
      required_tier: 1,
      role: 'admin',
      in_scope: false,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('scope_mismatch');
  });

  it('blocks auditor from any write tier', () => {
    const v = checkAuthority({
      user_tier: 2,
      required_tier: 1,
      role: 'auditor',
      in_scope: true,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('role_blocked');
  });

  it('blocks manager from Tier 2', () => {
    const v = checkAuthority({
      user_tier: 2,
      required_tier: 2,
      role: 'manager',
      in_scope: true,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('role_blocked');
  });

  it('blocks Tier 2 capable role when user_tier insufficient', () => {
    const v = checkAuthority({
      user_tier: 1,
      required_tier: 2,
      role: 'admin',
      in_scope: true,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('tier_exceeded');
  });

  it('allows auditor for Tier 0 reads', () => {
    const v = checkAuthority({
      user_tier: 0,
      required_tier: 0,
      role: 'auditor',
      in_scope: true,
    });
    expect(v.allowed).toBe(true);
  });
});
