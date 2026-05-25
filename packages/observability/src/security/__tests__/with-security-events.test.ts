/**
 * Unit tests for the `withSecurityEvents` HOF, the Hono-style
 * `securityEventsMiddleware`, and the `recordSecurityEvent` direct
 * emit helper.
 *
 * NOTE: P72's CR-2 fix restored the canonical binding-first signature
 * `withSecurityEvents(binding, handler)` (was handler-first in a
 * transient pre-merge branch). These tests target the canonical
 * binding-first API; the sink registry is used to capture emitted
 * `SecurityEvent`s without depending on the audit-store query path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  withSecurityEvents,
  securityEventsMiddleware,
  recordSecurityEvent,
  setSecurityEventSink,
  resetSecurityEventSink,
  type AuditableContext,
  type SecurityEvent,
} from '../with-security-events.js';
import { initAuditLogger } from '../../audit-logger.js';
import { MemoryAuditStore } from '../../audit/memory-audit-store.js';

function makeCtx(opts: {
  method: string;
  path: string;
  status?: number;
  auth?: Record<string, unknown>;
}): AuditableContext {
  const store = new Map<string, unknown>();
  store.set('auth', opts.auth ?? { userId: 'u-1', roles: ['admin'] });
  return {
    req: {
      method: opts.method,
      path: opts.path,
      header: (n: string) =>
        n.toLowerCase() === 'user-agent' ? 'test-agent/1.0' : undefined,
    },
    res: { status: opts.status ?? 200 },
    get(key: string) {
      return store.get(key);
    },
  };
}

/**
 * Test helper — install a capturing sink so the tests can assert on
 * emitted SecurityEvents directly without leaning on the audit-store
 * query path (which is only fed by the middleware route, not the HOF).
 */
function installCapturingSink(): { events: SecurityEvent[] } {
  const events: SecurityEvent[] = [];
  setSecurityEventSink((evt) => {
    events.push(evt);
  });
  return { events };
}

describe('withSecurityEvents (binding-first HOF)', () => {
  let captured: { events: SecurityEvent[] };

  beforeEach(() => {
    initAuditLogger({ store: new MemoryAuditStore() });
    captured = installCapturingSink();
  });

  afterEach(() => {
    resetSecurityEventSink();
  });

  it('emits a SecurityEvent for POST', async () => {
    const handler = withSecurityEvents(
      { action: 'property.create', resource: 'property', severity: 'info' },
      async (c) => {
        (c.res as { status: number }).status = 201;
        return { ok: true };
      },
    );
    await handler(makeCtx({ method: 'POST', path: '/api/v1/properties' }));
    expect(captured.events.length).toBe(1);
    expect(captured.events[0].errored).toBe(false);
    expect(captured.events[0].responseStatus).toBe(201);
    expect(captured.events[0].action).toBe('property.create');
    expect(captured.events[0].method).toBe('POST');
  });

  it('still emits for GET (HOF is per-handler, mutating-vs-read filter lives in the middleware)', async () => {
    // The HOF version is opt-in per route — read endpoints simply don't
    // wrap themselves. The verb-based skip is the middleware's job.
    const handler = withSecurityEvents(
      { action: 'property.list', resource: 'property' },
      async () => ({ ok: true }),
    );
    await handler(makeCtx({ method: 'GET', path: '/api/v1/properties' }));
    expect(captured.events.length).toBe(1);
    expect(captured.events[0].method).toBe('GET');
  });

  it('records 403 response status', async () => {
    const handler = withSecurityEvents(
      { action: 'user.delete', resource: 'user', severity: 'warn' },
      async (c) => {
        (c.res as { status: number }).status = 403;
        return { ok: false };
      },
    );
    await handler(
      makeCtx({ method: 'DELETE', path: '/api/v1/users/u-9', status: 403 }),
    );
    expect(captured.events.length).toBe(1);
    expect(captured.events[0].responseStatus).toBe(403);
    expect(captured.events[0].errored).toBe(false);
  });

  it('classifies thrown error as errored with 500 status', async () => {
    const handler = withSecurityEvents(
      { action: 'lease.update', resource: 'lease' },
      async () => {
        throw new Error('boom');
      },
    );
    await expect(
      handler(makeCtx({ method: 'PATCH', path: '/api/v1/leases/abc' })),
    ).rejects.toThrow('boom');
    expect(captured.events.length).toBe(1);
    expect(captured.events[0].errored).toBe(true);
    expect(captured.events[0].responseStatus).toBe(500);
    expect(captured.events[0].detail.errorMessage).toBe('boom');
  });

  it('captures extractDetail output in the event detail', async () => {
    const handler = withSecurityEvents(
      {
        action: 'property.create',
        resource: 'property',
        extractDetail: (_ctx, result) => ({
          propertyId: (result as { id: string }).id,
        }),
      },
      async () => ({ id: 'prop-123' }),
    );
    await handler(makeCtx({ method: 'POST', path: '/api/v1/properties' }));
    expect(captured.events[0].detail.propertyId).toBe('prop-123');
  });

  it('never blocks the request when the sink throws', async () => {
    let sinkCallCount = 0;
    setSecurityEventSink(() => {
      sinkCallCount += 1;
      throw new Error('sink down');
    });
    const handler = withSecurityEvents(
      { action: 'x.create', resource: 'x' },
      async () => ({ ok: true }),
    );
    const out = await handler(makeCtx({ method: 'POST', path: '/api/v1/x' }));
    expect(out).toEqual({ ok: true });
    expect(sinkCallCount).toBe(1);
  });
});

describe('securityEventsMiddleware', () => {
  let captured: { events: SecurityEvent[] };

  beforeEach(() => {
    initAuditLogger({ store: new MemoryAuditStore() });
    captured = installCapturingSink();
  });

  afterEach(() => {
    resetSecurityEventSink();
  });

  it('passes through GET without emit', async () => {
    let nextCalled = false;
    await securityEventsMiddleware(
      makeCtx({ method: 'GET', path: '/foo' }),
      async () => {
        nextCalled = true;
      },
    );
    expect(nextCalled).toBe(true);
    // Yield once so any microtasks (we void emit) settle.
    await new Promise((r) => setTimeout(r, 5));
    expect(captured.events.length).toBe(0);
  });

  it('emits on POST', async () => {
    await securityEventsMiddleware(
      makeCtx({ method: 'POST', path: '/foo', status: 200 }),
      async () => {},
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(captured.events.length).toBe(1);
    expect(captured.events[0].method).toBe('POST');
  });

  it('classifies 403 as DENIED via reason detail', async () => {
    await securityEventsMiddleware(
      makeCtx({ method: 'DELETE', path: '/api/v1/users/u-9', status: 403 }),
      async () => {},
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(captured.events.length).toBe(1);
    expect(captured.events[0].detail.reason).toBe('DENIED');
    expect(captured.events[0].severity).toBe('warn');
  });

  it('does not throw when the audit logger sink fails', async () => {
    initAuditLogger({
      store: {
        async store() {
          throw new Error('sink down');
        },
        async storeBatch() {
          throw new Error('sink down');
        },
        async query() {
          return { events: [], total: 0, offset: 0, limit: 10, hasMore: false };
        },
        async getById() {
          return null;
        },
        async getByTarget() {
          return { events: [], total: 0, offset: 0, limit: 10, hasMore: false };
        },
        async getByActor() {
          return { events: [], total: 0, offset: 0, limit: 10, hasMore: false };
        },
        async healthCheck() {
          return true;
        },
        async close() {},
      },
    });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      securityEventsMiddleware(
        makeCtx({ method: 'POST', path: '/api/v1/x' }),
        async () => {},
      ),
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
    consoleWarn.mockRestore();
  });
});

describe('recordSecurityEvent', () => {
  let captured: { events: SecurityEvent[] };

  beforeEach(() => {
    captured = installCapturingSink();
  });

  afterEach(() => {
    resetSecurityEventSink();
  });

  it('emits an event with the supplied binding shape', async () => {
    await recordSecurityEvent({
      action: 'webhook.signature_mismatch',
      resource: 'webhook',
      severity: 'warn',
      method: 'POST',
      route: '/api/v1/admin/x',
      tenantId: 'tenant-7',
      detail: { reason: 'webhook signature mismatch' },
    });
    expect(captured.events.length).toBe(1);
    expect(captured.events[0].action).toBe('webhook.signature_mismatch');
    expect(captured.events[0].severity).toBe('warn');
    expect(captured.events[0].tenantId).toBe('tenant-7');
    expect(captured.events[0].detail.reason).toBe('webhook signature mismatch');
  });

  it('swallows sink errors (never propagates)', async () => {
    setSecurityEventSink(() => {
      throw new Error('sink down');
    });
    await expect(
      recordSecurityEvent({
        action: 'x.y',
        resource: 'x',
      }),
    ).resolves.toBeUndefined();
  });
});
