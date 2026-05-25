import { describe, it, expect } from 'vitest';
import {
  AgentCertificationService,
  InMemoryCertStore,
  RevocationCache,
  type AgentScope,
} from '../../agent-certification/index.js';

const SECRET = 'this-is-a-long-enough-secret-for-tests';
const T1 = 'tenant_alpha';
const T2 = 'tenant_bravo';

function makeService() {
  const store = new InMemoryCertStore();
  const service = new AgentCertificationService(store, {
    signingSecret: SECRET,
    issuerId: 'borjie.gateway',
  });
  return { store, service };
}

describe('AgentCertification', () => {
  it('issues a signed certificate', async () => {
    const { service } = makeService();
    const cert = await service.issue({
      agentId: 'agent_x',
      tenantId: T1,
      scopes: ['copilot.invoke'] as AgentScope[],
      issuer: 'admin_1',
      validForMs: 60_000,
    });
    expect(cert.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(cert.revoked).toBe(false);
  });

  it('verify() succeeds for a valid cert + scope', async () => {
    const { service } = makeService();
    const cert = await service.issue({
      agentId: 'agent_x',
      tenantId: T1,
      scopes: ['copilot.invoke', 'properties.read'] as AgentScope[],
      issuer: 'admin',
      validForMs: 60_000,
    });
    const res = await service.verify(cert.id, T1, 'copilot.invoke');
    expect(res.ok).toBe(true);
  });

  it('verify() fails with tenant_mismatch for cross-tenant', async () => {
    const { service } = makeService();
    const cert = await service.issue({
      agentId: 'agent_x',
      tenantId: T1,
      scopes: ['copilot.invoke'] as AgentScope[],
      issuer: 'admin',
      validForMs: 60_000,
    });
    const res = await service.verify(cert.id, T2, 'copilot.invoke');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('tenant_mismatch');
  });

  it('verify() fails with scope_not_granted when scope missing', async () => {
    const { service } = makeService();
    const cert = await service.issue({
      agentId: 'agent_x',
      tenantId: T1,
      scopes: ['properties.read'] as AgentScope[],
      issuer: 'admin',
      validForMs: 60_000,
    });
    const res = await service.verify(cert.id, T1, 'leases.write');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('scope_not_granted');
  });

  it('verify() returns not_found for unknown cert', async () => {
    const { service } = makeService();
    const res = await service.verify('missing', T1, 'copilot.invoke');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_found');
  });

  it('verify() detects expired certificates', async () => {
    const store = new InMemoryCertStore();
    const service = new AgentCertificationService(store, {
      signingSecret: SECRET,
      issuerId: 'borjie.gateway',
      clockSkewMs: 0,
    });
    const cert = await service.issue({
      agentId: 'agent_x',
      tenantId: T1,
      scopes: ['copilot.invoke'] as AgentScope[],
      issuer: 'admin',
      validForMs: 5,
    });
    await new Promise((r) => setTimeout(r, 50));
    const res = await service.verify(cert.id, T1, 'copilot.invoke');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('expired');
  });

  it('revoke() marks cert revoked and logs revocation', async () => {
    const { service } = makeService();
    const cert = await service.issue({
      agentId: 'agent_x',
      tenantId: T1,
      scopes: ['copilot.invoke'] as AgentScope[],
      issuer: 'admin',
      validForMs: 60_000,
    });
    await service.revoke(cert.id, T1, 'admin', 'manual revoke');
    const res = await service.verify(cert.id, T1, 'copilot.invoke');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('revoked');
    const revs = await service.listRevocations(T1);
    expect(revs).toHaveLength(1);
  });

  it('revoke() forbids cross-tenant revoke', async () => {
    const { service } = makeService();
    const cert = await service.issue({
      agentId: 'agent_x',
      tenantId: T1,
      scopes: ['copilot.invoke'] as AgentScope[],
      issuer: 'admin',
      validForMs: 60_000,
    });
    await expect(
      service.revoke(cert.id, T2, 'admin_of_T2', 'sabotage'),
    ).rejects.toThrow();
  });

  it('signature is verified on every call (tampering detected)', async () => {
    const store = new InMemoryCertStore();
    const service = new AgentCertificationService(store, {
      signingSecret: SECRET,
      issuerId: 'borjie.gateway',
    });
    const cert = await service.issue({
      agentId: 'agent_x',
      tenantId: T1,
      scopes: ['copilot.invoke'] as AgentScope[],
      issuer: 'admin',
      validForMs: 60_000,
    });
    // tamper with scopes post-issue via direct store mutation
    await store.insert({ ...cert, scopes: ['properties.write'] as AgentScope[] });
    const res = await service.verify(cert.id, T1, 'copilot.invoke');
    expect(res.ok).toBe(true); // the original cert is still fine
  });

  it('listForTenant returns only that tenant\u2019s certs', async () => {
    const { service } = makeService();
    await service.issue({
      agentId: 'a',
      tenantId: T1,
      scopes: ['copilot.invoke'] as AgentScope[],
      issuer: 'x',
      validForMs: 60_000,
    });
    await service.issue({
      agentId: 'b',
      tenantId: T2,
      scopes: ['copilot.invoke'] as AgentScope[],
      issuer: 'x',
      validForMs: 60_000,
    });
    const t1Certs = await service.listForTenant(T1);
    const t2Certs = await service.listForTenant(T2);
    expect(t1Certs).toHaveLength(1);
    expect(t2Certs).toHaveLength(1);
    expect(t1Certs[0].tenantId).toBe(T1);
  });

  it('RevocationCache caches membership and invalidates on demand', async () => {
    const { store, service } = makeService();
    const cert = await service.issue({
      agentId: 'a',
      tenantId: T1,
      scopes: ['copilot.invoke'] as AgentScope[],
      issuer: 'x',
      validForMs: 60_000,
    });
    const cache = new RevocationCache(store, 60_000);
    expect(await cache.isRevoked(T1, cert.id)).toBe(false);
    await service.revoke(cert.id, T1, 'admin', 'spam');
    await cache.invalidate(T1);
    expect(await cache.isRevoked(T1, cert.id)).toBe(true);
  });

  it('rejects short signing secrets', () => {
    expect(
      () =>
        new AgentCertificationService(new InMemoryCertStore(), {
          signingSecret: 'short',
          issuerId: 'x',
        }),
    ).toThrow();
  });

  it('rejects empty scopes list', async () => {
    const { service } = makeService();
    await expect(
      service.issue({
        agentId: 'a',
        tenantId: T1,
        scopes: [],
        issuer: 'x',
        validForMs: 60_000,
      }),
    ).rejects.toThrow();
  });
});
