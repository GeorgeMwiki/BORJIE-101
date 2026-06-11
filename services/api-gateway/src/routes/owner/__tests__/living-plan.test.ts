/**
 * /api/v1/owner/living-plan — the owner-facing READ lens onto the MD living
 * plan (durable commitment ledger).
 *
 * Mounts the real Hono router against an INJECTED stub MdCommitmentRepository +
 * mocked auth/db middleware (so each endpoint runs end-to-end through
 * `app.request()`), and proves:
 *   - /summary meter math (open vs done ratio, overdue warning, empty/all-clear);
 *   - GTD partitioning across /upcoming /overdue /deferred;
 *   - the gap-segregation guard (a gap_kind!=null row is never an owner-plan
 *     item) on /:id;
 *   - tenant scope — every repository read is invoked with the auth tenantId;
 *   - 503 when the db is absent and no repository is injected.
 *
 * No real db: the repository is a deterministic stub that records the tenantId
 * it was queried with, so the tenant-scope assertion is genuinely exercised.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { UserRole } from '../../../types/user-role';
import type {
  MdCommitment,
  MdCommitmentRepository,
} from '@borjie/database/repositories';

// ── Mock auth + database middleware (hoisted). Auth/db come from globals. ────
vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const ctx = (globalThis as any).__BORJIE_LP_AUTH__;
    if (!ctx) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    c.set('auth', ctx);
    await next();
  },
}));

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (c: any, next: any) => {
    c.set('db', (globalThis as any).__BORJIE_LP_DB__ ?? null);
    await next();
  },
}));

import { Hono } from 'hono';

import { createLivingPlanRouter } from '../living-plan.hono';

// ── A deterministic commitment factory ──────────────────────────────────────
const NOW = Date.parse('2026-06-11T00:00:00.000Z');

function commitment(over: Partial<MdCommitment> & { id: string }): MdCommitment {
  return Object.freeze({
    id: over.id,
    tenantId: over.tenantId ?? 'tenant-1',
    ownerId: 'mwikila',
    threadId: null,
    class: over.class ?? 'next_action',
    kind: over.kind ?? 'general',
    title: over.title ?? `Title ${over.id}`,
    titleSw: over.titleSw ?? `Kichwa ${over.id}`,
    rationale: over.rationale ?? 'why',
    evidenceIds: over.evidenceIds ?? ['ev-1'],
    triggerKind: over.triggerKind ?? 'time',
    triggerSpec: over.triggerSpec ?? {},
    triggerDueAtMs: over.triggerDueAtMs ?? NOW + 86_400_000,
    status: over.status ?? 'scheduled',
    rungLevel: 0,
    sovereign: over.sovereign ?? false,
    lastNudgedAtMs: null,
    ackedAtMs: null,
    confirmedAtMs: over.confirmedAtMs ?? null,
    confirmationKind: over.confirmationKind ?? null,
    blockedReason: over.blockedReason ?? null,
    attemptCount: 0,
    attemptFailedCount: 0,
    gapAuditSeq: 0,
    auditChainHash: null,
    idempotencyKey: `idem-${over.id}`,
    gapKind: over.gapKind ?? null,
    blockedBy: [],
    unblockTrigger: null,
    competenceDomain: null,
    createdAtMs: over.createdAtMs ?? NOW,
    updatedAtMs: over.updatedAtMs ?? NOW,
  }) as MdCommitment;
}

/**
 * A stub repository: `listLive` returns the live set (someday/overdue carried
 * so partitioning is exercised), `get` looks up by id, `listDone` returns the
 * closed history. Every method records the tenantId it was called with so the
 * tenant-scope assertion is genuine. All mutators throw (read-only surface).
 */
function stubRepo(args: {
  live: ReadonlyArray<MdCommitment>;
  done?: ReadonlyArray<MdCommitment>;
}): {
  repository: MdCommitmentRepository & {
    listDone: (t: string, l: number) => Promise<ReadonlyArray<MdCommitment>>;
  };
  tenantsSeen: string[];
} {
  const tenantsSeen: string[] = [];
  const live = args.live;
  const done = args.done ?? [];
  const notSupported = () => {
    throw new Error('not supported in read-only stub');
  };
  const repository = {
    async listLive(tenantId: string) {
      tenantsSeen.push(tenantId);
      return live.filter((c) => c.tenantId === tenantId);
    },
    async get(tenantId: string, id: string) {
      tenantsSeen.push(tenantId);
      return (
        [...live, ...done].find(
          (c) => c.tenantId === tenantId && c.id === id,
        ) ?? null
      );
    },
    async listDone(tenantId: string, _limit: number) {
      tenantsSeen.push(tenantId);
      return done.filter((c) => c.tenantId === tenantId);
    },
    create: notSupported,
    listDueByTime: notSupported,
    listWaitingForEvent: notSupported,
    transition: notSupported,
    ack: notSupported,
    markDone: notSupported,
    reopen: notSupported,
    block: notSupported,
    createGap: notSupported,
    listOpenGaps: notSupported,
    advanceGapStatus: notSupported,
  } as unknown as MdCommitmentRepository & {
    listDone: (t: string, l: number) => Promise<ReadonlyArray<MdCommitment>>;
  };
  return { repository, tenantsSeen };
}

function mount(repository?: MdCommitmentRepository): Hono {
  const app = new Hono();
  app.route(
    '/owner/living-plan',
    createLivingPlanRouter(repository ? { repository } : {}),
  );
  return app;
}

beforeEach(() => {
  (globalThis as any).__BORJIE_LP_AUTH__ = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: UserRole.OWNER,
  };
  (globalThis as any).__BORJIE_LP_DB__ = { execute: vi.fn(async () => ({ rows: [] })) };
});

describe('GET /owner/living-plan/summary', () => {
  it('computes the health meter (open / done / overdue) and partition counts', async () => {
    const { repository, tenantsSeen } = stubRepo({
      live: [
        commitment({ id: 'a', class: 'next_action', status: 'scheduled' }),
        commitment({ id: 'b', class: 'waiting_for', status: 'open' }),
        commitment({ id: 'c', class: 'next_action', status: 'overdue' }),
        commitment({ id: 'd', class: 'someday', status: 'open' }),
      ],
      done: [
        commitment({
          id: 'e',
          status: 'done',
          confirmedAtMs: NOW,
          confirmationKind: 'ledger_entry',
        }),
      ],
    });
    const res = await mount(repository).request('/owner/living-plan/summary');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // open = live non-someday rows (a, b, c) = 3; done = 1.
    expect(body.data.health.open).toBe(3);
    expect(body.data.health.done).toBe(1);
    expect(body.data.health.overdue).toBe(1);
    expect(body.data.health.deferred).toBe(1);
    expect(body.data.health.hasOverdueWarning).toBe(true);
    // progress = done / (open + done) = 1 / 4 = 0.25.
    expect(body.data.health.progress).toBeCloseTo(0.25, 5);

    // GTD partition counts: overdue lifts c out of next_action.
    expect(body.data.counts.nextActions).toBe(1); // a only (c is overdue)
    expect(body.data.counts.waitingFor).toBe(1);
    expect(body.data.counts.overdue).toBe(1);
    expect(body.data.counts.someday).toBe(1);
    expect(body.data.counts.done).toBe(1);
    expect(body.data.empty).toBe(false);

    // Tenant scope — every read used the auth tenantId, never another tenant.
    expect(tenantsSeen.every((t) => t === 'tenant-1')).toBe(true);
  });

  it('reports an honest all-clear (progress 1, empty true) for an empty plan', async () => {
    const { repository } = stubRepo({ live: [], done: [] });
    const res = await mount(repository).request('/owner/living-plan/summary');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.empty).toBe(true);
    expect(body.data.health.progress).toBe(1);
    expect(body.data.health.hasOverdueWarning).toBe(false);
    expect(body.data.nextDueAt).toBeNull();
  });
});

describe('GET /owner/living-plan/upcoming + /overdue + /deferred', () => {
  it('partitions live rows by GTD class, lifting overdue + segregating someday', async () => {
    const { repository } = stubRepo({
      live: [
        commitment({ id: 'a', class: 'next_action', status: 'scheduled' }),
        commitment({ id: 'b', class: 'waiting_for', status: 'open' }),
        commitment({ id: 'c', class: 'tickler', status: 'scheduled' }),
        commitment({ id: 'd', class: 'next_action', status: 'overdue' }),
        commitment({ id: 'e', class: 'someday', status: 'open' }),
      ],
    });
    const app = mount(repository);

    const up = await (await app.request('/owner/living-plan/upcoming')).json();
    expect(up.data.nextActions.map((i: any) => i.id)).toEqual(['a']);
    expect(up.data.waitingFor.map((i: any) => i.id)).toEqual(['b']);
    expect(up.data.tickler.map((i: any) => i.id)).toEqual(['c']);
    expect(up.data.empty).toBe(false);

    const overdue = await (
      await app.request('/owner/living-plan/overdue')
    ).json();
    expect(overdue.data.overdue.map((i: any) => i.id)).toEqual(['d']);

    const deferred = await (
      await app.request('/owner/living-plan/deferred')
    ).json();
    expect(deferred.data.someday.map((i: any) => i.id)).toEqual(['e']);
    // Someday rows never appear in the active /upcoming plan.
    expect(up.data.nextActions.map((i: any) => i.id)).not.toContain('e');
  });

  it('honest empty state when nothing is live', async () => {
    const { repository } = stubRepo({ live: [] });
    const app = mount(repository);
    const up = await (await app.request('/owner/living-plan/upcoming')).json();
    expect(up.data.empty).toBe(true);
    const overdue = await (
      await app.request('/owner/living-plan/overdue')
    ).json();
    expect(overdue.data.empty).toBe(true);
  });
});

describe('GET /owner/living-plan/:id — gap segregation (#5)', () => {
  it('returns a commitment by id with proof-on-close fields', async () => {
    const { repository } = stubRepo({
      live: [],
      done: [
        commitment({
          id: 'done-1',
          status: 'done',
          confirmedAtMs: NOW,
          confirmationKind: 'regulator_ack',
        }),
      ],
    });
    const res = await mount(repository).request('/owner/living-plan/done-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('done-1');
    expect(body.data.confirmationKind).toBe('regulator_ack');
    expect(body.data.confirmedAt).not.toBeNull();
  });

  it('404s a capability-GAP row (gap_kind != null is never an owner-plan item)', async () => {
    const { repository } = stubRepo({
      live: [
        commitment({
          id: 'gap-1',
          gapKind: 'missing_tool',
          status: 'blocked',
        }),
      ],
    });
    const res = await mount(repository).request('/owner/living-plan/gap-1');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('COMMITMENT_NOT_FOUND');
  });

  it('404s an unknown id', async () => {
    const { repository } = stubRepo({ live: [] });
    const res = await mount(repository).request('/owner/living-plan/nope');
    expect(res.status).toBe(404);
  });
});

describe('degradation + auth', () => {
  it('503s when there is no db and no injected repository', async () => {
    (globalThis as any).__BORJIE_LP_DB__ = null;
    const res = await mount().request('/owner/living-plan/summary');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('DATABASE_UNAVAILABLE');
  });

  it('401s when unauthenticated', async () => {
    (globalThis as any).__BORJIE_LP_AUTH__ = null;
    const { repository } = stubRepo({ live: [] });
    const res = await mount(repository).request('/owner/living-plan/summary');
    expect(res.status).toBe(401);
  });
});

describe('GET /owner/living-plan/past', () => {
  it('returns the proof-carrying closed history (newest first via the stub)', async () => {
    const { repository } = stubRepo({
      live: [],
      done: [
        commitment({
          id: 'p1',
          status: 'done',
          confirmedAtMs: NOW,
          confirmationKind: 'owner_approved',
        }),
      ],
    });
    const res = await mount(repository).request('/owner/living-plan/past');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.done.map((i: any) => i.id)).toEqual(['p1']);
    expect(body.data.empty).toBe(false);
  });

  it('honest empty closed history', async () => {
    const { repository } = stubRepo({ live: [], done: [] });
    const res = await mount(repository).request('/owner/living-plan/past');
    const body = await res.json();
    expect(body.data.empty).toBe(true);
    expect(body.data.done).toEqual([]);
  });
});
