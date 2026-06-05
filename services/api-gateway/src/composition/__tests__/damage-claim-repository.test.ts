/**
 * damage-claim-repository — pure state-guard + negotiation-turn logic.
 *
 * These tests exercise the repository's BUSINESS rules (status transitions,
 * append-only negotiation turns, FK existence checks) against a chainable
 * Drizzle stub. They do NOT touch a real Postgres — the route-level
 * integration covers the SQL itself; here we pin the guards that protect the
 * settle / respond / approve_plan flow.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  DamageClaimRepository,
  ClaimStateError,
} from '../damage-claim-repository';

/**
 * Build a Drizzle-like stub.
 *
 *   - `selectRows`  is returned by every `.select()...limit()` chain.
 *   - `returnRow`   is returned by every `.insert()/.update()...returning()`.
 *
 * The chain methods all return `this` until the terminal awaited method
 * resolves the configured rows. `.returning()` resolves `[returnRow]`.
 */
function makeDbStub(opts: {
  selectRows?: unknown[];
  returnRow?: unknown;
}) {
  const selectRows = opts.selectRows ?? [];
  const returnRow = opts.returnRow ?? {};
  const limit = vi.fn().mockResolvedValue(selectRows);
  const returning = vi.fn().mockResolvedValue([returnRow]);
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  Object.assign(chain, {
    select: passthrough,
    from: passthrough,
    where: passthrough,
    orderBy: passthrough,
    limit,
    insert: passthrough,
    values: passthrough,
    update: passthrough,
    set: passthrough,
    returning,
  });
  return { db: chain, limit, returning };
}

describe('DamageClaimRepository — FK validation', () => {
  it('siteExists returns true when a row matches', async () => {
    const { db } = makeDbStub({ selectRows: [{ id: 'site-1' }] });
    const repo = new DamageClaimRepository(db);
    expect(await repo.siteExists('site-1', 'tenant-1')).toBe(true);
  });

  it('siteExists returns false when no row matches', async () => {
    const { db } = makeDbStub({ selectRows: [] });
    const repo = new DamageClaimRepository(db);
    expect(await repo.siteExists('nope', 'tenant-1')).toBe(false);
  });

  it('contractorExists returns false when no row matches', async () => {
    const { db } = makeDbStub({ selectRows: [] });
    const repo = new DamageClaimRepository(db);
    expect(await repo.contractorExists('nope', 'tenant-1')).toBe(false);
  });
});

describe('DamageClaimRepository — respond', () => {
  it('returns null when the claim does not exist', async () => {
    const { db } = makeDbStub({ selectRows: [] });
    const repo = new DamageClaimRepository(db);
    const res = await repo.respond('claim-x', 'tenant-1', {
      counterProposalMinor: 100,
      rationale: 'x',
      provenance: {},
      actorId: 'owner-1',
    });
    expect(res).toBeNull();
  });

  it('appends a negotiation turn and moves status to negotiating', async () => {
    const existing = {
      id: 'claim-1',
      status: 'claim_filed',
      counterProposalMinor: null,
      negotiationTurns: [
        {
          actor: 'owner',
          actorId: 'owner-1',
          proposedAmountMinor: 1000,
          rationale: 'initial',
          createdAt: '2026-06-01T00:00:00Z',
        },
      ],
    };
    const updated = { ...existing, status: 'negotiating' };
    const { db, returning } = makeDbStub({
      selectRows: [existing],
      returnRow: updated,
    });
    // `.set()` captures the update payload so we can assert the turn append.
    let captured: Record<string, unknown> = {};
    (db as Record<string, unknown>).set = (payload: Record<string, unknown>) => {
      captured = payload;
      return db;
    };
    const repo = new DamageClaimRepository(db);
    const res = await repo.respond('claim-1', 'tenant-1', {
      counterProposalMinor: 250,
      rationale: 'counter',
      provenance: { via: 'chat' },
      actorId: 'owner-1',
    });
    expect(res).toEqual(updated);
    expect(returning).toHaveBeenCalledOnce();
    expect(captured.status).toBe('negotiating');
    expect(captured.counterProposalMinor).toBe(250);
    const turns = captured.negotiationTurns as unknown[];
    expect(turns).toHaveLength(2);
  });

  it('throws ClaimStateError when the claim is already agreed', async () => {
    const existing = { id: 'claim-1', status: 'agreed', negotiationTurns: [] };
    const { db } = makeDbStub({ selectRows: [existing] });
    const repo = new DamageClaimRepository(db);
    await expect(
      repo.respond('claim-1', 'tenant-1', {
        counterProposalMinor: null,
        rationale: 'x',
        provenance: {},
        actorId: 'owner-1',
      }),
    ).rejects.toBeInstanceOf(ClaimStateError);
  });
});

describe('DamageClaimRepository — settle', () => {
  it('returns null when the claim does not exist', async () => {
    const { db } = makeDbStub({ selectRows: [] });
    const repo = new DamageClaimRepository(db);
    const res = await repo.settle('claim-x', 'tenant-1', {
      agreedAmountMinor: 100,
      notes: null,
      provenance: {},
      actorId: 'owner-1',
    });
    expect(res).toBeNull();
  });

  it('refuses to settle an already-settled claim', async () => {
    const existing = { id: 'claim-1', status: 'agreed' };
    const { db } = makeDbStub({ selectRows: [existing] });
    const repo = new DamageClaimRepository(db);
    await expect(
      repo.settle('claim-1', 'tenant-1', {
        agreedAmountMinor: 100,
        notes: null,
        provenance: {},
        actorId: 'owner-1',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_SETTLED' });
  });

  it('refuses to settle a withdrawn claim', async () => {
    const existing = { id: 'claim-1', status: 'withdrawn' };
    const { db } = makeDbStub({ selectRows: [existing] });
    const repo = new DamageClaimRepository(db);
    await expect(
      repo.settle('claim-1', 'tenant-1', {
        agreedAmountMinor: 100,
        notes: null,
        provenance: {},
        actorId: 'owner-1',
      }),
    ).rejects.toMatchObject({ code: 'CLAIM_WITHDRAWN' });
  });

  it('settles an open claim and pins the agreed amount', async () => {
    const existing = { id: 'claim-1', status: 'negotiating' };
    const updated = {
      id: 'claim-1',
      status: 'agreed',
      agreedAmountMinor: 777,
    };
    const { db } = makeDbStub({ selectRows: [existing], returnRow: updated });
    const repo = new DamageClaimRepository(db);
    const res = await repo.settle('claim-1', 'tenant-1', {
      agreedAmountMinor: 777,
      notes: 'final',
      provenance: { via: 'chat' },
      actorId: 'owner-1',
    });
    expect(res).toEqual(updated);
  });
});

describe('DamageClaimRepository — approveActionPlan', () => {
  it('returns null when the action plan does not exist', async () => {
    const { db } = makeDbStub({ selectRows: [] });
    const repo = new DamageClaimRepository(db);
    const res = await repo.approveActionPlan(
      'action-x',
      'plan-1',
      'tenant-1',
      'owner-1',
      {},
    );
    expect(res).toBeNull();
  });

  it('refuses to approve an action plan not in proposed status', async () => {
    const existing = { id: 'action-1', status: 'approved' };
    const { db } = makeDbStub({ selectRows: [existing] });
    const repo = new DamageClaimRepository(db);
    await expect(
      repo.approveActionPlan('action-1', 'plan-1', 'tenant-1', 'owner-1', {}),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('approves a proposed action plan', async () => {
    const existing = { id: 'action-1', status: 'proposed' };
    const updated = { id: 'action-1', status: 'approved' };
    const { db } = makeDbStub({ selectRows: [existing], returnRow: updated });
    const repo = new DamageClaimRepository(db);
    const res = await repo.approveActionPlan(
      'action-1',
      'plan-1',
      'tenant-1',
      'owner-1',
      { via: 'chat' },
    );
    expect(res).toEqual(updated);
  });
});
