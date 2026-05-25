import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ApprovalGrantService,
  InMemoryApprovalGrantRepository,
} from '../service.js';
import type {
  ApprovalGrantEvent,
  ApprovalGrantEventPublisher,
} from '../types.js';

const TENANT = 'tenant_grants_1';
const OTHER_TENANT = 'tenant_grants_2';
const HEAD = 'user_head_1';

function makeService(clockFn?: () => Date): {
  svc: ApprovalGrantService;
  repo: InMemoryApprovalGrantRepository;
  events: ApprovalGrantEvent[];
} {
  const repo = new InMemoryApprovalGrantRepository();
  const events: ApprovalGrantEvent[] = [];
  const publisher: ApprovalGrantEventPublisher = {
    publish: (e) => {
      events.push(e);
    },
  };
  const svc = new ApprovalGrantService({
    repository: repo,
    eventPublisher: publisher,
    clock: clockFn,
  });
  return { svc, repo, events };
}

describe('ApprovalGrantService — issuance', () => {
  it('grantStanding creates a standing grant with usedCount=0 and emits ApprovalGrantIssued', async () => {
    const { svc, events } = makeService();
    const grant = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'send_rent_reminder',
      scope: { amountCeilingMinorUnits: 500_000 },
      createdBy: HEAD,
    });
    expect(grant.kind).toBe('standing_authorization');
    expect(grant.usedCount).toBe(0);
    expect(grant.tenantId).toBe(TENANT);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('ApprovalGrantIssued');
  });

  it('grantSingle creates a single-action grant with maxUses=1', async () => {
    const { svc } = makeService();
    const grant = await svc.grantSingle(TENANT, {
      domain: 'finance',
      actionCategory: 'execute_disbursement',
      scope: {
        targetEntityType: 'invoice',
        targetEntityId: 'inv_123',
        amountMinorUnits: 250_000,
      },
      createdBy: HEAD,
    });
    expect(grant.kind).toBe('single_action');
    expect(grant.maxUses).toBe(1);
    expect(grant.usedCount).toBe(0);
  });

  it('rejects duplicate pending single_action for same target', async () => {
    const { svc } = makeService();
    const input = {
      domain: 'finance' as const,
      actionCategory: 'execute_disbursement',
      scope: { targetEntityType: 'invoice', targetEntityId: 'inv_dup' },
      createdBy: HEAD,
    };
    await svc.grantSingle(TENANT, input);
    await expect(svc.grantSingle(TENANT, input)).rejects.toThrow(/pending/i);
  });

  it('rejects invalid validFrom/validTo ordering', async () => {
    const { svc } = makeService();
    await expect(
      svc.grantStanding(TENANT, {
        domain: 'finance',
        actionCategory: 'x',
        scope: {},
        validFrom: '2030-01-01T00:00:00.000Z',
        validTo: '2029-01-01T00:00:00.000Z',
        createdBy: HEAD,
      }),
    ).rejects.toThrow(/validTo/);
  });

  it('rejects maxUses <= 0', async () => {
    const { svc } = makeService();
    await expect(
      svc.grantStanding(TENANT, {
        domain: 'finance',
        actionCategory: 'x',
        scope: {},
        maxUses: 0,
        createdBy: HEAD,
      }),
    ).rejects.toThrow(/maxUses/);
  });
});

describe('ApprovalGrantService — checkAuthorization', () => {
  it('returns mustRequestApproval=true when no grant exists', async () => {
    const { svc } = makeService();
    const res = await svc.checkAuthorization(TENANT, 'send_rent_reminder', {
      domain: 'finance',
    });
    expect(res.authorized).toBe(false);
    expect(res.kind).toBe('none');
    expect(res.mustRequestApproval).toBe(true);
  });

  it('prefers single_action over standing when both match', async () => {
    const { svc } = makeService();
    await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'execute_disbursement',
      scope: { amountCeilingMinorUnits: 1_000_000 },
      createdBy: HEAD,
    });
    const single = await svc.grantSingle(TENANT, {
      domain: 'finance',
      actionCategory: 'execute_disbursement',
      scope: { targetEntityType: 'invoice', targetEntityId: 'inv_pref' },
      createdBy: HEAD,
    });
    const res = await svc.checkAuthorization(TENANT, 'execute_disbursement', {
      domain: 'finance',
      targetEntityType: 'invoice',
      targetEntityId: 'inv_pref',
      amountMinorUnits: 100,
    });
    expect(res.authorized).toBe(true);
    expect(res.kind).toBe('single');
    expect(res.grantId).toBe(single.id);
  });

  it('matches standing grant within amount ceiling', async () => {
    const { svc } = makeService();
    await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'send_rent_reminder',
      scope: { amountCeilingMinorUnits: 300_000 },
      createdBy: HEAD,
    });
    const ok = await svc.checkAuthorization(TENANT, 'send_rent_reminder', {
      domain: 'finance',
      amountMinorUnits: 250_000,
    });
    expect(ok.authorized).toBe(true);
    expect(ok.kind).toBe('standing');
  });

  it('rejects standing grant when amount exceeds ceiling', async () => {
    const { svc } = makeService();
    await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'send_rent_reminder',
      scope: { amountCeilingMinorUnits: 100_000 },
      createdBy: HEAD,
    });
    const res = await svc.checkAuthorization(TENANT, 'send_rent_reminder', {
      domain: 'finance',
      amountMinorUnits: 500_000,
    });
    expect(res.authorized).toBe(false);
    expect(res.mustRequestApproval).toBe(true);
  });

  it('enforces entity allow-list on standing grant', async () => {
    const { svc } = makeService();
    await svc.grantStanding(TENANT, {
      domain: 'leasing',
      actionCategory: 'propose_renewal',
      scope: { entityType: 'lease', entityIds: ['lease_1', 'lease_2'] },
      createdBy: HEAD,
    });
    const allowed = await svc.checkAuthorization(TENANT, 'propose_renewal', {
      domain: 'leasing',
      targetEntityType: 'lease',
      targetEntityId: 'lease_1',
    });
    const denied = await svc.checkAuthorization(TENANT, 'propose_renewal', {
      domain: 'leasing',
      targetEntityType: 'lease',
      targetEntityId: 'lease_99',
    });
    expect(allowed.authorized).toBe(true);
    expect(denied.authorized).toBe(false);
  });

  it('returns exhausted when standing grant usedCount >= maxUses', async () => {
    const { svc } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'communications',
      actionCategory: 'send_broadcast',
      scope: {},
      maxUses: 2,
      createdBy: HEAD,
    });
    await svc.consume(g.id, TENANT, 'run_1');
    await svc.consume(g.id, TENANT, 'run_2');
    const res = await svc.checkAuthorization(TENANT, 'send_broadcast', {
      domain: 'communications',
    });
    expect(res.authorized).toBe(false);
    expect(res.reason).toMatch(/no active grant/i);
  });

  it('does not return revoked grants', async () => {
    const { svc } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'compliance',
      actionCategory: 'draft_legal_notice',
      scope: {},
      createdBy: HEAD,
    });
    await svc.revoke(g.id, TENANT, HEAD, 'user changed their mind');
    const res = await svc.checkAuthorization(TENANT, 'draft_legal_notice', {
      domain: 'compliance',
    });
    expect(res.authorized).toBe(false);
  });

  it('does not return expired grants (server NOW)', async () => {
    let now = new Date('2026-04-20T10:00:00.000Z');
    const { svc } = makeService(() => now);
    await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'send_rent_reminder',
      scope: {},
      validFrom: '2026-04-19T00:00:00.000Z',
      validTo: '2026-04-20T11:00:00.000Z',
      createdBy: HEAD,
    });
    // Before expiry — authorized.
    let res = await svc.checkAuthorization(TENANT, 'send_rent_reminder', {
      domain: 'finance',
    });
    expect(res.authorized).toBe(true);
    // Advance clock past expiry.
    now = new Date('2026-04-20T12:00:00.000Z');
    res = await svc.checkAuthorization(TENANT, 'send_rent_reminder', {
      domain: 'finance',
    });
    expect(res.authorized).toBe(false);
  });

  it('isolates tenants — grant in tenant A invisible to tenant B', async () => {
    const { svc } = makeService();
    await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'send_rent_reminder',
      scope: {},
      createdBy: HEAD,
    });
    const res = await svc.checkAuthorization(
      OTHER_TENANT,
      'send_rent_reminder',
      { domain: 'finance' },
    );
    expect(res.authorized).toBe(false);
  });
});

describe('ApprovalGrantService — consume', () => {
  it('increments usedCount on first consume', async () => {
    const { svc } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'send_rent_reminder',
      scope: {},
      createdBy: HEAD,
    });
    const r = await svc.consume(g.id, TENANT, 'run_abc', { actor: 'agent_1' });
    expect(r.consumed).toBe(true);
    expect(r.idempotent).toBe(false);
    expect(r.usedCount).toBe(1);
  });

  it('is idempotent on (grantId, actionRef)', async () => {
    const { svc } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'send_rent_reminder',
      scope: {},
      createdBy: HEAD,
    });
    const first = await svc.consume(g.id, TENANT, 'run_xyz');
    const second = await svc.consume(g.id, TENANT, 'run_xyz');
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.usedCount).toBe(first.usedCount);
  });

  it('rejects consume on a revoked grant', async () => {
    const { svc } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'send_rent_reminder',
      scope: {},
      createdBy: HEAD,
    });
    await svc.revoke(g.id, TENANT, HEAD, 'policy change');
    await expect(
      svc.consume(g.id, TENANT, 'run_after_revoke'),
    ).rejects.toThrow(/revoked/i);
  });

  it('rejects consume when maxUses would be exceeded', async () => {
    const { svc } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'x',
      scope: {},
      maxUses: 1,
      createdBy: HEAD,
    });
    await svc.consume(g.id, TENANT, 'r1');
    await expect(svc.consume(g.id, TENANT, 'r2')).rejects.toThrow(/exhausted/i);
  });

  it('rejects cross-tenant consume attempts', async () => {
    const { svc } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'x',
      scope: {},
      createdBy: HEAD,
    });
    await expect(
      svc.consume(g.id, OTHER_TENANT, 'r1'),
    ).rejects.toThrow(/not found/i);
  });

  it('emits ApprovalGrantConsumed event per consume', async () => {
    const { svc, events } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'x',
      scope: {},
      createdBy: HEAD,
    });
    await svc.consume(g.id, TENANT, 'r1', { actor: 'agent_a' });
    const consumed = events.find((e) => e.eventType === 'ApprovalGrantConsumed');
    expect(consumed).toBeDefined();
    expect(consumed!.tenantId).toBe(TENANT);
  });
});

describe('ApprovalGrantService — revocation & listing', () => {
  it('revoke flips revokedAt + emits ApprovalGrantRevoked', async () => {
    const { svc, events } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'x',
      scope: {},
      createdBy: HEAD,
    });
    const revoked = await svc.revoke(g.id, TENANT, HEAD, 'no longer needed');
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.revokedBy).toBe(HEAD);
    const ev = events.find((e) => e.eventType === 'ApprovalGrantRevoked');
    expect(ev).toBeDefined();
  });

  it('listActive excludes revoked and expired', async () => {
    let now = new Date('2026-04-20T10:00:00.000Z');
    const { svc } = makeService(() => now);
    const a = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'x',
      scope: {},
      createdBy: HEAD,
    });
    const b = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'y',
      scope: {},
      validTo: '2026-04-20T09:00:00.000Z', // already expired vs clock
      createdBy: HEAD,
    });
    void b;
    await svc.revoke(a.id, TENANT, HEAD, 'test');
    const active = await svc.listActive(TENANT);
    expect(active).toHaveLength(0);
  });

  it('listHistory includes revoked when requested', async () => {
    const { svc } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'x',
      scope: {},
      createdBy: HEAD,
    });
    await svc.revoke(g.id, TENANT, HEAD, 'reason');
    const history = await svc.listHistory(TENANT, { includeRevoked: true });
    expect(history).toHaveLength(1);
    const filtered = await svc.listHistory(TENANT, { includeRevoked: false });
    expect(filtered).toHaveLength(0);
  });

  it('revoke twice returns a not-found-or-already-revoked error', async () => {
    const { svc } = makeService();
    const g = await svc.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'x',
      scope: {},
      createdBy: HEAD,
    });
    await svc.revoke(g.id, TENANT, HEAD, 'first');
    await expect(
      svc.revoke(g.id, TENANT, HEAD, 'second'),
    ).rejects.toThrow(/not found|already/i);
  });
});
