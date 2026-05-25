/**
 * cross-portal-killswitch-fanout tests — verify the fan-out publisher
 * bridges B1's killswitch-write hook onto the composition-root
 * `CrossPortalBus` correctly, that publish failures never bubble up,
 * and that the bus is resolved exactly once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createKillswitchFanoutPublisher,
  type KillswitchEvent,
} from '../cross-portal-killswitch-fanout.js';
import {
  createInMemoryCrossPortalBus,
  globalTopic,
  tenantTopic,
  type CrossPortalBus,
  type CrossPortalEventShape,
} from '../cross-portal-bus.js';

const baseEvent = (
  overrides: Partial<KillswitchEvent> = {},
): KillswitchEvent => ({
  type: 'killswitch:changed',
  scope: 'platform',
  level: 'halt',
  reasonCode: 'COMPLIANCE_HOLD_CBK',
  setAt: '2026-05-16T10:30:00.000Z',
  ...overrides,
});

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function fakeLogger(): {
  readonly warn: (m: Record<string, unknown>, msg: string) => void;
  readonly info: (m: Record<string, unknown>, msg: string) => void;
  readonly warnings: Array<{ meta: Record<string, unknown>; msg: string }>;
  readonly infos: Array<{ meta: Record<string, unknown>; msg: string }>;
} {
  const warnings: Array<{ meta: Record<string, unknown>; msg: string }> = [];
  const infos: Array<{ meta: Record<string, unknown>; msg: string }> = [];
  return {
    warn: (meta, msg) => warnings.push({ meta, msg }),
    info: (meta, msg) => infos.push({ meta, msg }),
    warnings,
    infos,
  };
}

describe('createKillswitchFanoutPublisher — happy path', () => {
  it('publishes a state-mutation event to the global topic on the bus', async () => {
    const bus = createInMemoryCrossPortalBus();
    const received: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), (e) => received.push(e));

    const publish = createKillswitchFanoutPublisher({
      crossPortalBus: Promise.resolve(bus),
    });
    await publish(baseEvent());

    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe('state-mutation');
    expect(received[0]?.emittedBy).toBe('hq:killswitch');
    expect(received[0]?.payload).toMatchObject({
      type: 'killswitch:changed',
      scope: 'platform',
      level: 'halt',
      reasonCode: 'COMPLIANCE_HOLD_CBK',
      setAt: '2026-05-16T10:30:00.000Z',
    });
    await bus.close();
  });

  it('publishes events for tenant-scoped killswitch updates too', async () => {
    const bus = createInMemoryCrossPortalBus();
    const received: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), (e) => received.push(e));

    const publish = createKillswitchFanoutPublisher({
      crossPortalBus: Promise.resolve(bus),
    });
    await publish(
      baseEvent({
        scope: 'tenant:t_alpha',
        level: 'degraded',
        reasonCode: 'TENANT_DATA_LEAK_SUSPECTED',
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toMatchObject({
      scope: 'tenant:t_alpha',
      level: 'degraded',
      reasonCode: 'TENANT_DATA_LEAK_SUSPECTED',
    });
    await bus.close();
  });

  it('stamps emittedAt from the injected clock', async () => {
    const bus = createInMemoryCrossPortalBus();
    const received: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), (e) => received.push(e));

    const fixed = new Date('2026-05-16T12:00:00.000Z');
    const publish = createKillswitchFanoutPublisher({
      crossPortalBus: Promise.resolve(bus),
      clock: () => fixed,
    });
    await publish(baseEvent());

    expect(received[0]?.emittedAt).toBe('2026-05-16T12:00:00.000Z');
    await bus.close();
  });

  it('does NOT leak the killswitch event onto tenant topics', async () => {
    const bus = createInMemoryCrossPortalBus();
    const tenantReceived: CrossPortalEventShape[] = [];
    await bus.subscribe(tenantTopic('t_alpha'), (e) => tenantReceived.push(e));

    const publish = createKillswitchFanoutPublisher({
      crossPortalBus: Promise.resolve(bus),
    });
    await publish(baseEvent({ scope: 'tenant:t_alpha' }));

    // Killswitch fan-out is ALWAYS global — even when the scope is one
    // tenant, every brain must learn so cross-tenant reads on the same
    // gateway respect the new ceiling. Tenant subscribers must NOT
    // double-receive.
    expect(tenantReceived).toHaveLength(0);
    await bus.close();
  });
});

describe('createKillswitchFanoutPublisher — bus resolution', () => {
  it('awaits the bus promise exactly once across many publishes', async () => {
    const bus = createInMemoryCrossPortalBus();
    let resolveCount = 0;
    const busPromise = new Promise<CrossPortalBus>((resolve) => {
      resolveCount += 1;
      resolve(bus);
    });
    const received: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), (e) => received.push(e));

    const publish = createKillswitchFanoutPublisher({
      crossPortalBus: busPromise,
    });
    await publish(baseEvent());
    await publish(baseEvent());
    await publish(baseEvent());

    expect(received).toHaveLength(3);
    // Promise was constructed once; the publisher caches the resolved
    // bus internally.
    expect(resolveCount).toBe(1);
    await bus.close();
  });

  it('handles a rejected bus promise without throwing — logs once and silently no-ops thereafter', async () => {
    const logger = fakeLogger();
    const publish = createKillswitchFanoutPublisher({
      crossPortalBus: Promise.reject(new Error('redis unavailable')),
      logger,
    });

    await expect(publish(baseEvent())).resolves.toBeUndefined();
    await expect(publish(baseEvent())).resolves.toBeUndefined();

    // The bus failure is logged exactly once on first resolution; both
    // subsequent calls silently no-op.
    const busFailWarns = logger.warnings.filter((w) =>
      w.msg.includes('cross-portal bus failed to resolve'),
    );
    expect(busFailWarns.length).toBe(1);
  });

  it('does NOT throw when an individual publish() call rejects', async () => {
    const publishMock = vi.fn(async () => {
      throw new Error('redis disconnected mid-publish');
    });
    const fakeBus: CrossPortalBus = {
      publish: publishMock as never,
      subscribe: async () => async () => undefined,
      close: async () => undefined,
    };
    const logger = fakeLogger();
    const publish = createKillswitchFanoutPublisher({
      crossPortalBus: Promise.resolve(fakeBus),
      logger,
    });

    await expect(publish(baseEvent())).resolves.toBeUndefined();
    expect(publishMock).toHaveBeenCalledTimes(1);
    const failWarns = logger.warnings.filter((w) =>
      w.msg.includes('publish failed'),
    );
    expect(failWarns.length).toBe(1);
  });
});

describe('createKillswitchFanoutPublisher — defensive paths', () => {
  it('ignores a null/undefined event without invoking the bus', async () => {
    const publishMock = vi.fn(async () => undefined);
    const fakeBus: CrossPortalBus = {
      publish: publishMock as never,
      subscribe: async () => async () => undefined,
      close: async () => undefined,
    };
    const publish = createKillswitchFanoutPublisher({
      crossPortalBus: Promise.resolve(fakeBus),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((publish as any)(null)).resolves.toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((publish as any)(undefined)).resolves.toBeUndefined();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('publishes the event even when a payload field is unusual but valid', async () => {
    const bus = createInMemoryCrossPortalBus();
    const received: CrossPortalEventShape[] = [];
    await bus.subscribe(globalTopic(), (e) => received.push(e));

    const publish = createKillswitchFanoutPublisher({
      crossPortalBus: Promise.resolve(bus),
    });
    await publish(
      baseEvent({
        level: 'live',
        reasonCode: 'PROVIDER_INCIDENT',
      }),
    );

    expect(received[0]?.payload).toMatchObject({
      level: 'live',
      reasonCode: 'PROVIDER_INCIDENT',
    });
    await bus.close();
  });
});
