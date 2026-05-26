import { describe, expect, it } from 'vitest';

import { createKillSwitch } from '../consent/kill-switch.js';
import { createInMemoryAuditChain } from '../repositories/audit.js';
import { createInMemoryKillSwitchEventsRepository } from '../repositories/kill-switch-events.js';

function buildDeps(now: Date) {
  const repo = createInMemoryKillSwitchEventsRepository();
  const audit = createInMemoryAuditChain({ seed: 'ks-test' });
  let counter = 0;
  const idGen = () => `00000000-0000-0000-0000-${(++counter).toString().padStart(12, '0')}`;
  const ks = createKillSwitch({
    repo,
    audit,
    clock: () => now,
    idGen,
  });
  return { repo, audit, ks, idGen };
}

describe('kill-switch', () => {
  const tenant_id = 't-ks-001';
  const user_id = '00000000-0000-0000-0000-000000000010';
  const admin_id = '00000000-0000-0000-0000-000000000099';

  it('trigger with scope=user requires target_user_id', async () => {
    const { ks } = buildDeps(new Date('2026-05-01T08:00:00Z'));
    await expect(
      ks.trigger({
        tenant_id,
        triggered_by: admin_id,
        reason: 'oops',
        scope: 'user',
      }),
    ).rejects.toThrow(/target_user_id/);
  });

  it('trigger writes an audit-hashed event', async () => {
    const now = new Date('2026-05-01T08:00:00Z');
    const { ks, repo } = buildDeps(now);
    const event = await ks.trigger({
      tenant_id,
      triggered_by: admin_id,
      reason: 'user requested stop',
      scope: 'user',
      target_user_id: user_id,
    });
    expect(event.triggered_at).toBe(now.toISOString());
    expect(event.scope).toBe('user');
    expect(event.target_user_id).toBe(user_id);
    expect(event.audit_hash).toMatch(/^aud[0-9a-f]+$/);

    const listed = await repo.listForTenant(tenant_id);
    expect(listed).toHaveLength(1);
  });

  it('isActive: user-scope kill switch flips state to true', async () => {
    const now = new Date('2026-05-01T08:00:00Z');
    const { ks } = buildDeps(now);
    expect((await ks.isActive(tenant_id, user_id)).active).toBe(false);

    await ks.trigger({
      tenant_id,
      triggered_by: admin_id,
      reason: 'mistake',
      scope: 'user',
      target_user_id: user_id,
    });

    const status = await ks.isActive(tenant_id, user_id);
    expect(status.active).toBe(true);
    expect(status.scope).toBe('user');

    // Same tenant, different user — not affected.
    const otherUser = '00000000-0000-0000-0000-000000000088';
    expect((await ks.isActive(tenant_id, otherUser)).active).toBe(false);
  });

  it('isActive: org-scope kill switch affects every user in the tenant', async () => {
    const now = new Date('2026-05-01T08:00:00Z');
    const { ks } = buildDeps(now);
    await ks.trigger({
      tenant_id,
      triggered_by: admin_id,
      reason: 'org-wide pause',
      scope: 'org',
    });

    const status = await ks.isActive(tenant_id, user_id);
    expect(status.active).toBe(true);
    expect(status.scope).toBe('org');

    // Different tenant — unaffected.
    const otherStatus = await ks.isActive('different-tenant', user_id);
    expect(otherStatus.active).toBe(false);
  });

  it('isActive ignores events older than 24h lookback', async () => {
    const repo = createInMemoryKillSwitchEventsRepository();
    const audit = createInMemoryAuditChain();
    let nowMs = new Date('2026-05-01T00:00:00Z').getTime();
    const ks = createKillSwitch({
      repo,
      audit,
      clock: () => new Date(nowMs),
    });

    // Trigger at hour 0.
    await ks.trigger({
      tenant_id,
      triggered_by: admin_id,
      reason: 'old kill',
      scope: 'user',
      target_user_id: user_id,
    });

    // Push clock 25 hours forward.
    nowMs += 25 * 3600 * 1000;
    const status = await ks.isActive(tenant_id, user_id);
    expect(status.active).toBe(false);
  });
});
