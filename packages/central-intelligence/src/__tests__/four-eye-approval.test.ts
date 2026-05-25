/**
 * Four-eye approval gate — unit tests.
 *
 * Covers:
 *   - propose() creates a 'pending' record with TTL and unique id
 *   - first approve → 'one-eye'; second approve by different user → 'approved'
 *   - rejection short-circuits to 'rejected'
 *   - proposer cannot self-approve
 *   - same approver cannot sign twice
 *   - TTL elapse → 'expired' returned (and persisted) by get()
 *   - expired record cannot be signed
 *   - list(filter) honours status filter
 */

import { describe, it, expect } from 'vitest';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
} from '../kernel/index.js';

function fixedClock(start: number): { now: () => Date; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => new Date(t),
    advance: (ms: number) => { t += ms; },
  };
}

const baseProposeArgs = () => ({
  proposerUserId: 'u_alice',
  thoughtId: 'th_1',
  summary: 'Cancel work order #42',
  toolName: 'cancel_work_order',
  payload: { workOrderId: 42 },
  stakes: 'high' as const,
});

describe('createApprovalGate', () => {
  it('creates a pending record with id and expiresAt', async () => {
    const clk = fixedClock(1_000_000);
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      clock: clk.now,
      defaultTtlMs: 1_000,
    });
    const r = await gate.propose(baseProposeArgs());
    expect(r.status).toBe('pending');
    expect(r.action.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.signatures).toHaveLength(0);
    expect(Date.parse(r.action.expiresAt) - Date.parse(r.action.proposedAt)).toBe(1_000);
  });

  it('becomes one-eye after first approve, approved after second', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseProposeArgs());
    const r1 = await gate.sign({ actionId: r0.action.id, approverUserId: 'u_bob', verdict: 'approve' });
    expect(r1.status).toBe('one-eye');
    expect(r1.signatures).toHaveLength(1);
    const r2 = await gate.sign({ actionId: r0.action.id, approverUserId: 'u_carol', verdict: 'approve' });
    expect(r2.status).toBe('approved');
    expect(r2.signatures).toHaveLength(2);
  });

  it('rejection short-circuits to rejected', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseProposeArgs());
    const r1 = await gate.sign({ actionId: r0.action.id, approverUserId: 'u_bob', verdict: 'reject', comment: 'no' });
    expect(r1.status).toBe('rejected');
    expect(r1.signatures[0]?.comment).toBe('no');
  });

  it('refuses self-approval by the proposer', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseProposeArgs());
    await expect(
      gate.sign({ actionId: r0.action.id, approverUserId: 'u_alice', verdict: 'approve' }),
    ).rejects.toThrow(/self-approve/);
  });

  it('refuses double-signing by the same approver', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const r0 = await gate.propose(baseProposeArgs());
    await gate.sign({ actionId: r0.action.id, approverUserId: 'u_bob', verdict: 'approve' });
    await expect(
      gate.sign({ actionId: r0.action.id, approverUserId: 'u_bob', verdict: 'approve' }),
    ).rejects.toThrow(/already signed/);
  });

  it('throws when signing an unknown action id', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    await expect(
      gate.sign({ actionId: 'does-not-exist', approverUserId: 'u_bob', verdict: 'approve' }),
    ).rejects.toThrow(/unknown action/);
  });

  it('expires after TTL when read via get()', async () => {
    const clk = fixedClock(0);
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      clock: clk.now,
      defaultTtlMs: 100,
    });
    const r0 = await gate.propose(baseProposeArgs());
    clk.advance(500);
    const r1 = await gate.get(r0.action.id);
    expect(r1?.status).toBe('expired');
  });

  it('treats expired records as terminal — sign() is a no-op returning the expired record', async () => {
    const clk = fixedClock(0);
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      clock: clk.now,
      defaultTtlMs: 100,
    });
    const r0 = await gate.propose(baseProposeArgs());
    clk.advance(500);
    const r1 = await gate.sign({ actionId: r0.action.id, approverUserId: 'u_bob', verdict: 'approve' });
    expect(r1.status).toBe('expired');
    expect(r1.signatures).toHaveLength(0);
  });

  it('list(filter) filters by status', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    const a = await gate.propose(baseProposeArgs());
    const b = await gate.propose(baseProposeArgs());
    await gate.sign({ actionId: b.action.id, approverUserId: 'u_bob', verdict: 'reject' });
    const pending = await gate.list({ status: 'pending' });
    const rejected = await gate.list({ status: 'rejected' });
    expect(pending.map((r) => r.action.id)).toContain(a.action.id);
    expect(rejected.map((r) => r.action.id)).toEqual([b.action.id]);
  });

  it('list() with no filter returns all records', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    await gate.propose(baseProposeArgs());
    await gate.propose(baseProposeArgs());
    const all = await gate.list();
    expect(all).toHaveLength(2);
  });

  it('get() returns null for unknown id', async () => {
    const gate = createApprovalGate({ store: createInMemoryApprovalStore() });
    expect(await gate.get('does-not-exist')).toBeNull();
  });

  it('records distinct signatures with timestamp and verdict', async () => {
    const clk = fixedClock(1_700_000_000_000);
    const gate = createApprovalGate({
      store: createInMemoryApprovalStore(),
      clock: clk.now,
      defaultTtlMs: 60_000,
    });
    const r0 = await gate.propose(baseProposeArgs());
    clk.advance(1_000);
    const r1 = await gate.sign({
      actionId: r0.action.id,
      approverUserId: 'u_bob',
      verdict: 'approve',
      comment: 'looks fine',
    });
    expect(r1.signatures[0]?.signedAt).toBe(new Date(1_700_000_001_000).toISOString());
    expect(r1.signatures[0]?.verdict).toBe('approve');
    expect(r1.signatures[0]?.comment).toBe('looks fine');
  });
});
