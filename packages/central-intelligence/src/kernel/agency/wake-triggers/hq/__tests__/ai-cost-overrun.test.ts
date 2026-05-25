/**
 * Tests for the ai-cost-overrun HQ wake-trigger.
 */
import { describe, it, expect } from 'vitest';
import { createAiCostOverrunTrigger } from '../ai-cost-overrun.js';

const fixedClock = (): Date => new Date('2026-05-15T00:00:00Z');

describe('createAiCostOverrunTrigger', () => {
  it('returns [] when read port not wired', async () => {
    const t = createAiCostOverrunTrigger({});
    expect(await t.detect({ tenantId: 't1', clock: fixedClock })).toEqual([]);
  });

  it('80-89% utilization → priority=medium', async () => {
    const t = createAiCostOverrunTrigger({
      costRead: {
        async listAtRiskEnvelopes(args) {
          expect(args.utilizationFloor).toBe(0.8);
          expect(args.minDaysRemaining).toBe(7);
          return [
            {
              tenantId: 't1',
              periodKey: '2026-05',
              spendMicros: 850_000,
              capMicros: 1_000_000,
              periodEndsAt: '2026-05-31T00:00:00Z',
            },
          ];
        },
      },
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toHaveLength(1);
    expect(goals[0]?.priority).toBe('medium');
    expect(goals[0]?.steps[1]?.toolName).toBe(
      'platform.ai-cost-overrun-decision',
    );
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      severity: 'medium',
      tenantId: 't1',
    });
  });

  it('90-99% utilization → priority=high', async () => {
    const t = createAiCostOverrunTrigger({
      costRead: {
        async listAtRiskEnvelopes() {
          return [
            {
              tenantId: 't1',
              periodKey: '2026-05',
              spendMicros: 950_000,
              capMicros: 1_000_000,
              periodEndsAt: '2026-05-31T00:00:00Z',
            },
          ];
        },
      },
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals[0]?.priority).toBe('high');
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      severity: 'high',
    });
  });

  it('100%+ utilization → priority=critical (breach)', async () => {
    const t = createAiCostOverrunTrigger({
      costRead: {
        async listAtRiskEnvelopes() {
          return [
            {
              tenantId: 't1',
              periodKey: '2026-05',
              spendMicros: 1_100_000,
              capMicros: 1_000_000,
              periodEndsAt: '2026-05-31T00:00:00Z',
            },
          ];
        },
      },
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals[0]?.priority).toBe('critical');
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      severity: 'critical',
    });
  });

  it('zero-cap envelope (defensive: no NaN utilization)', async () => {
    const t = createAiCostOverrunTrigger({
      costRead: {
        async listAtRiskEnvelopes() {
          return [
            {
              tenantId: 't1',
              periodKey: 'broken',
              spendMicros: 0,
              capMicros: 0,
              periodEndsAt: '2026-05-31T00:00:00Z',
            },
          ];
        },
      },
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      utilization: 0,
    });
  });

  it('respects perTenantLimit', async () => {
    const rows = Array.from({ length: 10 }).map((_, i) => ({
      tenantId: 't1',
      periodKey: `2026-0${i}`,
      spendMicros: 900_000,
      capMicros: 1_000_000,
      periodEndsAt: '2026-12-31T00:00:00Z',
    }));
    const t = createAiCostOverrunTrigger({
      costRead: {
        async listAtRiskEnvelopes() {
          return rows;
        },
      },
      perTenantLimit: 2,
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toHaveLength(2);
  });

  it('has stable id', () => {
    expect(createAiCostOverrunTrigger({}).id).toBe('hq.ai-cost-overrun');
  });

  it('returns [] on read-port throw', async () => {
    const t = createAiCostOverrunTrigger({
      costRead: {
        async listAtRiskEnvelopes() {
          throw new Error('boom');
        },
      },
    });
    expect(await t.detect({ tenantId: 't1', clock: fixedClock })).toEqual([]);
  });
});
