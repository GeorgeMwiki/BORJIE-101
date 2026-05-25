/**
 * Capability matrix tests.
 */

import { describe, it, expect } from 'vitest';
import { canAccess, classifySnippets } from '../data-access-guard.js';

describe('canAccess', () => {
  it('tenant can read OWN lease', () => {
    expect(canAccess({ role: 'tenant', resource: 'own-lease', scope: 'own' })).toBe('allow');
  });

  it('tenant cannot read another tenant via cross-tenant scope', () => {
    expect(canAccess({ role: 'tenant', resource: 'own-lease', scope: 'cross-tenant' })).toBe('deny');
  });

  it('tenant cannot read managed-portfolio at any scope', () => {
    expect(canAccess({ role: 'tenant', resource: 'managed-portfolio', scope: 'own' })).toBe('deny');
    expect(canAccess({ role: 'tenant', resource: 'managed-portfolio', scope: 'tenant-wide' })).toBe('deny');
  });

  it('owner can read owned-properties at own scope', () => {
    expect(canAccess({ role: 'owner', resource: 'owned-properties', scope: 'own' })).toBe('allow');
  });

  it('owner reading tenant-aggregate-no-pii gets REDACT (force aggregation)', () => {
    // Owners may see the aggregated bucket but PII must be stripped.
    // The persona's `cannotSee` also lists tenant-pii so the orchestrator
    // never accidentally surfaces named tenant rows.
    expect(canAccess({ role: 'owner', resource: 'tenant-aggregate-no-pii', scope: 'tenant-wide' })).toBe('redact');
  });

  it('owner cannot read tenant-pii outright', () => {
    expect(canAccess({ role: 'owner', resource: 'tenant-pii', scope: 'tenant-wide' })).toBe('deny');
  });

  it('PM can read managed-portfolio at tenant-wide scope', () => {
    expect(canAccess({ role: 'property-manager', resource: 'managed-portfolio', scope: 'tenant-wide' })).toBe('allow');
  });

  it('PM redacts tenant-pii (in cannotSee)', () => {
    expect(canAccess({ role: 'property-manager', resource: 'tenant-pii', scope: 'tenant-wide' })).toBe('deny');
  });

  it('prospect allowed for public-listing only', () => {
    expect(canAccess({ role: 'prospect', resource: 'public-listing', scope: 'public' })).toBe('allow');
    expect(canAccess({ role: 'prospect', resource: 'own-lease', scope: 'own' })).toBe('deny');
    expect(canAccess({ role: 'prospect', resource: 'owned-properties', scope: 'own' })).toBe('deny');
  });

  it('admin reads org-wide-financials', () => {
    expect(canAccess({ role: 'admin', resource: 'org-wide-financials', scope: 'tenant-wide' })).toBe('allow');
  });

  it('admin rejected on cross-tenant scope (no elevation flow in MVP)', () => {
    expect(canAccess({ role: 'admin', resource: 'org-wide-financials', scope: 'cross-tenant' })).toBe('deny');
  });

  it('service-provider can read assigned-jobs', () => {
    expect(canAccess({ role: 'service-provider', resource: 'assigned-jobs', scope: 'own' })).toBe('allow');
  });

  it('service-provider cannot read own-payment-history', () => {
    expect(canAccess({ role: 'service-provider', resource: 'own-payment-history', scope: 'own' })).toBe('deny');
  });

  it('public scope grants when persona lists the public resource', () => {
    expect(canAccess({ role: 'tenant', resource: 'public-market-data', scope: 'public' })).toBe('allow');
  });

  it('public scope denies when persona does not list it', () => {
    expect(canAccess({ role: 'service-provider', resource: 'public-market-data', scope: 'public' })).toBe('deny');
  });
});

describe('classifySnippets', () => {
  it('drops a snippet whose tenantId mismatches the caller', () => {
    const r = classifySnippets(
      'tenant',
      [
        { id: 's1', resource: 'own-lease', scope: 'own', tenantId: 'tnt-OTHER' },
      ],
      'tnt-ME',
    );
    expect(r.denied).toHaveLength(1);
    expect(r.allowed).toHaveLength(0);
  });

  it('routes redact-decisions into the redacted bucket', () => {
    const r = classifySnippets(
      'owner',
      [
        { id: 's1', resource: 'tenant-aggregate-no-pii', scope: 'tenant-wide', tenantId: 'tnt-ME' },
      ],
      'tnt-ME',
    );
    expect(r.redacted).toHaveLength(1);
    expect(r.allowed).toHaveLength(0);
  });

  it('allowed bucket contains pass-through snippets', () => {
    const r = classifySnippets(
      'tenant',
      [
        { id: 's1', resource: 'own-lease', scope: 'own', tenantId: 'tnt-ME', ownedByUser: true },
        { id: 's2', resource: 'public-market-data', scope: 'public', tenantId: 'tnt-ME' },
      ],
      'tnt-ME',
    );
    expect(r.allowed.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('cross-tenant snippet is denied even when role can see resource locally', () => {
    const r = classifySnippets(
      'admin',
      [
        { id: 's1', resource: 'managed-portfolio', scope: 'cross-tenant', tenantId: 'tnt-ME' },
      ],
      'tnt-ME',
    );
    expect(r.denied).toHaveLength(1);
  });
});
