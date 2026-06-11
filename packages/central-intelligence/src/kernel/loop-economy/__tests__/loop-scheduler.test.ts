/**
 * loop-scheduler — tick + event firing, evaluate gating, ordering, retirement.
 */

import { describe, it, expect } from 'vitest';
import { createLoopRegistry } from '../loop-registry.js';
import { scheduleLoops, loopsToRetire } from '../loop-scheduler.js';
import {
  defineLoopSpec,
  type LoopActionDescriptor,
  type LoopSpec,
} from '../loop-spec.js';

const act = (over: Partial<LoopActionDescriptor> = {}): LoopActionDescriptor => ({
  actPort: 'host.act',
  autonomyTier: 'T1',
  summary: 'do',
  args: {},
  ...over,
});

const loop = (
  id: string,
  over: Partial<Parameters<typeof defineLoopSpec>[0]> = {},
): LoopSpec =>
  defineLoopSpec({
    id,
    title: id,
    trigger: { kind: 'tick', everyMs: 1000 },
    actPort: 'host.act',
    learnPort: 'host.learn',
    createdAtMs: 0,
    evaluate: () => true,
    decide: () => act(),
    ...over,
  });

describe('scheduleLoops — trigger + evaluate gating', () => {
  it('fires a tick loop whose cadence elapsed AND evaluate is true', () => {
    const reg = createLoopRegistry();
    reg.register(loop('a'));
    const out = scheduleLoops({ registry: reg, nowMs: 2000 });
    expect(out.map((f) => f.loop.id)).toEqual(['a']);
    expect(out[0]?.action).toMatchObject({ actPort: 'host.act', summary: 'do' });
  });

  it('does NOT fire a tick loop before its cadence elapses', () => {
    const reg = createLoopRegistry();
    reg.register(loop('a', { trigger: { kind: 'tick', everyMs: 5000 } }));
    expect(scheduleLoops({ registry: reg, nowMs: 1000 })).toEqual([]);
  });

  it('gates on evaluate: a due loop whose evaluate is false does not fire', () => {
    const reg = createLoopRegistry();
    reg.register(loop('a', { evaluate: () => false }));
    expect(scheduleLoops({ registry: reg, nowMs: 5000 })).toEqual([]);
  });

  it('fires an event loop only on a matching event', () => {
    const reg = createLoopRegistry();
    reg.register(loop('e', { trigger: { kind: 'event', eventType: 'ledger.posted' } }));
    // No event → no fire.
    expect(scheduleLoops({ registry: reg, nowMs: 9999 })).toEqual([]);
    // Wrong event → no fire.
    expect(
      scheduleLoops({ registry: reg, nowMs: 9999, event: { type: 'other' } }),
    ).toEqual([]);
    // Matching event → fire.
    const out = scheduleLoops({
      registry: reg,
      nowMs: 9999,
      event: { type: 'ledger.posted' },
    });
    expect(out.map((f) => f.loop.id)).toEqual(['e']);
  });

  it('passes the folded ports + event into the loop context', () => {
    const reg = createLoopRegistry();
    let seen: unknown;
    reg.register(
      loop('a', {
        evaluate: (c) => {
          seen = c.ports['k'];
          return c.event?.type === 'tick.fired';
        },
      }),
    );
    const out = scheduleLoops({
      registry: reg,
      nowMs: 5000,
      ports: { k: 42 },
      event: { type: 'tick.fired' },
    });
    expect(seen).toBe(42);
    expect(out.map((f) => f.loop.id)).toEqual(['a']);
  });

  it('observe-only firing: decide returns null → firing with null action', () => {
    const reg = createLoopRegistry();
    reg.register(loop('a', { decide: () => null }));
    const out = scheduleLoops({ registry: reg, nowMs: 5000 });
    expect(out).toHaveLength(1);
    expect(out[0]?.action).toBeNull();
  });
});

describe('scheduleLoops — ordering', () => {
  it('orders by autonomy tier (lower blast first), then efficacy desc, then id', () => {
    const reg = createLoopRegistry();
    // Same tier T1, different efficacy → higher efficacy first.
    reg.register(loop('low', { efficacy: 0.2, decide: () => act({ autonomyTier: 'T1' }) }));
    reg.register(loop('high', { efficacy: 0.9, decide: () => act({ autonomyTier: 'T1' }) }));
    // A T0 action should lead everything (safest blast radius).
    reg.register(loop('inform', { efficacy: 0.1, decide: () => act({ autonomyTier: 'T0' }) }));
    const out = scheduleLoops({ registry: reg, nowMs: 5000 });
    expect(out.map((f) => f.loop.id)).toEqual(['inform', 'high', 'low']);
  });

  it('breaks ties on loop id deterministically', () => {
    const reg = createLoopRegistry();
    reg.register(loop('b', { efficacy: 0.5 }));
    reg.register(loop('a', { efficacy: 0.5 }));
    const out = scheduleLoops({ registry: reg, nowMs: 5000 });
    expect(out.map((f) => f.loop.id)).toEqual(['a', 'b']);
  });
});

describe('scheduleLoops — honest-degrade on a throwing loop', () => {
  it('a loop whose evaluate throws is treated as "did not fire"', () => {
    const reg = createLoopRegistry();
    reg.register(
      loop('boom', {
        evaluate: () => {
          throw new Error('formed-loop bug');
        },
      }),
    );
    reg.register(loop('ok'));
    const out = scheduleLoops({ registry: reg, nowMs: 5000 });
    expect(out.map((f) => f.loop.id)).toEqual(['ok']);
  });

  it('a loop whose decide throws fires with a null action (observe-only)', () => {
    const reg = createLoopRegistry();
    reg.register(
      loop('a', {
        decide: () => {
          throw new Error('decide bug');
        },
      }),
    );
    const out = scheduleLoops({ registry: reg, nowMs: 5000 });
    expect(out).toHaveLength(1);
    expect(out[0]?.action).toBeNull();
  });
});

describe('loopsToRetire — pure retirement sweep', () => {
  it('returns loops whose retireCondition fires', () => {
    const reg = createLoopRegistry();
    reg.register(loop('stale', { retireCondition: (c) => c.nowMs > 1000 }));
    reg.register(loop('fresh', { retireCondition: () => false }));
    const out = loopsToRetire({ registry: reg, nowMs: 5000 });
    expect(out.map((l) => l.id)).toEqual(['stale']);
  });

  it('never retires on a throwing condition', () => {
    const reg = createLoopRegistry();
    reg.register(
      loop('boom', {
        retireCondition: () => {
          throw new Error('bug');
        },
      }),
    );
    expect(loopsToRetire({ registry: reg, nowMs: 5000 })).toEqual([]);
  });
});
