/**
 * Stage-event bus — LP-07.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createStageEventBus,
  createTurnStageEmitter,
  STAGE_ORDER,
  type StageEvent,
} from '../stage-event-bus.js';

describe('LP-07 — stage-event bus', () => {
  it('dispatches events to all subscribers in registration order', async () => {
    const bus = createStageEventBus();
    const seen: string[] = [];
    bus.subscribe((e) => {
      seen.push(`a:${e.stage}`);
    });
    bus.subscribe((e) => {
      seen.push(`b:${e.stage}`);
    });
    const emit = createTurnStageEmitter({
      bus,
      turnId: 't1',
      threadId: 'thread-1',
      tenantId: 'tenant-1',
      clock: () => 100,
    });
    await emit.intent(42);
    expect(seen).toEqual(['a:intent', 'b:intent']);
    expect(bus.emittedCount()).toBe(1);
  });

  it('assigns a monotonic per-turn seq across the lifecycle', async () => {
    const bus = createStageEventBus();
    const events: StageEvent[] = [];
    bus.subscribe((e) => {
      events.push(e);
    });
    const emit = createTurnStageEmitter({
      bus,
      turnId: 't1',
      threadId: 'thread-1',
      tenantId: null,
      clock: () => 1,
    });
    await emit.intent(10);
    await emit.megaprompt(2048);
    await emit.plan(3);
    await emit.step(1, 'lookup_royalty', 'response');
    await emit.outcome('answer', 1);
    await emit.learning('success');

    expect(events.map((e) => e.stage)).toEqual([
      'intent',
      'megaprompt',
      'plan',
      'step',
      'outcome',
      'learning',
    ]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    // Canonical stage order is respected by the emitter call sequence.
    const orders = events.map((e) => STAGE_ORDER[e.stage]);
    expect(orders).toEqual([...orders].sort((x, y) => x - y));
  });

  it('isolates a throwing subscriber and still calls the others', async () => {
    const warn = vi.fn();
    const bus = createStageEventBus({ logger: { warn } });
    const good = vi.fn();
    bus.subscribe(() => {
      throw new Error('bad sink');
    });
    bus.subscribe(good);
    const emit = createTurnStageEmitter({
      bus,
      turnId: 't1',
      threadId: 'thread-1',
      tenantId: null,
      clock: () => 1,
    });
    await emit.intent(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no bus is wired (emitter tolerates undefined bus)', async () => {
    const emit = createTurnStageEmitter({
      bus: undefined,
      turnId: 't1',
      threadId: 'thread-1',
      tenantId: null,
      clock: () => 1,
    });
    await expect(emit.outcome('answer', 0)).resolves.toBeUndefined();
  });

  it('carries typed payloads + tenant context on each event', async () => {
    const bus = createStageEventBus();
    let captured: StageEvent | null = null;
    bus.subscribe((e) => {
      if (e.stage === 'step') captured = e;
    });
    const emit = createTurnStageEmitter({
      bus,
      turnId: 't9',
      threadId: 'thread-9',
      tenantId: 'tenant-9',
      clock: () => 555,
    });
    await emit.step(2, 'file_royalty_return', 'response', { tier: 'sovereign' });
    expect(captured).not.toBeNull();
    const e = captured as unknown as Extract<StageEvent, { stage: 'step' }>;
    expect(e.stepIndex).toBe(2);
    expect(e.toolName).toBe('file_royalty_return');
    expect(e.tenantId).toBe('tenant-9');
    expect(e.at).toBe(555);
    expect(e.attributes.tier).toBe('sovereign');
  });

  it('unsubscribe stops further delivery', async () => {
    const bus = createStageEventBus();
    const sink = vi.fn();
    const off = bus.subscribe(sink);
    const emit = createTurnStageEmitter({
      bus,
      turnId: 't',
      threadId: 'th',
      tenantId: null,
      clock: () => 1,
    });
    await emit.intent(1);
    off();
    await emit.outcome('answer', 0);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
