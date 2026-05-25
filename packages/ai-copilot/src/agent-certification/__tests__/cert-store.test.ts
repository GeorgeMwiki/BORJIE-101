/**
 * Tests for agent-certification/cert-store + cert-revocation cache.
 *
 * Coverage: in-memory store (insert, find, mark revoked, list, immutable
 * stores), revocation cache (TTL, refresh, invalidate, missing tenant),
 * tenant scoping.
 */

import { describe, it, expect, vi } from 'vitest';
import { InMemoryCertStore } from '../cert-store.js';
import { RevocationCache } from '../cert-revocation.js';
import type {
  AgentCertificate,
  CertRevocation,
} from '../types.js';

function cert(overrides: Partial<AgentCertificate> = {}): AgentCertificate {
  return {
    id: 'cert-1',
    agentId: 'agent-1',
    tenantId: 'tenant-1',
    scopes: ['properties.read'],
    issuer: 'platform',
    issuedAt: '2026-04-01T00:00:00.000Z',
    expiresAt: '2026-12-01T00:00:00.000Z',
    signature: 'sig',
    revoked: false,
    ...overrides,
  };
}

function revocation(overrides: Partial<CertRevocation> = {}): CertRevocation {
  return {
    id: 'rev-1',
    certId: 'cert-1',
    tenantId: 'tenant-1',
    revokedAt: '2026-04-15T00:00:00.000Z',
    revokedBy: 'user-1',
    reason: 'compromised',
    ...overrides,
  };
}

describe('InMemoryCertStore', () => {
  it('stores a certificate and finds it by id', async () => {
    const store = new InMemoryCertStore();
    await store.insert(cert());
    // nosemgrep: missing-tenant-id-arg reason: test of store's by-globally-unique-id lookup.
    const found = await store.findById('cert-1');
    expect(found?.id).toBe('cert-1');
  });

  it('returns null for an unknown cert id', async () => {
    const store = new InMemoryCertStore();
    // nosemgrep: missing-tenant-id-arg reason: test of store's by-globally-unique-id lookup (negative case).
    expect(await store.findById('missing')).toBeNull();
  });

  it('finds certs by agent + tenant pair', async () => {
    const store = new InMemoryCertStore();
    await store.insert(cert({ id: 'a', agentId: 'agentA' }));
    await store.insert(cert({ id: 'b', agentId: 'agentB' }));
    const list = await store.findByAgentAndTenant('agentA', 'tenant-1');
    expect(list.map((c) => c.id)).toEqual(['a']);
  });

  it('does NOT mutate the original cert object on insert', async () => {
    const store = new InMemoryCertStore();
    const original = cert();
    await store.insert(original);
    Object.assign(original as { id: string }, { id: 'mutated' });
    // nosemgrep: missing-tenant-id-arg reason: test of store's by-globally-unique-id lookup (immutability check).
    const stored = await store.findById('cert-1');
    expect(stored?.id).toBe('cert-1');
  });

  it('flips revoked + records revokedAt/reason on markRevoked', async () => {
    const store = new InMemoryCertStore();
    await store.insert(cert());
    await store.markRevoked('cert-1', '2026-04-15T00:00:00.000Z', 'compromised');
    // nosemgrep: missing-tenant-id-arg reason: test of store's by-globally-unique-id lookup (post-revoke verification).
    const found = await store.findById('cert-1');
    expect(found?.revoked).toBe(true);
    expect(found?.revokedAt).toBe('2026-04-15T00:00:00.000Z');
    expect(found?.revokedReason).toBe('compromised');
  });

  it('does not throw when revoking a missing cert', async () => {
    const store = new InMemoryCertStore();
    await expect(
      store.markRevoked('missing', '2026-04-15T00:00:00.000Z', 'x'),
    ).resolves.toBeUndefined();
  });

  it('lists certs for a tenant only', async () => {
    const store = new InMemoryCertStore();
    await store.insert(cert({ id: 'a', tenantId: 'tenant-1' }));
    await store.insert(cert({ id: 'b', tenantId: 'tenant-2' }));
    const list = await store.listForTenant('tenant-1');
    expect(list.map((c) => c.id)).toEqual(['a']);
  });

  it('lists revocations for a tenant only', async () => {
    const store = new InMemoryCertStore();
    await store.insertRevocation(revocation({ id: 'r1', tenantId: 'tenant-1' }));
    await store.insertRevocation(
      revocation({ id: 'r2', tenantId: 'tenant-2' }),
    );
    const list = await store.listRevocations('tenant-1');
    expect(list.map((r) => r.id)).toEqual(['r1']);
  });
});

describe('RevocationCache', () => {
  it('returns false for an empty store', async () => {
    const store = new InMemoryCertStore();
    const cache = new RevocationCache(store, 30_000);
    expect(await cache.isRevoked('tenant-1', 'cert-1')).toBe(false);
  });

  it('returns true when the cert id is in the listed revocations', async () => {
    const store = new InMemoryCertStore();
    await store.insertRevocation(revocation({ certId: 'cert-1' }));
    const cache = new RevocationCache(store, 30_000);
    expect(await cache.isRevoked('tenant-1', 'cert-1')).toBe(true);
  });

  it('caches revocations within the TTL window', async () => {
    const store = new InMemoryCertStore();
    const spy = vi.spyOn(store, 'listRevocations');
    await store.insertRevocation(revocation({ certId: 'cert-1' }));
    const cache = new RevocationCache(store, 60_000);
    await cache.isRevoked('tenant-1', 'cert-1');
    await cache.isRevoked('tenant-1', 'cert-1');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces a refresh on the next call', async () => {
    const store = new InMemoryCertStore();
    const spy = vi.spyOn(store, 'listRevocations');
    const cache = new RevocationCache(store, 60_000);
    await cache.isRevoked('tenant-1', 'cert-1');
    expect(spy).toHaveBeenCalledTimes(1);
    await cache.invalidate('tenant-1');
    await cache.isRevoked('tenant-1', 'cert-1');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not leak revocations across tenants', async () => {
    const store = new InMemoryCertStore();
    await store.insertRevocation(
      revocation({ certId: 'cert-1', tenantId: 'tenant-1' }),
    );
    const cache = new RevocationCache(store, 60_000);
    expect(await cache.isRevoked('tenant-2', 'cert-1')).toBe(false);
    expect(await cache.isRevoked('tenant-1', 'cert-1')).toBe(true);
  });
});
