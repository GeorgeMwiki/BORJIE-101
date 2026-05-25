import { describe, expect, test } from 'vitest';
import {
  computeAuditHash,
  createInMemoryAuditChain,
  GENESIS_HASH,
} from '../audit-chain.js';

describe('action-runtime audit-chain', () => {
  test('computes a deterministic SHA-256 hash', () => {
    const h1 = computeAuditHash({
      prevHash: GENESIS_HASH,
      tenantId: 't',
      action: 'a.start',
      payload: { foo: 1 },
      createdAtIso: '2026-05-22T12:00:00.000Z',
    });
    const h2 = computeAuditHash({
      prevHash: GENESIS_HASH,
      tenantId: 't',
      action: 'a.start',
      payload: { foo: 1 },
      createdAtIso: '2026-05-22T12:00:00.000Z',
    });
    expect(h1).toEqual(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  test('different payload → different hash', () => {
    const h1 = computeAuditHash({
      prevHash: GENESIS_HASH,
      tenantId: 't',
      action: 'a',
      payload: { foo: 1 },
      createdAtIso: 'x',
    });
    const h2 = computeAuditHash({
      prevHash: GENESIS_HASH,
      tenantId: 't',
      action: 'a',
      payload: { foo: 2 },
      createdAtIso: 'x',
    });
    expect(h1).not.toBe(h2);
  });

  test('canonical JSON makes key order irrelevant', () => {
    const h1 = computeAuditHash({
      prevHash: GENESIS_HASH,
      tenantId: 't',
      action: 'a',
      payload: { foo: 1, bar: 2 },
      createdAtIso: 'x',
    });
    const h2 = computeAuditHash({
      prevHash: GENESIS_HASH,
      tenantId: 't',
      action: 'a',
      payload: { bar: 2, foo: 1 },
      createdAtIso: 'x',
    });
    expect(h1).toEqual(h2);
  });

  test('chain verification end-to-end', async () => {
    const chain = createInMemoryAuditChain();
    const r1 = await chain.writer.appendRow({
      tenantId: 't1',
      action: 'a',
      payload: { x: 1 },
      turnId: 'turn1',
    });
    const r2 = await chain.writer.appendRow({
      tenantId: 't1',
      action: 'b',
      payload: { x: 2 },
      turnId: 'turn1',
    });
    expect(r1.prevHash).toBe(GENESIS_HASH);
    expect(r2.prevHash).toBe(r1.thisHash);
    expect(chain.verify('t1')).toBe(true);
  });

  test('per-tenant chains are independent', async () => {
    const chain = createInMemoryAuditChain();
    await chain.writer.appendRow({
      tenantId: 't1',
      action: 'a',
      payload: {},
      turnId: 'x',
    });
    await chain.writer.appendRow({
      tenantId: 't2',
      action: 'a',
      payload: {},
      turnId: 'y',
    });
    expect(chain.verify('t1')).toBe(true);
    expect(chain.verify('t2')).toBe(true);
  });

  test('tampering with a payload breaks verification', async () => {
    const chain = createInMemoryAuditChain();
    await chain.writer.appendRow({
      tenantId: 't1',
      action: 'a',
      payload: { x: 1 },
      turnId: 'x',
    });
    const rows = chain.rows();
    // Simulate tampering — mutate the payload of the existing row in place.
    // Our in-memory chain holds the rows array; the row is frozen by
    // contract but the test can reach into the internals via mutation
    // of the stored object reference.
    (rows[0]?.payload as Record<string, unknown>)['x'] = 999;
    // Verification now fails.
    expect(chain.verify('t1')).toBe(false);
  });
});
