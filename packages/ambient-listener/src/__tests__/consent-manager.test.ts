import { describe, expect, it } from 'vitest';

import {
  createConsentManager,
  isExpired,
} from '../consent/consent-manager.js';
import { createInMemoryAuditChain } from '../repositories/audit.js';
import { createInMemoryAmbientConsentsRepository } from '../repositories/ambient-consents.js';
import {
  RE_CONSENT_WINDOW_DAYS,
  type AmbientConsent,
} from '../types.js';

function buildDeps(now: Date) {
  const repo = createInMemoryAmbientConsentsRepository();
  const audit = createInMemoryAuditChain({ seed: 'consent-test' });
  const manager = createConsentManager({
    repo,
    audit,
    clock: () => now,
  });
  return { repo, audit, manager };
}

describe('consent-manager', () => {
  const tenant_id = 't-001';
  const user_id = '00000000-0000-0000-0000-000000000001';
  const granted_by = '00000000-0000-0000-0000-000000000099';

  it('starts not-set and silent-disables', async () => {
    const now = new Date('2026-05-01T08:00:00Z');
    const { manager } = buildDeps(now);
    const check = await manager.check({ tenant_id, user_id, channel: 'chat' });
    expect(check.may_listen).toBe(false);
    expect(check.effective_state).toBe('not-set');
    expect(check.consent).toBeNull();
  });

  it('grant flips state to granted and lists the row', async () => {
    const now = new Date('2026-05-01T08:00:00Z');
    const { manager, repo } = buildDeps(now);
    const grantResult = await manager.grant({
      tenant_id,
      user_id,
      channel: 'chat',
      granted_by,
    });
    expect(grantResult.consent_state).toBe('granted');
    expect(grantResult.granted_at).toBe(now.toISOString());
    expect(grantResult.audit_hash).toMatch(/^aud[0-9a-f]+$/);

    const stored = await repo.get(tenant_id, user_id, 'chat');
    expect(stored?.consent_state).toBe('granted');
    const listed = await repo.listForUser(tenant_id, user_id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.channel).toBe('chat');
  });

  it('revoke transitions granted → revoked and silent-disables', async () => {
    const now = new Date('2026-05-01T08:00:00Z');
    const { manager } = buildDeps(now);
    await manager.grant({
      tenant_id,
      user_id,
      channel: 'voice_call',
      granted_by,
    });
    await manager.revoke({
      tenant_id,
      user_id,
      channel: 'voice_call',
      revoked_by: granted_by,
    });
    const check = await manager.check({
      tenant_id,
      user_id,
      channel: 'voice_call',
    });
    expect(check.may_listen).toBe(false);
    expect(check.effective_state).toBe('revoked');
    expect(check.consent?.revoked_at).toBe(now.toISOString());
  });

  it('per-channel grants are independent', async () => {
    const now = new Date('2026-05-01T08:00:00Z');
    const { manager } = buildDeps(now);
    await manager.grant({
      tenant_id,
      user_id,
      channel: 'chat',
      granted_by,
    });
    const chatCheck = await manager.check({
      tenant_id,
      user_id,
      channel: 'chat',
    });
    const voiceCheck = await manager.check({
      tenant_id,
      user_id,
      channel: 'voice_call',
    });
    expect(chatCheck.may_listen).toBe(true);
    expect(voiceCheck.may_listen).toBe(false);
    expect(voiceCheck.effective_state).toBe('not-set');
  });

  it('enforces 90-day re-consent expiry (FOUNDER_LOCKED 4.4)', async () => {
    const grantedAt = new Date('2026-01-01T08:00:00Z');
    const later = new Date(
      grantedAt.getTime() + (RE_CONSENT_WINDOW_DAYS + 1) * 86_400_000,
    );

    const { manager } = buildDeps(grantedAt);
    await manager.grant({
      tenant_id,
      user_id,
      channel: 'chat',
      granted_by,
    });

    // Same instant — not expired.
    const fresh = await manager.check({
      tenant_id,
      user_id,
      channel: 'chat',
    });
    expect(fresh.may_listen).toBe(true);

    // Push the clock forward beyond 90 d — pipeline must silent-disable.
    const repo = createInMemoryAmbientConsentsRepository();
    const audit = createInMemoryAuditChain();
    const futureManager = createConsentManager({
      repo,
      audit,
      clock: () => later,
    });
    // Pre-load an "old" grant by upserting through the repo directly.
    const oldConsent: AmbientConsent = {
      tenant_id,
      user_id,
      channel: 'chat',
      consent_state: 'granted',
      sentiment_consent: false,
      granted_at: grantedAt.toISOString(),
      revoked_at: null,
      granted_by,
      audit_hash: 'aud-prev',
    };
    await repo.upsert(oldConsent);
    const expiredCheck = await futureManager.check({
      tenant_id,
      user_id,
      channel: 'chat',
    });
    expect(expiredCheck.may_listen).toBe(false);
    expect(expiredCheck.effective_state).toBe('expired');
    expect(await futureManager.mustReConsent({
      tenant_id,
      user_id,
      channel: 'chat',
    })).toBe(true);
  });

  it('mustReConsent returns false for revoked and not-set states', async () => {
    const now = new Date('2026-05-01T08:00:00Z');
    const { manager } = buildDeps(now);

    // not-set
    expect(
      await manager.mustReConsent({
        tenant_id,
        user_id,
        channel: 'sms',
      }),
    ).toBe(false);

    // revoked
    await manager.grant({
      tenant_id,
      user_id,
      channel: 'sms',
      granted_by,
    });
    await manager.revoke({
      tenant_id,
      user_id,
      channel: 'sms',
      revoked_by: granted_by,
    });
    expect(
      await manager.mustReConsent({
        tenant_id,
        user_id,
        channel: 'sms',
      }),
    ).toBe(false);
  });

  it('isExpired pure helper is symmetric with manager.check', () => {
    const grantedAt = new Date('2026-01-01T08:00:00Z');
    const beyondMs =
      grantedAt.getTime() + (RE_CONSENT_WINDOW_DAYS + 1) * 86_400_000;
    const beyond = new Date(beyondMs);
    const consent: AmbientConsent = {
      tenant_id,
      user_id,
      channel: 'chat',
      consent_state: 'granted',
      sentiment_consent: false,
      granted_at: grantedAt.toISOString(),
      revoked_at: null,
      granted_by,
      audit_hash: 'aud-1',
    };
    expect(isExpired(consent, grantedAt)).toBe(false);
    expect(isExpired(consent, beyond)).toBe(true);
  });

  it('sentiment_consent flag is preserved through grant + revoke', async () => {
    const now = new Date('2026-05-01T08:00:00Z');
    const { manager } = buildDeps(now);
    await manager.grant({
      tenant_id,
      user_id,
      channel: 'chat',
      granted_by,
      sentiment_consent: true,
    });
    const checkBefore = await manager.check({
      tenant_id,
      user_id,
      channel: 'chat',
    });
    expect(checkBefore.consent?.sentiment_consent).toBe(true);

    await manager.revoke({
      tenant_id,
      user_id,
      channel: 'chat',
      revoked_by: granted_by,
    });
    const checkAfter = await manager.check({
      tenant_id,
      user_id,
      channel: 'chat',
    });
    // Revoked rows carry forward the sentiment_consent setting for audit.
    expect(checkAfter.consent?.sentiment_consent).toBe(true);
    expect(checkAfter.may_listen).toBe(false);
  });
});
