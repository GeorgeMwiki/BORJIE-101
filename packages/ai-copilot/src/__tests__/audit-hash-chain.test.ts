/**
 * Audit hash-chain tests — Wave-11.
 *
 * Covers:
 *   - append() builds a chain linked by SHA-256 prev→this
 *   - verify() returns valid=true for an untouched chain
 *   - tampering a payload invalidates the chain
 *   - prevHash divergence is caught
 *   - sequence gaps are caught
 */

import { describe, it, expect } from 'vitest';
import {
  createAuditHashChain,
  createInMemoryAuditChainRepo,
  GENESIS_PREV_HASH,
} from '../security/audit-hash-chain.js';

function createChain(frozenNow?: string) {
  let clockMs = frozenNow ? new Date(frozenNow).getTime() : 1_700_000_000_000;
  let seq = 0;
  const repo = createInMemoryAuditChainRepo();
  const chain = createAuditHashChain({
    repo,
    now: () => new Date(clockMs++),
    idGenerator: () => `aud_${++seq}`,
  });
  return { repo, chain };
}

describe('audit-hash-chain', () => {
  it('first entry uses genesis prevHash', async () => {
    const { repo, chain } = createChain();
    const entry = await chain.append({
      tenantId: 't1',
      turnId: 'turn_1',
      action: 'llm_call',
      payload: { tokens: 42 },
    });
    expect(entry.prevHash).toBe(GENESIS_PREV_HASH);
    expect(entry.sequenceId).toBe(1);
    expect(entry.thisHash).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.entries).toHaveLength(1);
  });

  it('links subsequent entries by prev→this hash', async () => {
    const { chain } = createChain();
    const a = await chain.append({ tenantId: 't1', turnId: 'a', action: 'x' });
    const b = await chain.append({ tenantId: 't1', turnId: 'b', action: 'y' });
    const c = await chain.append({ tenantId: 't1', turnId: 'c', action: 'z' });
    expect(b.prevHash).toBe(a.thisHash);
    expect(c.prevHash).toBe(b.thisHash);
    expect(new Set([a.thisHash, b.thisHash, c.thisHash]).size).toBe(3);
  });

  it('verify() returns valid for an unchanged chain', async () => {
    const { chain } = createChain();
    for (let i = 0; i < 5; i++) {
      await chain.append({
        tenantId: 't1',
        turnId: `t${i}`,
        action: 'llm_call',
        payload: { i },
      });
    }
    const result = await chain.verify('t1');
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(5);
  });

  it('detects a mutated payload', async () => {
    const { repo, chain } = createChain();
    await chain.append({ tenantId: 't1', turnId: 'a', action: 'x', payload: { tokens: 1 } });
    await chain.append({ tenantId: 't1', turnId: 'b', action: 'y', payload: { tokens: 2 } });
    await chain.append({ tenantId: 't1', turnId: 'c', action: 'z', payload: { tokens: 3 } });

    repo.tamperAt(1, { payload: { tokens: 999 } });
    const result = await chain.verify('t1');
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.error).toMatch(/mutated/i);
  });

  it('detects a broken prevHash link', async () => {
    const { repo, chain } = createChain();
    await chain.append({ tenantId: 't1', turnId: 'a', action: 'x' });
    await chain.append({ tenantId: 't1', turnId: 'b', action: 'y' });
    repo.tamperAt(1, { prevHash: 'f'.repeat(64) });
    const result = await chain.verify('t1');
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('isolates chains per tenant', async () => {
    const { chain } = createChain();
    await chain.append({ tenantId: 't1', turnId: 'a', action: 'x' });
    await chain.append({ tenantId: 't2', turnId: 'b', action: 'y' });
    const a = await chain.listEntries('t1');
    const b = await chain.listEntries('t2');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].tenantId).toBe('t1');
    expect(b[0].tenantId).toBe('t2');
  });
});

// ---------------------------------------------------------------------------
// Wave-K Tier-3 — verifyWithRotation integration. The verifier now
// delegates to @borjie/observability's `verifyWithRotation` when
// both active + previous secrets are present, and the result carries
// a per-key roleBreakdown so operators can monitor the 24h soak.
// ---------------------------------------------------------------------------

import { createAuditHashChain as createChainImpl } from '../security/audit-hash-chain.js';

describe('audit-hash-chain — verifyWithRotation integration', () => {
  it('verify returns roleBreakdown with all rows under "current" when no rotation is in flight', async () => {
    let clockMs = 1_700_000_000_000;
    let seq = 0;
    const repo = createInMemoryAuditChainRepo();
    const chain = createChainImpl({
      repo,
      now: () => new Date(clockMs++),
      idGenerator: () => `aud_${++seq}`,
      secret: { active: 'active-key-aaaaaaaa', previous: 'previous-key-bbbb' },
    });

    await chain.append({ tenantId: 't1', turnId: 'a', action: 'x' });
    await chain.append({ tenantId: 't1', turnId: 'b', action: 'y' });
    await chain.append({ tenantId: 't1', turnId: 'c', action: 'z' });

    const res = await chain.verifyChain('t1');
    expect(res.valid).toBe(true);
    expect(res.roleBreakdown).toEqual({
      current: 3,
      previous: 0,
      legacy: 0,
    });
  });

  it('verify recognises rows signed under the PREVIOUS secret during rotation', async () => {
    let clockMs = 1_700_000_000_000;
    let seq = 0;
    const repo = createInMemoryAuditChainRepo();

    // First, append 2 rows with secret K1 as ACTIVE (no previous yet).
    const k1 = 'rotation-key-K1-aaaaaa';
    const k2 = 'rotation-key-K2-bbbbbb';
    const chainPreRotation = createChainImpl({
      repo,
      now: () => new Date(clockMs++),
      idGenerator: () => `aud_${++seq}`,
      secret: { active: k1 },
    });
    await chainPreRotation.append({
      tenantId: 't1',
      turnId: 'k1-row1',
      action: 'pre',
    });
    await chainPreRotation.append({
      tenantId: 't1',
      turnId: 'k1-row2',
      action: 'pre',
    });

    // Now rotate: K2 becomes ACTIVE, K1 becomes PREVIOUS. Append 1
    // more row under K2.
    const chainPostRotation = createChainImpl({
      repo,
      now: () => new Date(clockMs++),
      idGenerator: () => `aud_${++seq}`,
      secret: { active: k2, previous: k1 },
    });
    await chainPostRotation.append({
      tenantId: 't1',
      turnId: 'k2-row1',
      action: 'post',
    });

    // Verify from the post-rotation chain — all three rows must
    // validate, with 1 under 'current' (the K2 row) + 2 under
    // 'previous' (the K1 rows, still valid during the soak).
    const res = await chainPostRotation.verifyChain('t1');
    expect(res.valid).toBe(true);
    expect(res.entriesChecked).toBe(3);
    expect(res.roleBreakdown).toEqual({
      current: 1,
      previous: 2,
      legacy: 0,
    });
  });

  it('verify rejects rows signed under a third key not in the rotation pair', async () => {
    let clockMs = 1_700_000_000_000;
    let seq = 0;
    const repo = createInMemoryAuditChainRepo();
    const k1 = 'key-K1-aaaaaaaaaa';
    const k2 = 'key-K2-bbbbbbbbbb';
    const k3 = 'rogue-K3-cccccccc';

    // Seed a row under K3 — a tamper actor with write access but the
    // wrong key.
    const chainRogue = createChainImpl({
      repo,
      now: () => new Date(clockMs++),
      idGenerator: () => `aud_${++seq}`,
      secret: { active: k3 },
    });
    await chainRogue.append({
      tenantId: 't1',
      turnId: 'rogue',
      action: 'rogue-write',
    });

    // Verify against the legitimate rotation pair (K1, K2). The K3
    // row must NOT validate.
    const chainLegit = createChainImpl({
      repo,
      now: () => new Date(clockMs++),
      idGenerator: () => `aud_${++seq}`,
      secret: { active: k1, previous: k2 },
    });
    const res = await chainLegit.verifyChain('t1');
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/mutated/i);
  });

  it('verify falls back to legacy SHA-256 when no secrets configured', async () => {
    // Drop any inherited process env so the assertion is hermetic.
    const prevActive = process.env.SESSION_HASH_SECRET;
    const prevPrev = process.env.SESSION_HASH_SECRET_PREV;
    delete process.env.SESSION_HASH_SECRET;
    delete process.env.SESSION_HASH_SECRET_PREV;
    try {
      const { repo, chain } = createChain();
      await chain.append({ tenantId: 't1', turnId: 'a', action: 'x' });
      await chain.append({ tenantId: 't1', turnId: 'b', action: 'y' });
      const res = await chain.verifyChain('t1');
      expect(res.valid).toBe(true);
      expect(res.roleBreakdown).toEqual({
        current: 0,
        previous: 0,
        legacy: 2,
      });
      expect(repo.entries).toHaveLength(2);
    } finally {
      if (prevActive !== undefined) process.env.SESSION_HASH_SECRET = prevActive;
      if (prevPrev !== undefined) process.env.SESSION_HASH_SECRET_PREV = prevPrev;
    }
  });
});
