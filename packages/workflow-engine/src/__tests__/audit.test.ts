/**
 * Hashed audit chain tests — append + verify + tamper-detection.
 */

import { describe, expect, it } from 'vitest';
import {
  createAuditHashChain,
  createInMemoryAuditChainRepository,
  verifyChainForRun,
} from '../index.js';

describe('audit hash chain', () => {
  it('first append uses GENESIS as previousHash', async () => {
    const repo = createInMemoryAuditChainRepository();
    const chain = createAuditHashChain(repo);
    const entry = await chain.append(
      't1',
      'run-1',
      'started',
      { foo: 'bar' },
      'entry-1',
      () => new Date('2026-01-01T00:00:00Z'),
    );
    expect(entry.previousHash).toBe('GENESIS');
    expect(entry.currentHash).toHaveLength(64);
  });

  it('subsequent appends link via previousHash', async () => {
    const repo = createInMemoryAuditChainRepository();
    const chain = createAuditHashChain(repo);
    const e1 = await chain.append(
      't1',
      'run-1',
      'started',
      { v: 1 },
      'e1',
      () => new Date('2026-01-01T00:00:00Z'),
    );
    const e2 = await chain.append(
      't1',
      'run-1',
      'committed',
      { v: 2 },
      'e2',
      () => new Date('2026-01-01T00:01:00Z'),
    );
    expect(e2.previousHash).toBe(e1.currentHash);
  });

  it('per-tenant isolation — tenants do not share the chain head', async () => {
    const repo = createInMemoryAuditChainRepository();
    const chain = createAuditHashChain(repo);
    await chain.append(
      'tenant-A',
      'run-A',
      'started',
      { v: 1 },
      'a1',
      () => new Date('2026-01-01T00:00:00Z'),
    );
    const b1 = await chain.append(
      'tenant-B',
      'run-B',
      'started',
      { v: 1 },
      'b1',
      () => new Date('2026-01-01T00:00:00Z'),
    );
    expect(b1.previousHash).toBe('GENESIS');
  });

  it('verifyChainForRun returns ok for a clean chain', async () => {
    const repo = createInMemoryAuditChainRepository();
    const chain = createAuditHashChain(repo);
    for (let i = 0; i < 5; i++) {
      await chain.append(
        't1',
        'run-1',
        'progressed',
        { i },
        `e${i}`,
        () => new Date(2026, 0, 1, 0, 0, i),
      );
    }
    const v = await verifyChainForRun(repo, 'run-1');
    expect(v.ok).toBe(true);
  });
});
