/**
 * Tests for scope-predicate.ts.
 *
 * Verifies pass/fail semantics for every ScopeKind and the filter
 * renderer's projection.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateScopePredicate,
  renderScopeFilter,
} from '../scope-predicate.js';
import type { AuthorizationContext, ScopePredicate } from '../types.js';

function ctx(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    userId: 'u_1',
    tenantId: 't_abc',
    personaId: 'p_1',
    channel: 'web',
    killSwitchOpen: false,
    featureFlags: {},
    ...overrides,
  };
}

describe('evaluateScopePredicate — tenant isolation rail', () => {
  it('blocks cross-tenant access even for tenant_scope predicates', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'tenant_scope' },
      ctx: ctx({ tenantId: 't_a' }),
      target: { tenantId: 't_b' },
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('tenant-isolation');
  });

  it('permits `all` to cross tenant boundary (sovereign DP analytics)', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'all' },
      ctx: ctx({ tenantId: 't_a' }),
      target: { tenantId: 't_b' },
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe('evaluateScopePredicate — kinds', () => {
  it('tenant_scope: target tenant matches ctx tenant → allow', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'tenant_scope' },
      ctx: ctx(),
      target: { tenantId: 't_abc' },
    });
    expect(verdict.allowed).toBe(true);
  });

  it('none: always false', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'none' },
      ctx: ctx(),
      target: { tenantId: 't_abc' },
    });
    expect(verdict.allowed).toBe(false);
  });

  it('org_scope: matching orgId → allow', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'org_scope', org_id: 'o_1' },
      ctx: ctx({ orgId: 'o_1' }),
      target: { tenantId: 't_abc', orgId: 'o_1' },
    });
    expect(verdict.allowed).toBe(true);
  });

  it('org_scope: mismatched orgId → deny', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'org_scope', org_id: 'o_1' },
      ctx: ctx({ orgId: 'o_1' }),
      target: { tenantId: 't_abc', orgId: 'o_2' },
    });
    expect(verdict.allowed).toBe(false);
  });

  it('org_scope: missing both predicate.org_id and ctx.orgId → deny', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'org_scope' },
      ctx: ctx(),
      target: { tenantId: 't_abc', orgId: 'o_1' },
    });
    expect(verdict.allowed).toBe(false);
  });

  it('module_scope: matching module → allow', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'module_scope', module: 'maintenance' },
      ctx: ctx(),
      target: { tenantId: 't_abc', moduleId: 'maintenance' },
    });
    expect(verdict.allowed).toBe(true);
  });

  it('module_scope: deny on mismatch', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'module_scope', module: 'leasing' },
      ctx: ctx(),
      target: { tenantId: 't_abc', moduleId: 'maintenance' },
    });
    expect(verdict.allowed).toBe(false);
  });

  it('module_scope: missing predicate.module and ctx.moduleId → deny', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'module_scope' },
      ctx: ctx(),
      target: { tenantId: 't_abc' },
    });
    expect(verdict.allowed).toBe(false);
  });

  it('region_scope: matching region → allow', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'region_scope', region: 'north' },
      ctx: ctx(),
      target: { tenantId: 't_abc', regionId: 'north' },
    });
    expect(verdict.allowed).toBe(true);
  });

  it('region_scope: missing both predicate.region and ctx.regionId → deny', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'region_scope' },
      ctx: ctx(),
      target: { tenantId: 't_abc', regionId: 'north' },
    });
    expect(verdict.allowed).toBe(false);
  });

  it('region_scope: mismatch → deny', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'region_scope', region: 'north' },
      ctx: ctx(),
      target: { tenantId: 't_abc', regionId: 'south' },
    });
    expect(verdict.allowed).toBe(false);
  });

  it('own_records: caller owns the row → allow', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'own_records' },
      ctx: ctx({ userId: 'u_1' }),
      target: { tenantId: 't_abc', ownerUserId: 'u_1' },
    });
    expect(verdict.allowed).toBe(true);
  });

  it('own_records: someone else owns the row → deny', () => {
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'own_records' },
      ctx: ctx({ userId: 'u_1' }),
      target: { tenantId: 't_abc', ownerUserId: 'u_2' },
    });
    expect(verdict.allowed).toBe(false);
  });
});

describe('renderScopeFilter', () => {
  it('blocks on none', () => {
    const f = renderScopeFilter({
      predicate: { kind: 'none' },
      ctx: ctx(),
    });
    expect(f.block).toBe(true);
  });

  it('platformWide on all', () => {
    const f = renderScopeFilter({
      predicate: { kind: 'all' },
      ctx: ctx(),
    });
    expect(f.block).toBe(false);
    expect(f.platformWide).toBe(true);
  });

  it('tenant_scope returns tenantId', () => {
    const f = renderScopeFilter({
      predicate: { kind: 'tenant_scope' },
      ctx: ctx({ tenantId: 't_abc' }),
    });
    expect(f.tenantId).toBe('t_abc');
  });

  it('own_records returns tenantId + ownerUserId', () => {
    const f = renderScopeFilter({
      predicate: { kind: 'own_records' },
      ctx: ctx({ userId: 'u_1', tenantId: 't_abc' }),
    });
    expect(f.tenantId).toBe('t_abc');
    expect(f.ownerUserId).toBe('u_1');
  });

  it('module_scope merges predicate.module preferred over ctx', () => {
    const f = renderScopeFilter({
      predicate: { kind: 'module_scope', module: 'leasing' },
      ctx: ctx({ moduleId: 'maintenance' }),
    });
    expect(f.moduleId).toBe('leasing');
  });

  it('module_scope falls back to ctx.moduleId when predicate has none', () => {
    const f = renderScopeFilter({
      predicate: { kind: 'module_scope' },
      ctx: ctx({ moduleId: 'maintenance' }),
    });
    expect(f.moduleId).toBe('maintenance');
  });

  it('org_scope merges predicate.org_id', () => {
    const f = renderScopeFilter({
      predicate: { kind: 'org_scope', org_id: 'o_42' },
      ctx: ctx({ orgId: 'o_1' }),
    });
    expect(f.orgId).toBe('o_42');
  });

  it('region_scope', () => {
    const f = renderScopeFilter({
      predicate: { kind: 'region_scope', region: 'east' },
      ctx: ctx(),
    });
    expect(f.regionId).toBe('east');
  });
});

describe('unknown kind handling', () => {
  it('rejects an unknown kind via the default arm', () => {
    // Cast through unknown — exercise the exhaustiveness default.
    const verdict = evaluateScopePredicate({
      predicate: { kind: 'rogue' } as unknown as ScopePredicate,
      ctx: ctx(),
      target: { tenantId: 't_abc' },
    });
    expect(verdict.allowed).toBe(false);
  });

  it('renderScopeFilter blocks on unknown kind', () => {
    const f = renderScopeFilter({
      predicate: { kind: 'rogue' } as unknown as ScopePredicate,
      ctx: ctx(),
    });
    expect(f.block).toBe(true);
  });
});
