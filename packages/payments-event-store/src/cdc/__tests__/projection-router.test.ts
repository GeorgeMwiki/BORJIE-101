/**
 * CDC projection router regression (LP-20b).
 *
 * Locks the contract:
 *   - malformed payloads silently dropped + counted (no throw)
 *   - consumer filters by table / op / tenant
 *   - errors in one consumer don't break the dispatch loop
 *   - unsubscribe removes a consumer
 *   - stop() is idempotent + drains the injected transport
 *   - custom allowed-tables widen the surface without code edits
 *   - fully testable with NO Postgres (transport is injected)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createProjectionRouter,
  startProjectionStream,
  type ProjectionStreamDeps,
} from '../projection-router.js';
import { eventMatches, parseCdcPayload, type CdcEvent } from '../types.js';

function payload(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    table: 'ledger_entries',
    op: 'INSERT',
    id: 'le-1',
    tenant_id: 't-1',
    ts: 1_700_000_000,
    ...over,
  });
}

describe('parseCdcPayload', () => {
  it('parses a well-formed money-spine payload', () => {
    const e = parseCdcPayload(payload());
    expect(e).not.toBeNull();
    expect(e?.table).toBe('ledger_entries');
    expect(e?.tenantId).toBe('t-1');
    expect(e?.op).toBe('INSERT');
  });

  it('returns null on garbage JSON', () => {
    expect(parseCdcPayload('not-json')).toBeNull();
  });

  it('returns null on an unknown table (default allow-set)', () => {
    expect(parseCdcPayload(payload({ table: 'mystery' }))).toBeNull();
  });

  it('returns null on an unknown op', () => {
    expect(parseCdcPayload(payload({ op: 'REPLACE' }))).toBeNull();
  });

  it('returns null on a missing required field', () => {
    expect(parseCdcPayload(JSON.stringify({ table: 'ledger_entries', op: 'INSERT' }))).toBeNull();
  });

  it('accepts a table only when present in a custom allow-set', () => {
    expect(parseCdcPayload(payload({ table: 'royalty_runs' }))).toBeNull();
    expect(
      parseCdcPayload(payload({ table: 'royalty_runs' }), ['royalty_runs']),
    ).not.toBeNull();
  });
});

describe('eventMatches', () => {
  const e: CdcEvent = {
    table: 'payment_intents',
    op: 'UPDATE',
    id: 'pi-1',
    tenantId: 't-1',
    ts: 1,
  };

  it('matches when filters are empty', () => {
    expect(eventMatches({ id: 'c', onEvent: () => undefined }, e)).toBe(true);
  });

  it('filters by table', () => {
    expect(eventMatches({ id: 'c', tables: ['payment_intents'], onEvent: () => undefined }, e)).toBe(true);
    expect(eventMatches({ id: 'c', tables: ['ledger_entries'], onEvent: () => undefined }, e)).toBe(false);
  });

  it('filters by operation', () => {
    expect(eventMatches({ id: 'c', operations: ['UPDATE'], onEvent: () => undefined }, e)).toBe(true);
    expect(eventMatches({ id: 'c', operations: ['DELETE'], onEvent: () => undefined }, e)).toBe(false);
  });

  it('filters by tenant', () => {
    expect(eventMatches({ id: 'c', tenants: ['t-1'], onEvent: () => undefined }, e)).toBe(true);
    expect(eventMatches({ id: 'c', tenants: ['t-99'], onEvent: () => undefined }, e)).toBe(false);
  });
});

describe('createProjectionRouter', () => {
  const event: CdcEvent = { table: 'ledger_entries', op: 'INSERT', id: 'x', tenantId: 't-1', ts: 1 };

  it('dispatches to matching consumers and counts', async () => {
    const router = createProjectionRouter();
    const hits: string[] = [];
    router.register({ id: 'a', tables: ['ledger_entries'], onEvent: () => void hits.push('a') });
    router.register({ id: 'b', tables: ['payment_intents'], onEvent: () => void hits.push('b') });

    await router.dispatch(event);

    expect(hits).toEqual(['a']);
    const stats = router.stats();
    expect(stats.received).toBe(1);
    expect(stats.dispatched).toBe(1);
  });

  it('isolates a throwing consumer from the others', async () => {
    const router = createProjectionRouter();
    const seen: string[] = [];
    router.register({
      id: 'bad',
      onEvent: () => {
        throw new Error('boom');
      },
    });
    router.register({ id: 'good', onEvent: () => void seen.push('good') });

    await router.dispatch(event);

    expect(seen).toEqual(['good']);
    expect(router.stats().errors).toBe(1);
    expect(router.stats().dispatched).toBe(1);
  });

  it('unsubscribe removes a consumer', async () => {
    const router = createProjectionRouter();
    let count = 0;
    const off = router.register({ id: 'a', onEvent: () => void (count += 1) });
    await router.dispatch(event);
    off();
    await router.dispatch(event);
    expect(count).toBe(1);
    expect(router.consumerCount()).toBe(0);
  });
});

describe('startProjectionStream', () => {
  it('wires an injected transport, routes events, and counts malformed', async () => {
    let emit: (raw: string) => void = () => undefined;
    const stop = vi.fn(async () => undefined);
    const deps: ProjectionStreamDeps = {
      subscribe: async (onPayload) => {
        emit = onPayload;
        return stop;
      },
    };

    const { router, handle } = await startProjectionStream(deps);
    const received: CdcEvent[] = [];
    router.register({ id: 'sink', onEvent: (e) => void received.push(e) });

    emit(payload({ id: 'le-1' }));
    emit('garbage');
    emit(payload({ id: 'le-2', op: 'UPDATE' }));
    // allow the async dispatch microtasks to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(received.map((e) => e.id)).toEqual(['le-1', 'le-2']);
    expect(handle.stats().malformed).toBe(1);
    expect(handle.stats().dispatched).toBe(2);

    await handle.stop();
    await handle.stop(); // idempotent
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('ignores events received after stop()', async () => {
    let emit: (raw: string) => void = () => undefined;
    const deps: ProjectionStreamDeps = {
      subscribe: async (onPayload) => {
        emit = onPayload;
        return async () => undefined;
      },
    };
    const { router, handle } = await startProjectionStream(deps);
    let count = 0;
    router.register({ id: 's', onEvent: () => void (count += 1) });

    await handle.stop();
    emit(payload());
    await new Promise((r) => setTimeout(r, 0));
    expect(count).toBe(0);
  });
});
