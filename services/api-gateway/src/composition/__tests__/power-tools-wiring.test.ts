/**
 * power-tools-wiring — durable schedule adapter suite.
 *
 * Proves the three contract guarantees of the Inngest-backed `schedule`
 * power-tool wiring:
 *
 *  (1) DURABLE ENQUEUE — `createInngestScheduleAdapter(client).schedule(record)`
 *      calls `client.send` with `name === POWER_TOOL_SCHEDULED_EVENT`, the full
 *      record (incl. generated `scheduledId`) in `data`, and `id ===
 *      scheduledId` (idempotency), and returns the full `ScheduledCallRecord`.
 *      On `send` throw it RETHROWS (honest-degrade — nothing persisted).
 *
 *  (2) CI-INERTNESS — with Inngest disabled (no `INNGEST_EVENT_KEY`),
 *      `getPowerToolRegistry()` builds successfully on the in-memory default
 *      and never throws; the `schedule` tool is registered + reachable.
 *
 *  (3) FIRING FUNCTION — the function handler (mock step + mock registry)
 *      sleeps until `runAtIso` THEN calls `registry.invoke` with the ctx
 *      reconstructed from the event (tenant / tier / caller / thread), refuses
 *      recursive `schedule` / `compose`, and returns null when `createFunction`
 *      is absent.
 *
 * No real Inngest, no Postgres — the client + registry are stubbed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createInngestScheduleAdapter,
  POWER_TOOL_SCHEDULED_EVENT,
} from '../power-tool-schedule-adapter.js';
import { createPowerToolScheduledCallFunction } from '../durable/inngest-functions/power-tool-scheduled-call.fn.js';
import {
  getPowerToolRegistry,
  __resetPowerToolRegistryForTests,
} from '../power-tools-wiring.js';
import type { InngestClientLike } from '../durable/inngest-client.js';
import type { powerTools } from '@borjie/central-intelligence';

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function makeStubClient(): {
  client: InngestClientLike;
  sent: Array<{ name: string; data: Record<string, unknown>; id?: string }>;
} {
  const sent: Array<{ name: string; data: Record<string, unknown>; id?: string }> = [];
  return {
    sent,
    client: {
      id: 'test-app',
      async send(event) {
        sent.push({ name: event.name, data: event.data, id: event.id });
        return { ids: [`ing-${sent.length}`] };
      },
    },
  };
}

const baseRecord: Omit<powerTools.ScheduledCallRecord, 'scheduledId'> = {
  toolName: 'blackboard_stream',
  toolArgs: { channel: 'progress', message: 'tick' },
  runAtIso: '2099-01-01T00:00:00.000Z',
  maxAttempts: 3,
  originalCallerId: 'owner-1',
  originalTier: 'estate-manager',
  tenantId: 'tenant-1',
  threadId: 'thread-1',
};

// ─────────────────────────────────────────────────────────────────────
// (1) DURABLE ENQUEUE
// ─────────────────────────────────────────────────────────────────────

describe('createInngestScheduleAdapter — durable enqueue', () => {
  it('sends POWER_TOOL_SCHEDULED_EVENT with the record + id===scheduledId', async () => {
    const { client, sent } = makeStubClient();
    const adapter = createInngestScheduleAdapter(client, noopLogger);

    const record = await adapter.schedule(baseRecord);

    expect(record.scheduledId).toMatch(/^sched-/);
    expect(record.toolName).toBe('blackboard_stream');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe(POWER_TOOL_SCHEDULED_EVENT);
    expect(sent[0]?.id).toBe(record.scheduledId);
    expect(sent[0]?.data.scheduledId).toBe(record.scheduledId);
    expect(sent[0]?.data.toolName).toBe('blackboard_stream');
    expect(sent[0]?.data.tenantId).toBe('tenant-1');
    expect(sent[0]?.data.originalTier).toBe('estate-manager');
    expect(sent[0]?.data.runAtIso).toBe('2099-01-01T00:00:00.000Z');
  });

  it('rethrows on send failure (honest-degrade — nothing persisted)', async () => {
    const client: InngestClientLike = {
      id: 'test-app',
      async send() {
        throw new Error('inngest network down');
      },
    };
    const adapter = createInngestScheduleAdapter(client, noopLogger);
    await expect(adapter.schedule(baseRecord)).rejects.toThrow(
      /inngest network down/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// (2) CI-INERTNESS — registry builds on the in-memory default
// ─────────────────────────────────────────────────────────────────────

describe('getPowerToolRegistry — CI-inert in-memory default', () => {
  const prevKey = process.env.INNGEST_EVENT_KEY;

  beforeEach(() => {
    delete process.env.INNGEST_EVENT_KEY;
    __resetPowerToolRegistryForTests();
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = prevKey;
    __resetPowerToolRegistryForTests();
  });

  it('builds successfully and registers schedule when Inngest is disabled', () => {
    const registry = getPowerToolRegistry();
    expect(registry).toBeTruthy();
    expect(registry.get('schedule')).not.toBeNull();
    // Stable singleton — second call returns the same instance.
    expect(getPowerToolRegistry()).toBe(registry);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (3) FIRING FUNCTION
// ─────────────────────────────────────────────────────────────────────

interface CapturedInvoke {
  readonly id: string;
  readonly args: unknown;
  readonly ctx: powerTools.PowerToolContext;
}

function makeMockRegistry(captured: CapturedInvoke[]): powerTools.PowerToolRegistry {
  return {
    register: () => undefined,
    get: () => null,
    list: () => [],
    listForTier: () => [],
    clear: () => undefined,
    async invoke(id, args, ctx) {
      captured.push({ id, args, ctx });
      return { kind: 'ok', output: {} } as never;
    },
  };
}

interface CapturedFn {
  cfg: { id: string; name: string };
  trigger: { event: string };
  handler: (ctx: unknown) => Promise<unknown>;
}

type CreateFnClient = InngestClientLike & {
  createFunction: (cfg: unknown, trigger: unknown, handler: unknown) => unknown;
};

class FnHarness {
  captured: CapturedFn | null = null;
  readonly client: CreateFnClient;
  constructor() {
    this.client = {
      id: 'test-app',
      send: async () => ({ ids: [] }),
      createFunction: (cfg, trigger, handler) => {
        this.captured = {
          cfg: cfg as { id: string; name: string },
          trigger: trigger as { event: string },
          handler: handler as (ctx: unknown) => Promise<unknown>,
        };
        return { id: (cfg as { id: string }).id };
      },
    };
  }
}

function makeClientWithCreateFunction(): FnHarness {
  return new FnHarness();
}

describe('createPowerToolScheduledCallFunction — firing function', () => {
  it('returns null when client does not expose createFunction', () => {
    const client: InngestClientLike = {
      id: 'no-create-fn',
      async send() {
        return { ids: [] };
      },
    };
    const fn = createPowerToolScheduledCallFunction({
      client,
      registry: makeMockRegistry([]),
      db: null,
      logger: noopLogger,
    });
    expect(fn).toBeNull();
  });

  it('registers under the canonical event + id', () => {
    const harness = makeClientWithCreateFunction();
    const fn = createPowerToolScheduledCallFunction({
      client: harness.client,
      registry: makeMockRegistry([]),
      db: null,
      logger: noopLogger,
    });
    expect(fn).not.toBeNull();
    expect(harness.captured?.cfg.id).toBe('power-tool-scheduled-call');
    expect(harness.captured?.trigger.event).toBe(POWER_TOOL_SCHEDULED_EVENT);
  });

  it('sleeps until runAtIso then invokes the registry with the reconstructed ctx', async () => {
    const harness = makeClientWithCreateFunction();
    const captured: CapturedInvoke[] = [];
    createPowerToolScheduledCallFunction({
      client: harness.client,
      registry: makeMockRegistry(captured),
      db: { __fake: true },
      logger: noopLogger,
    });

    const sleepCalls: Array<{ id: string; until: string }> = [];
    const runIds: string[] = [];
    const step = {
      async sleepUntil(id: string, until: string) {
        sleepCalls.push({ id, until });
      },
      async run<T>(id: string, f: () => Promise<T>): Promise<T> {
        runIds.push(id);
        return f();
      },
    };

    const handler = harness.captured!.handler;
    const result = (await handler({
      event: {
        data: {
          scheduledId: 'sched-abc',
          toolName: 'blackboard_stream',
          toolArgs: { channel: 'progress' },
          runAtIso: '2099-01-01T00:00:00.000Z',
          maxAttempts: 3,
          originalCallerId: 'owner-1',
          originalTier: 'estate-manager',
          tenantId: 'tenant-1',
          threadId: 'thread-1',
        },
      },
      step,
    })) as { dispatched: boolean };

    // Sleep happened BEFORE dispatch.
    expect(sleepCalls).toEqual([
      { id: 'wait-until-runat', until: '2099-01-01T00:00:00.000Z' },
    ]);
    expect(runIds).toEqual(['dispatch']);
    expect(result.dispatched).toBe(true);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.id).toBe('blackboard_stream');
    expect(captured[0]?.args).toEqual({ channel: 'progress' });
    // ctx reconstructed from the persisted record — NOT from anything fresh.
    expect(captured[0]?.ctx.callerId).toBe('owner-1');
    expect(captured[0]?.ctx.tier).toBe('estate-manager');
    expect(captured[0]?.ctx.tenantId).toBe('tenant-1');
    expect(captured[0]?.ctx.threadId).toBe('thread-1');
    expect(captured[0]?.ctx.approvalRecordId).toBeNull();
    // db present → real audit sink rebuilt (non-null).
    expect(captured[0]?.ctx.auditSink).not.toBeNull();
  });

  it('refuses to fire a recursive schedule / compose call', async () => {
    const harness = makeClientWithCreateFunction();
    const captured: CapturedInvoke[] = [];
    createPowerToolScheduledCallFunction({
      client: harness.client,
      registry: makeMockRegistry(captured),
      db: null,
      logger: noopLogger,
    });
    const handler = harness.captured!.handler;

    const step = {
      async sleepUntil() {
        throw new Error('must not sleep — recursion refused before any wait');
      },
      async run<T>(_id: string, f: () => Promise<T>): Promise<T> {
        return f();
      },
    };

    for (const toolName of ['schedule', 'power_tool.schedule', 'compose', 'power_tool.compose']) {
      const result = (await handler({
        event: {
          data: {
            scheduledId: 'sched-rec',
            toolName,
            toolArgs: {},
            runAtIso: '2099-01-01T00:00:00.000Z',
            maxAttempts: 3,
            originalCallerId: 'owner-1',
            originalTier: 'estate-manager',
            tenantId: 'tenant-1',
            threadId: 'thread-1',
          },
        },
        step,
      })) as { dispatched: boolean; reason?: string };
      expect(result.dispatched).toBe(false);
      expect(result.reason).toBe('recursive-dispatch-refused');
    }
    expect(captured).toHaveLength(0);
  });
});
