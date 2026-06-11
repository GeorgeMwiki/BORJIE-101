/**
 * Break-glass operator-access store — behavioural contract (INV-A / FIRE-1).
 *
 * Proves the four guarantees the invariant demands, deterministically, on the
 * in-memory store (identical semantics to the Drizzle one):
 *   (a) DENY-BY-DEFAULT — a fresh request is unusable.
 *   (b) tenant CONSENT — only consent flips it usable.
 *   (c) TIME-BOXED — an expired grant is refused even while status reads active.
 *   (d) AUDITED (hash-chained) — every access appends a verifiable chain entry;
 *       a single mutation breaks verification.
 *   (e) tenant ISOLATION — a grant/log for tenant A is invisible to tenant B.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemoryOperatorAccessStore,
} from '../operator-access-store';
import { verifyChain } from '../hash-chain';

const OP = 'op-1';
const T_A = 'tenant-a';
const T_B = 'tenant-b';

function mutableClock(start = new Date('2026-06-09T10:00:00Z')) {
  let now = start;
  return {
    now: () => now,
    advanceMinutes: (m: number) => {
      now = new Date(now.getTime() + m * 60_000);
    },
  };
}

describe('break-glass store — deny-by-default + consent', () => {
  it('a fresh request is PENDING and is NOT usable (deny-by-default)', async () => {
    const store = createInMemoryOperatorAccessStore();
    const grant = await store.requestGrant({
      tenantId: T_A,
      operatorId: OP,
      justificationCode: 'incident_response',
      reason: 'INC-1',
      scopes: ['decision_trace_content'],
    });
    expect(grant.status).toBe('pending');

    const check = await store.assertActiveGrant({
      operatorId: OP,
      tenantId: T_A,
      scope: 'decision_trace_content',
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('not_consented');
  });

  it('only TENANT CONSENT makes the grant usable', async () => {
    const store = createInMemoryOperatorAccessStore();
    const grant = await store.requestGrant({
      tenantId: T_A,
      operatorId: OP,
      justificationCode: 'support_request',
      reason: 'INC-2',
      scopes: ['support_ticket_content'],
    });
    await store.consent({ grantId: grant.id, tenantId: T_A, consentedBy: 'owner-a' });

    const check = await store.assertActiveGrant({
      operatorId: OP,
      tenantId: T_A,
      scope: 'support_ticket_content',
    });
    expect(check.ok).toBe(true);
  });

  it('a grant for a DIFFERENT scope does not unlock another scope', async () => {
    const store = createInMemoryOperatorAccessStore();
    const grant = await store.requestGrant({
      tenantId: T_A,
      operatorId: OP,
      justificationCode: 'incident_response',
      reason: 'INC-3',
      scopes: ['support_ticket_content'],
    });
    await store.consent({ grantId: grant.id, tenantId: T_A, consentedBy: 'owner-a' });

    const check = await store.assertActiveGrant({
      operatorId: OP,
      tenantId: T_A,
      scope: 'decision_trace_content',
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('scope_not_granted');
  });
});

describe('break-glass store — time-box', () => {
  it('an expired grant is refused even though status still reads active', async () => {
    const clock = mutableClock();
    const store = createInMemoryOperatorAccessStore(clock.now);
    const grant = await store.requestGrant({
      tenantId: T_A,
      operatorId: OP,
      justificationCode: 'incident_response',
      reason: 'INC-4',
      scopes: ['decision_trace_content'],
      ttlMinutes: 60,
    });
    await store.consent({ grantId: grant.id, tenantId: T_A, consentedBy: 'owner-a' });

    // Within the window → ok.
    expect(
      (await store.assertActiveGrant({ operatorId: OP, tenantId: T_A, scope: 'decision_trace_content' })).ok,
    ).toBe(true);

    // Advance past expiry → refused.
    clock.advanceMinutes(61);
    const expired = await store.assertActiveGrant({
      operatorId: OP,
      tenantId: T_A,
      scope: 'decision_trace_content',
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe('expired');
  });
});

describe('break-glass store — revoke', () => {
  it('revocation refuses a previously-active grant', async () => {
    const store = createInMemoryOperatorAccessStore();
    const grant = await store.requestGrant({
      tenantId: T_A,
      operatorId: OP,
      justificationCode: 'incident_response',
      reason: 'INC-5',
      scopes: ['decision_trace_content'],
    });
    await store.consent({ grantId: grant.id, tenantId: T_A, consentedBy: 'owner-a' });
    await store.revoke({ grantId: grant.id, tenantId: T_A, revokedBy: 'owner-a' });

    const check = await store.assertActiveGrant({
      operatorId: OP,
      tenantId: T_A,
      scope: 'decision_trace_content',
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('revoked');
  });
});

describe('break-glass store — hash-chained audit', () => {
  it('every access appends a verifiable chain entry; tamper breaks verify', async () => {
    const store = createInMemoryOperatorAccessStore();
    const grant = await store.requestGrant({
      tenantId: T_A,
      operatorId: OP,
      justificationCode: 'incident_response',
      reason: 'INC-6',
      scopes: ['decision_trace_content'],
    });
    await store.consent({ grantId: grant.id, tenantId: T_A, consentedBy: 'owner-a' });

    await store.recordAccess({
      grantId: grant.id,
      tenantId: T_A,
      operatorId: OP,
      route: 'r1',
      scope: 'decision_trace_content',
      rowCount: 1,
    });
    await store.recordAccess({
      grantId: grant.id,
      tenantId: T_A,
      operatorId: OP,
      route: 'r2',
      scope: 'decision_trace_content',
      rowCount: 3,
    });

    const verified = await store.verifyTenantChain(T_A);
    expect(verified.ok).toBe(true);

    // Tamper with a row's rowCount and re-verify the chain — must break.
    const entries = [...(await store.listAccessLogForTenant(T_A))];
    const tampered = entries.map((e, i) =>
      i === 0 ? { ...e, rowCount: 999 } : e,
    );
    const broken = verifyChain(tampered as any);
    expect(broken.ok).toBe(false);
  });

  it('the access log is tenant-visible and tenant-isolated', async () => {
    const store = createInMemoryOperatorAccessStore();
    const gA = await store.requestGrant({
      tenantId: T_A,
      operatorId: OP,
      justificationCode: 'incident_response',
      reason: 'A',
      scopes: ['decision_trace_content'],
    });
    await store.consent({ grantId: gA.id, tenantId: T_A, consentedBy: 'owner-a' });
    await store.recordAccess({
      grantId: gA.id,
      tenantId: T_A,
      operatorId: OP,
      route: 'r',
      scope: 'decision_trace_content',
      rowCount: 1,
    });

    const aLog = await store.listAccessLogForTenant(T_A);
    const bLog = await store.listAccessLogForTenant(T_B);
    expect(aLog.length).toBe(1);
    expect(bLog.length).toBe(0); // tenant B sees none of A's records

    const aGrants = await store.listGrantsForTenant(T_A);
    const bGrants = await store.listGrantsForTenant(T_B);
    expect(aGrants.length).toBe(1);
    expect(bGrants.length).toBe(0);
  });

  it('a grant for tenant A cannot be consented through tenant B', async () => {
    const store = createInMemoryOperatorAccessStore();
    const gA = await store.requestGrant({
      tenantId: T_A,
      operatorId: OP,
      justificationCode: 'incident_response',
      reason: 'A',
      scopes: ['decision_trace_content'],
    });
    await expect(
      store.consent({ grantId: gA.id, tenantId: T_B, consentedBy: 'owner-b' }),
    ).rejects.toThrow();
  });
});
