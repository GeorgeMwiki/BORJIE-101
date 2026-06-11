/**
 * blackboard.hono — route tests for the cross-surface CRDT state-bus front
 * door (EA-05).
 *
 * Covers:
 *   - set → read round-trips a tenant-scoped slot.
 *   - tenant A's list never contains tenant B's slot (the tenant comes from
 *     the JWT, the store is keyed by tenant — a tenant can't read another's).
 *   - handoff re-projects a live slot onto another surface.
 *   - missing tenant context → 400.
 *
 * The auth middleware is mocked to inject a configurable (tenant, user) so the
 * route's tenant-scoping is exercised without a real JWT. The slot services
 * are injected via `__setSlotServicesForTests` (in-memory repo + realtime).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMiddleware } from 'hono/factory';

// The (tenant, user) the mocked auth middleware injects per test.
let authCtx: { tenantId: string; userId: string } = {
  tenantId: 'tnt_a',
  userId: 'u1',
};

vi.mock('../../middleware/hono-auth', () => ({
  authMiddleware: createMiddleware(async (c, next) => {
    c.set('auth', { tenantId: authCtx.tenantId, userId: authCtx.userId });
    c.set('tenantId', authCtx.tenantId);
    c.set('userId', authCtx.userId);
    await next();
  }),
}));

import { blackboardRouter } from '../blackboard.hono.js';
import { __setSlotServicesForTests } from '../../composition/blackboard-slots-wiring.js';
import {
  createInMemorySlotsRepository,
  createSlotStore,
  createHandoffService,
} from '@borjie/blackboard-sota';
import { createInMemoryRealtime } from '@borjie/realtime-adapter';

function installInMemoryServices() {
  const repository = createInMemorySlotsRepository();
  const realtime = createInMemoryRealtime();
  const store = createSlotStore({ repository, realtime, surface: 'chat' });
  const handoff = createHandoffService({ repository, realtime });
  __setSlotServicesForTests({ store, handoff, repository } as never);
}

async function postJson(path: string, body: unknown) {
  return blackboardRouter.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  return blackboardRouter.request(path, {
    headers: { authorization: 'Bearer x' },
  });
}

describe('blackboard.hono — tenant-scoped slot bus', () => {
  beforeEach(() => {
    authCtx = { tenantId: 'tnt_a', userId: 'u1' };
    installInMemoryServices();
  });

  it('POST /slots → GET /slots/:id round-trips a slot', async () => {
    const setRes = await postJson('/slots', {
      slotId: 'incident:KAH-088:decision',
      slotKind: 'decision',
      value: { status: 'approved' },
      surface: 'owner-web',
    });
    expect(setRes.status).toBe(200);
    const setBody = (await setRes.json()) as { data: { value: unknown } };
    expect(setBody.data.value).toEqual({ status: 'approved' });

    const readRes = await get('/slots/incident:KAH-088:decision');
    expect(readRes.status).toBe(200);
    const readBody = (await readRes.json()) as { data: { value: unknown } };
    expect(readBody.data.value).toEqual({ status: 'approved' });
  });

  it('tenant A cannot list tenant B slots', async () => {
    // Tenant A writes a slot.
    authCtx = { tenantId: 'tnt_a', userId: 'u1' };
    await postJson('/slots', {
      slotId: 'deal:A',
      slotKind: 'note',
      value: { who: 'A' },
      surface: 'owner-web',
    });
    // Tenant B writes a slot (same store, different tenant id).
    authCtx = { tenantId: 'tnt_b', userId: 'u2' };
    await postJson('/slots', {
      slotId: 'deal:B',
      slotKind: 'note',
      value: { who: 'B' },
      surface: 'owner-web',
    });

    // Tenant B lists — sees ONLY its own slot.
    const resB = await get('/slots?slotKind=note');
    const bodyB = (await resB.json()) as { data: Array<{ slotId: string; tenantId: string }> };
    expect(bodyB.data).toHaveLength(1);
    expect(bodyB.data[0]?.slotId).toBe('deal:B');
    expect(bodyB.data.every((s) => s.tenantId === 'tnt_b')).toBe(true);

    // Tenant A reading tenant B's slot id returns 404 (scoped read).
    authCtx = { tenantId: 'tnt_a', userId: 'u1' };
    const crossRead = await get('/slots/deal:B');
    expect(crossRead.status).toBe(404);
  });

  it('POST /handoff re-projects a live slot onto another surface', async () => {
    await postJson('/slots', {
      slotId: 'task:42',
      slotKind: 'task',
      value: { step: 1 },
      surface: 'chat',
    });
    const res = await postJson('/handoff', {
      slotId: 'task:42',
      fromSurface: 'chat',
      toSurface: 'workforce-mobile',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { toSurface: string; provenance: string[]; slot: { value: unknown } };
    };
    expect(body.data.toSurface).toBe('workforce-mobile');
    expect(body.data.provenance).toEqual(['chat', 'workforce-mobile']);
    // Same live value — lives once.
    expect(body.data.slot.value).toEqual({ step: 1 });
  });

  it('missing tenant context → 400', async () => {
    authCtx = { tenantId: '', userId: 'u1' };
    const res = await postJson('/slots', {
      slotId: 's',
      slotKind: 'note',
      value: { a: 1 },
      surface: 'owner-web',
    });
    expect(res.status).toBe(400);
  });
});
