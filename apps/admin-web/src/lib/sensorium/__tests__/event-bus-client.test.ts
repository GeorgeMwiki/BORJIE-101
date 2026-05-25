/**
 * event-bus-client — unit tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SensoriumBus } from '../event-bus-client';

function makeBus(extra: Partial<ConstructorParameters<typeof SensoriumBus>[0]> = {}): {
  bus: SensoriumBus;
  fetchImpl: ReturnType<typeof vi.fn>;
} {
  const fetchImpl = vi.fn(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  const bus = new SensoriumBus({
    sessionId: 's1',
    surface: 'test',
    flushIntervalMs: 100_000, // never auto-flush during sync tests
    maxBatchSize: 5,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...extra,
  });
  return { bus, fetchImpl };
}

describe('SensoriumBus', () => {
  it('buffers events and reports them via __peek()', () => {
    const { bus } = makeBus();
    bus.emit({
      eventType: 'page.view',
      route: '/x',
      emittedAt: new Date().toISOString(),
      payload: {},
    });
    expect(bus.__peek()).toHaveLength(1);
  });

  it('drops events with unknown eventType', () => {
    const { bus } = makeBus();
    bus.emit({
      eventType: 'mouse.move' as never,
      route: '/x',
      emittedAt: new Date().toISOString(),
      payload: {},
    });
    expect(bus.__peek()).toHaveLength(0);
  });

  it('flushes at max batch size', async () => {
    const { bus, fetchImpl } = makeBus();
    for (let i = 0; i < 5; i += 1) {
      bus.emit({
        eventType: 'element.click',
        route: '/x',
        emittedAt: new Date().toISOString(),
        payload: {},
      });
    }
    // Flush is queued via void — await microtasks.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('POSTs the expected envelope to /api/v1/sensorium/events', async () => {
    const { bus, fetchImpl } = makeBus();
    bus.emit({
      eventType: 'page.view',
      route: '/x',
      emittedAt: 'now',
      payload: { route: '/x' },
    });
    await bus.flush();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = (fetchImpl.mock.calls[0]?.[0] ?? '') as string;
    expect(url).toContain('/api/v1/sensorium/events');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const body = JSON.parse(String(init.body)) as {
      sessionId: string;
      surface: string;
      batch: unknown[];
    };
    expect(body.sessionId).toBe('s1');
    expect(body.batch).toHaveLength(1);
  });

  it('swallows fetch failures (side channel)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network');
    });
    const bus = new SensoriumBus({
      sessionId: 's1',
      surface: 'test',
      flushIntervalMs: 100_000,
      maxBatchSize: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    bus.emit({
      eventType: 'page.view',
      route: '/x',
      emittedAt: 'now',
      payload: {},
    });
    await expect(bus.flush()).resolves.toBeUndefined();
  });

  it('caps queue depth at 4× maxBatchSize', () => {
    const { bus } = makeBus({ maxBatchSize: 3 });
    for (let i = 0; i < 100; i += 1) {
      bus.emit({
        eventType: 'element.click',
        route: '/x',
        emittedAt: 'now',
        payload: { i },
      });
    }
    expect(bus.__peek().length).toBeLessThanOrEqual(12);
  });
});
