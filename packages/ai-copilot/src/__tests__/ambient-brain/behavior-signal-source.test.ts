/**
 * createBehaviorSignalSource — unit tests.
 *
 * Central Command Phase A (C4 Brain Skin). Verifies the server-side
 * aggregator turns sensorium-event-log histograms + ribbons into the
 * derived mind-state signals the kernel consumes at memory-recall.
 */
import { describe, it, expect } from 'vitest';
import {
  createBehaviorSignalSource,
  DEFAULT_BEHAVIOR_SIGNAL_CONFIG,
  type SensoriumEventLogSource,
} from '../../ambient-brain/index.js';

function makeStubSource(
  histogram: Record<string, number>,
  rows: ReadonlyArray<{
    eventType: string;
    route: string;
    emittedAt: string;
    payload: Record<string, unknown>;
  }> = [],
): SensoriumEventLogSource & { calls: number } {
  let calls = 0;
  return {
    async countByTypeForUser() {
      calls += 1;
      return histogram;
    },
    async listForSession() {
      calls += 1;
      return rows;
    },
    get calls() {
      return calls;
    },
  } as SensoriumEventLogSource & { calls: number };
}

describe('createBehaviorSignalSource — signalsForUser()', () => {
  it('emits engagement.high above threshold', async () => {
    const src = makeStubSource({
      'page.view': 5,
      'element.click': 20,
      'scroll.depth': 4,
    });
    const sig = createBehaviorSignalSource(src);
    const out = await sig.signalsForUser({
      tenantId: 't',
      userId: 'u',
    });
    expect(out.some((s) => s.kind === 'engagement.high')).toBe(true);
  });

  it('emits engagement.low when histogram is sparse', async () => {
    const src = makeStubSource({ 'page.view': 1 });
    const sig = createBehaviorSignalSource(src);
    const out = await sig.signalsForUser({
      tenantId: 't',
      userId: 'u',
    });
    expect(out.some((s) => s.kind === 'engagement.low')).toBe(true);
  });

  it('emits frustration.detected when error.boundary spikes', async () => {
    const src = makeStubSource({
      'page.view': 3,
      'element.click': 5,
      'error.boundary': 4,
    });
    const sig = createBehaviorSignalSource(src);
    const out = await sig.signalsForUser({
      tenantId: 't',
      userId: 'u',
    });
    expect(out.some((s) => s.kind === 'frustration.detected')).toBe(true);
  });

  it('emits task.completed-without-AI when form.submit occurs without network failures', async () => {
    const src = makeStubSource({
      'page.view': 2,
      'element.click': 4,
      'form.submit': 1,
    });
    const sig = createBehaviorSignalSource(src);
    const out = await sig.signalsForUser({
      tenantId: 't',
      userId: 'u',
    });
    expect(out.some((s) => s.kind === 'task.completed-without-AI')).toBe(true);
  });

  it('returns [] on missing tenant/user', async () => {
    const src = makeStubSource({});
    const sig = createBehaviorSignalSource(src);
    expect(
      await sig.signalsForUser({ tenantId: '', userId: '' }),
    ).toEqual([]);
  });

  it('swallows upstream errors and returns []', async () => {
    const bad: SensoriumEventLogSource = {
      countByTypeForUser: async () => {
        throw new Error('boom');
      },
      listForSession: async () => {
        throw new Error('boom');
      },
    };
    const sig = createBehaviorSignalSource(bad);
    const out = await sig.signalsForUser({ tenantId: 't', userId: 'u' });
    expect(out).toEqual([]);
  });
});

describe('createBehaviorSignalSource — signalsForSession()', () => {
  it('emits dwell.deep when one route exceeds the dwell threshold', async () => {
    const src = makeStubSource({}, [
      {
        eventType: 'dwell.time',
        route: '/jarvis',
        emittedAt: new Date().toISOString(),
        payload: { dwellMs: 120_000 },
      },
      {
        eventType: 'page.view',
        route: '/jarvis',
        emittedAt: new Date().toISOString(),
        payload: { route: '/jarvis' },
      },
    ]);
    const sig = createBehaviorSignalSource(src);
    const out = await sig.signalsForSession({
      tenantId: 't',
      userId: 'u',
      sessionId: 's',
    });
    const deep = out.find((s) => s.kind === 'dwell.deep');
    expect(deep).toBeDefined();
    expect(deep?.evidence?.dwellMs).toBe(120_000);
  });

  it('does not emit dwell.deep when below threshold', async () => {
    const src = makeStubSource({}, [
      {
        eventType: 'dwell.time',
        route: '/jarvis',
        emittedAt: new Date().toISOString(),
        payload: { dwellMs: 5_000 },
      },
    ]);
    const sig = createBehaviorSignalSource(src);
    const out = await sig.signalsForSession({
      tenantId: 't',
      userId: 'u',
      sessionId: 's',
    });
    expect(out.some((s) => s.kind === 'dwell.deep')).toBe(false);
  });

  it('respects custom config', async () => {
    const src = makeStubSource({ 'page.view': 4 });
    const sig = createBehaviorSignalSource(src, {
      engagementHighThreshold: 3,
    });
    const out = await sig.signalsForUser({ tenantId: 't', userId: 'u' });
    expect(out.some((s) => s.kind === 'engagement.high')).toBe(true);
  });

  it('exposes sensible defaults', () => {
    expect(DEFAULT_BEHAVIOR_SIGNAL_CONFIG.dwellDeepMs).toBeGreaterThan(0);
    expect(
      DEFAULT_BEHAVIOR_SIGNAL_CONFIG.engagementHighThreshold,
    ).toBeGreaterThan(DEFAULT_BEHAVIOR_SIGNAL_CONFIG.engagementLowThreshold);
  });
});
