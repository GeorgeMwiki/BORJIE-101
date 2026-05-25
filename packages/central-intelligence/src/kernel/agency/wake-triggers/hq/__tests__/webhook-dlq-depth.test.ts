/**
 * Tests for the webhook-dlq-depth HQ wake-trigger.
 */
import { describe, it, expect } from 'vitest';
import { createWebhookDlqDepthTrigger } from '../webhook-dlq-depth.js';

const fixedClock = (): Date => new Date('2026-05-15T00:00:00Z');

describe('createWebhookDlqDepthTrigger', () => {
  it('returns [] when read port not wired', async () => {
    const t = createWebhookDlqDepthTrigger({});
    expect(await t.detect({ tenantId: 't1', clock: fixedClock })).toEqual([]);
  });

  it('returns [] when stale count is below floor', async () => {
    const t = createWebhookDlqDepthTrigger({
      dlqRead: {
        async countStaleByTenant() {
          return {
            tenantId: 't1',
            staleCount: 49,
            oldestStaleHours: 3,
            dominantProvider: null,
          };
        },
      },
    });
    expect(await t.detect({ tenantId: 't1', clock: fixedClock })).toEqual([]);
  });

  it('50-199 stale → priority=medium', async () => {
    const t = createWebhookDlqDepthTrigger({
      dlqRead: {
        async countStaleByTenant() {
          return {
            tenantId: 't1',
            staleCount: 75,
            oldestStaleHours: 5,
            dominantProvider: 'gepg',
          };
        },
      },
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toHaveLength(1);
    expect(goals[0]?.priority).toBe('medium');
    expect(goals[0]?.title).toContain('gepg dominant');
    expect(goals[0]?.steps[1]?.toolName).toBe(
      'platform.webhook-dlq-decision',
    );
  });

  it('200-999 stale → priority=high', async () => {
    const t = createWebhookDlqDepthTrigger({
      dlqRead: {
        async countStaleByTenant() {
          return {
            tenantId: 't1',
            staleCount: 350,
            oldestStaleHours: 8,
            dominantProvider: null,
          };
        },
      },
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals[0]?.priority).toBe('high');
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      severity: 'high',
    });
  });

  it('1000+ stale → priority=critical', async () => {
    const t = createWebhookDlqDepthTrigger({
      dlqRead: {
        async countStaleByTenant() {
          return {
            tenantId: 't1',
            staleCount: 2000,
            oldestStaleHours: 24,
            dominantProvider: 'kra',
          };
        },
      },
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals[0]?.priority).toBe('critical');
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      severity: 'critical',
      dominantProvider: 'kra',
    });
  });

  it('staleCountFloor override is honoured', async () => {
    const t = createWebhookDlqDepthTrigger({
      dlqRead: {
        async countStaleByTenant() {
          return {
            tenantId: 't1',
            staleCount: 30,
            oldestStaleHours: 2,
            dominantProvider: null,
          };
        },
      },
      staleCountFloor: 20,
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toHaveLength(1);
  });

  it('has stable id', () => {
    expect(createWebhookDlqDepthTrigger({}).id).toBe(
      'hq.webhook-dlq-depth',
    );
  });

  it('returns [] on read-port throw', async () => {
    const t = createWebhookDlqDepthTrigger({
      dlqRead: {
        async countStaleByTenant() {
          throw new Error('boom');
        },
      },
    });
    expect(await t.detect({ tenantId: 't1', clock: fixedClock })).toEqual([]);
  });
});
