import { describe, expect, it } from 'vitest';
import {
  createAuditChainVerifyPass,
  createInMemoryAuditChainAdapter,
} from '../index.js';
import type { AuditChainEntry } from '../adapters.js';

const now = () => new Date('2026-05-25T10:00:00.000Z');
const signal = new AbortController().signal;

function chain(entries: ReadonlyArray<{ id: string; payload: unknown }>): AuditChainEntry[] {
  const out: AuditChainEntry[] = [];
  const tmp = createInMemoryAuditChainAdapter([]);
  let prevHash: string | null = null;
  for (const e of entries) {
    const entry: AuditChainEntry = {
      id: e.id,
      previousHash: prevHash,
      hash: '',
      payload: e.payload,
    };
    const recomputed = tmp.recomputeHash(entry);
    const finalEntry = { ...entry, hash: recomputed };
    out.push(finalEntry);
    prevHash = recomputed;
  }
  return out;
}

describe('audit-chain-verify pass', () => {
  it('reports a clean chain', async () => {
    const entries = chain([
      { id: 'a', payload: { x: 1 } },
      { id: 'b', payload: { x: 2 } },
    ]);
    const adapter = createInMemoryAuditChainAdapter(entries);
    const pass = createAuditChainVerifyPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsEmitted).toBe(0);
    expect(result.notes).toContain('clean');
  });

  it('detects a mutated payload break', async () => {
    const entries = chain([
      { id: 'a', payload: { x: 1 } },
      { id: 'b', payload: { x: 2 } },
    ]);
    const tampered: AuditChainEntry[] = entries.map((e) =>
      e.id === 'b' ? { ...e, payload: { x: 999 } } : e,
    );
    const adapter = createInMemoryAuditChainAdapter(tampered);
    const pass = createAuditChainVerifyPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsEmitted).toBeGreaterThan(0);
    expect(result.notes).toContain('BREAKS');
  });

  it('detects a previousHash chain split', async () => {
    const entries = chain([
      { id: 'a', payload: { x: 1 } },
      { id: 'b', payload: { x: 2 } },
    ]);
    const broken: AuditChainEntry[] = entries.map((e) =>
      e.id === 'b' ? { ...e, previousHash: 'BAD' } : e,
    );
    const adapter = createInMemoryAuditChainAdapter(broken);
    const pass = createAuditChainVerifyPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.notes).toContain('prev-mismatch');
  });

  it('never mutates the chain', async () => {
    const entries = chain([{ id: 'a', payload: { x: 1 } }]);
    const before = JSON.stringify(entries);
    const adapter = createInMemoryAuditChainAdapter(entries);
    const pass = createAuditChainVerifyPass(adapter);
    await pass.run({ abortSignal: signal, now });
    expect(JSON.stringify(entries)).toBe(before);
  });
});
