/**
 * Tests for the subscription-churn HQ wake-trigger.
 *
 *   - No port wired → returns [].
 *   - Empty result  → returns [].
 *   - 1 churn       → low severity → priority=medium.
 *   - 3 churns      → medium severity → priority=high.
 *   - 5 churns      → high severity → priority=critical.
 *   - perTenantLimit bounds the output array.
 *   - resolveAssigneeUserId fallback to 'hq-bot' on null/throw.
 *   - Trigger id + description are stable.
 */
import { describe, it, expect } from 'vitest';
import { createSubscriptionChurnTrigger } from '../subscription-churn.js';

const fixedClock = (): Date => new Date('2026-05-01T00:00:00Z');

describe('createSubscriptionChurnTrigger', () => {
  it('returns [] when read port not wired', async () => {
    const trigger = createSubscriptionChurnTrigger({});
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toEqual([]);
  });

  it('returns [] when read port returns empty', async () => {
    const trigger = createSubscriptionChurnTrigger({
      churnRead: {
        async listRecentChurns() {
          return [];
        },
      },
    });
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toEqual([]);
  });

  it('1 churn → priority=medium (low severity)', async () => {
    const trigger = createSubscriptionChurnTrigger({
      churnRead: {
        async listRecentChurns(args) {
          expect(args.tenantId).toBe('t1');
          expect(args.windowHours).toBe(24);
          return [
            {
              tenantId: 't1',
              churnedAt: '2026-04-30T10:00:00Z',
              tenantName: 'Acme',
            },
          ];
        },
      },
    });
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toHaveLength(1);
    expect(goals[0]?.priority).toBe('medium');
    expect(goals[0]?.threadId).toBe('wake-hq-subscription-churn-t1');
    expect(goals[0]?.title).toContain('Acme');
    expect(goals[0]?.steps[1]?.toolName).toBe(
      'platform.subscription-save-outreach',
    );
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      tenantId: 't1',
      severity: 'low',
    });
  });

  it('3 churns → priority=high (medium severity)', async () => {
    const rows = Array.from({ length: 3 }).map((_, i) => ({
      tenantId: 't1',
      churnedAt: `2026-04-30T0${i}:00:00Z`,
      tenantName: `Acme-${i}`,
    }));
    const trigger = createSubscriptionChurnTrigger({
      churnRead: {
        async listRecentChurns() {
          return rows;
        },
      },
    });
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toHaveLength(3);
    expect(goals[0]?.priority).toBe('high');
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      severity: 'medium',
    });
  });

  it('5+ churns → priority=critical (high severity)', async () => {
    const rows = Array.from({ length: 5 }).map((_, i) => ({
      tenantId: 't1',
      churnedAt: `2026-04-30T0${i}:00:00Z`,
      tenantName: null,
    }));
    const trigger = createSubscriptionChurnTrigger({
      churnRead: {
        async listRecentChurns() {
          return rows;
        },
      },
    });
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals[0]?.priority).toBe('critical');
  });

  it('perTenantLimit bounds the output', async () => {
    const rows = Array.from({ length: 12 }).map(() => ({
      tenantId: 't1',
      churnedAt: '2026-04-30T00:00:00Z',
      tenantName: null,
    }));
    const trigger = createSubscriptionChurnTrigger({
      churnRead: {
        async listRecentChurns() {
          return rows;
        },
      },
      perTenantLimit: 3,
    });
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toHaveLength(3);
  });

  it('resolves assignee userId via the dep when wired', async () => {
    const trigger = createSubscriptionChurnTrigger({
      churnRead: {
        async listRecentChurns() {
          return [
            {
              tenantId: 't1',
              churnedAt: '2026-04-30T10:00:00Z',
              tenantName: 'Acme',
            },
          ];
        },
      },
      resolveAssigneeUserId: async () => 'user-42',
    });
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals[0]?.userId).toBe('user-42');
  });

  it('falls back to hq-bot when assignee resolver throws', async () => {
    const trigger = createSubscriptionChurnTrigger({
      churnRead: {
        async listRecentChurns() {
          return [
            {
              tenantId: 't1',
              churnedAt: '2026-04-30T10:00:00Z',
              tenantName: null,
            },
          ];
        },
      },
      resolveAssigneeUserId: async () => {
        throw new Error('lookup failed');
      },
    });
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals[0]?.userId).toBe('hq-bot');
  });

  it('has stable id + description', () => {
    const trigger = createSubscriptionChurnTrigger({});
    expect(trigger.id).toBe('hq.subscription-churn');
    expect(trigger.description).toMatch(/HQ-tier/);
  });
});
