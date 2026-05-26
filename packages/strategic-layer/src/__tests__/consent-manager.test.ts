import { describe, it, expect } from 'vitest';
import { createConsentManager } from '../federation/consent-manager.js';
import { createInMemoryFederationConsentsRepository } from '../repositories/federation-consents-repository.js';
import { StrategicLayerError } from '../types.js';

function makeManager(startMs = 1_800_000_000_000) {
  const repo = createInMemoryFederationConsentsRepository();
  let nowMs = startMs;
  const manager = createConsentManager({
    repo,
    now: () => new Date(nowMs),
  });
  return {
    repo,
    manager,
    advanceDays: (d: number) => (nowMs += d * 24 * 60 * 60 * 1000),
  };
}

describe('ConsentManager', () => {
  it('default-denies when no consent has been granted', async () => {
    const { manager } = makeManager();
    expect(await manager.isAllowed('t1', 'patterns')).toBe(false);
  });

  it('grants a scoped consent and reports it as allowed', async () => {
    const { manager } = makeManager();
    const consent = await manager.grant({
      tenantId: 't1',
      scope: 'patterns',
      durationDays: 90,
      grantedBy: 'owner-1',
    });
    expect(consent.status).toBe('active');
    expect(await manager.isAllowed('t1', 'patterns')).toBe(true);
    // A different scope is still denied.
    expect(await manager.isAllowed('t1', 'failures')).toBe(false);
  });

  it('grants `all` and reports every scope as allowed', async () => {
    const { manager } = makeManager();
    await manager.grant({
      tenantId: 't1',
      scope: 'all',
      durationDays: 30,
      grantedBy: 'owner-1',
    });
    expect(await manager.isAllowed('t1', 'patterns')).toBe(true);
    expect(await manager.isAllowed('t1', 'rules')).toBe(true);
    expect(await manager.isAllowed('t1', 'terminology')).toBe(true);
    expect(await manager.isAllowed('t1', 'failures')).toBe(true);
  });

  it('revokes a consent prospectively and blocks future checks', async () => {
    const { manager } = makeManager();
    await manager.grant({
      tenantId: 't1',
      scope: 'patterns',
      durationDays: 90,
      grantedBy: 'owner-1',
    });
    const revoked = await manager.revoke('t1', 'patterns', 'owner-1');
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedBy).toBe('owner-1');
    expect(await manager.isAllowed('t1', 'patterns')).toBe(false);
  });

  it('treats expired consents as denied even before explicit revocation', async () => {
    const { manager, advanceDays } = makeManager();
    await manager.grant({
      tenantId: 't1',
      scope: 'patterns',
      durationDays: 7,
      grantedBy: 'owner-1',
    });
    expect(await manager.isAllowed('t1', 'patterns')).toBe(true);
    advanceDays(10);
    expect(await manager.isAllowed('t1', 'patterns')).toBe(false);
  });

  it('refuses out-of-range durations', async () => {
    const { manager } = makeManager();
    await expect(
      manager.grant({
        tenantId: 't1',
        scope: 'patterns',
        durationDays: 0,
        grantedBy: 'owner-1',
      }),
    ).rejects.toBeInstanceOf(StrategicLayerError);
    await expect(
      manager.grant({
        tenantId: 't1',
        scope: 'patterns',
        durationDays: 366,
        grantedBy: 'owner-1',
      }),
    ).rejects.toBeInstanceOf(StrategicLayerError);
  });
});
