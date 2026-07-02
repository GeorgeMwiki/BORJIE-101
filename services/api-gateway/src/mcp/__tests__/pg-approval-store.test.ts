/**
 * Durable four-eye ApprovalStore (Postgres/Drizzle adapter) — proves the
 * TIER-1 durability + correctness properties over a persistent row store:
 *
 *   - create -> approve(distinct) -> consume round-trips;
 *   - separation-of-duties: a self-approval (approver === initiator) is
 *     rejected with SelfApprovalError;
 *   - single-use: consume flips approved -> consumed and a replay fails;
 *   - expiry: an approve after expires_at yields `expired`, never approved;
 *   - RESTART SURVIVAL: a FRESH store built over the SAME rows still sees
 *     the approval (the whole point of moving off the in-memory store).
 */
import { describe, it, expect } from 'vitest';
import { SelfApprovalError } from '@borjie/mcp-server-borjie';
import { createPgApprovalStore } from '../pg-approval-store';
import { makeApprovalRowStore, makeFakeApprovalDb } from './fake-approval-db';

const INITIATOR = 'owner-initiator';
const APPROVER = 'owner-second-eye';

function build(now: () => number = () => Date.now()) {
  const rows = makeApprovalRowStore();
  const db = makeFakeApprovalDb({ rows });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = createPgApprovalStore(db as any, { now });
  return { rows, db, store };
}

describe('createPgApprovalStore — durable four-eye semantics', () => {
  it('create -> approve(distinct) -> consume round-trips', async () => {
    const { store } = build();
    const created = await store.create({
      tokenId: 'tok-1',
      toolName: 'sovereign.audit',
      arguments: { scope: 'ledger' },
      expiresAt: Date.now() + 60_000,
      initiatedBy: INITIATOR,
    });
    expect(created.status).toBe('pending');
    expect(created.initiatedBy).toBe(INITIATOR);

    const approved = await store.approve(created.id, APPROVER);
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe(APPROVER);

    const consumed = await store.consume(created.id);
    expect(consumed.status).toBe('consumed');
    expect(consumed.consumedAt).toBeTypeOf('number');
  });

  it('rejects self-approval (approver === initiator) with SelfApprovalError', async () => {
    const { store } = build();
    const created = await store.create({
      tokenId: 'tok-1',
      toolName: 'kill_switch.open',
      arguments: {},
      expiresAt: Date.now() + 60_000,
      initiatedBy: INITIATOR,
    });
    await expect(store.approve(created.id, INITIATOR)).rejects.toBeInstanceOf(SelfApprovalError);
    // The row stays pending — a rejected self-approval is not a state change.
    const still = await store.get(created.id);
    expect(still?.status).toBe('pending');
  });

  it('consume is single-use — a replay after consumed fails', async () => {
    const { store } = build();
    const created = await store.create({
      tokenId: 'tok-1',
      toolName: 'policy_rollout.publish',
      arguments: {},
      expiresAt: Date.now() + 60_000,
      initiatedBy: INITIATOR,
    });
    await store.approve(created.id, APPROVER);
    await store.consume(created.id);
    await expect(store.consume(created.id)).rejects.toThrow(/not approved/);
  });

  it('consume before approval is refused', async () => {
    const { store } = build();
    const created = await store.create({
      tokenId: 'tok-1',
      toolName: 'sovereign.audit',
      arguments: {},
      expiresAt: Date.now() + 60_000,
      initiatedBy: INITIATOR,
    });
    await expect(store.consume(created.id)).rejects.toThrow(/not approved/);
  });

  it('approve after expiry yields expired, never approved', async () => {
    let t = 1_000_000;
    const { store } = build(() => t);
    const created = await store.create({
      tokenId: 'tok-1',
      toolName: 'sovereign.audit',
      arguments: {},
      expiresAt: t + 1_000,
      initiatedBy: INITIATOR,
    });
    t += 5_000; // advance past expiry
    const result = await store.approve(created.id, APPROVER);
    expect(result.status).toBe('expired');
    // And consume refuses an expired (never-approved) row.
    await expect(store.consume(created.id)).rejects.toThrow(/not approved/);
  });

  it('SURVIVES a simulated restart — a fresh store over the same rows sees the approval', async () => {
    const rows = makeApprovalRowStore();
    // Process #1: create + approve.
    const dbA = makeFakeApprovalDb({ rows });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeA = createPgApprovalStore(dbA as any);
    const created = await storeA.create({
      tokenId: 'tok-1',
      toolName: 'sovereign.audit',
      arguments: { k: 'v' },
      expiresAt: Date.now() + 60_000,
      initiatedBy: INITIATOR,
    });
    await storeA.approve(created.id, APPROVER);

    // Process #2 (a "restart" / another replica): a brand-new store over
    // the SAME durable rows still finds the approved row and can consume it.
    const dbB = makeFakeApprovalDb({ rows });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeB = createPgApprovalStore(dbB as any);
    const seen = await storeB.get(created.id);
    expect(seen?.status).toBe('approved');
    expect(seen?.arguments).toEqual({ k: 'v' });
    expect(seen?.initiatedBy).toBe(INITIATOR);
    const consumed = await storeB.consume(created.id);
    expect(consumed.status).toBe('consumed');
  });
});
