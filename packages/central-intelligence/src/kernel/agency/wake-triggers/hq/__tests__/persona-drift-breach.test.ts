/**
 * Tests for the persona-drift-breach HQ wake-trigger.
 */
import { describe, it, expect } from 'vitest';
import { createPersonaDriftBreachTrigger } from '../persona-drift-breach.js';

const fixedClock = (): Date => new Date('2026-05-15T00:00:00Z');

describe('createPersonaDriftBreachTrigger', () => {
  it('returns [] when read port not wired', async () => {
    const t = createPersonaDriftBreachTrigger({});
    expect(await t.detect({ tenantId: 't1', clock: fixedClock })).toEqual([]);
  });

  it('returns [] when below floor', async () => {
    const t = createPersonaDriftBreachTrigger({
      driftRead: {
        async getRecentAggregate() {
          return {
            tenantId: 't1',
            aggregateL2: 0.05,
            turnCount: 100,
            dominantDim: null,
            windowStartedAt: '2026-05-14T00:00:00Z',
          };
        },
      },
    });
    expect(await t.detect({ tenantId: 't1', clock: fixedClock })).toEqual([]);
  });

  it('0.075-0.099 → priority=medium', async () => {
    const t = createPersonaDriftBreachTrigger({
      driftRead: {
        async getRecentAggregate(args) {
          expect(args.windowHours).toBe(24);
          return {
            tenantId: 't1',
            aggregateL2: 0.08,
            turnCount: 200,
            dominantDim: 'warmth',
            windowStartedAt: '2026-05-14T00:00:00Z',
          };
        },
      },
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toHaveLength(1);
    expect(goals[0]?.priority).toBe('medium');
    expect(goals[0]?.title).toContain('dim=warmth');
    expect(goals[0]?.steps[1]?.toolName).toBe(
      'platform.persona-drift-mitigation-proposed',
    );
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      severity: 'medium',
      aggregateL2: 0.08,
    });
  });

  it('0.10-0.149 → priority=high', async () => {
    const t = createPersonaDriftBreachTrigger({
      driftRead: {
        async getRecentAggregate() {
          return {
            tenantId: 't1',
            aggregateL2: 0.12,
            turnCount: 150,
            dominantDim: null,
            windowStartedAt: '2026-05-14T00:00:00Z',
          };
        },
      },
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals[0]?.priority).toBe('high');
  });

  it('0.15+ → priority=critical (also tripping per-turn ceiling)', async () => {
    const t = createPersonaDriftBreachTrigger({
      driftRead: {
        async getRecentAggregate() {
          return {
            tenantId: 't1',
            aggregateL2: 0.2,
            turnCount: 80,
            dominantDim: 'formality',
            windowStartedAt: '2026-05-14T00:00:00Z',
          };
        },
      },
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals[0]?.priority).toBe('critical');
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      severity: 'critical',
    });
  });

  it('custom aggregateL2Floor override is honoured', async () => {
    const t = createPersonaDriftBreachTrigger({
      driftRead: {
        async getRecentAggregate() {
          return {
            tenantId: 't1',
            aggregateL2: 0.05,
            turnCount: 100,
            dominantDim: null,
            windowStartedAt: '2026-05-14T00:00:00Z',
          };
        },
      },
      aggregateL2Floor: 0.04,
    });
    const goals = await t.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toHaveLength(1);
  });

  it('has stable id', () => {
    expect(createPersonaDriftBreachTrigger({}).id).toBe(
      'hq.persona-drift-breach',
    );
  });

  it('returns [] on read-port throw', async () => {
    const t = createPersonaDriftBreachTrigger({
      driftRead: {
        async getRecentAggregate() {
          throw new Error('boom');
        },
      },
    });
    expect(await t.detect({ tenantId: 't1', clock: fixedClock })).toEqual([]);
  });
});
