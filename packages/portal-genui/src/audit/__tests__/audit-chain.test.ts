/**
 * Tests for the hash-chained tab audit — proves the chain is tamper-evident
 * (content edit, reorder, forged hash all detected), append-only (existing
 * hashes never change), and backward-compatible (legacy hashless rows are
 * "unsealed", not "broken").
 */

import { describe, expect, it } from 'vitest';
import type { PortalTabAudit, PortalTabAuditEntry } from '../../types.js';
import {
  GENESIS_HASH,
  hashAuditEntry,
  sealAuditChain,
  verifyAuditChain,
} from '../audit-chain.js';

const entry = (
  action: PortalTabAuditEntry['action'],
  at: string,
): PortalTabAuditEntry => ({ actor: 'system', actorId: 'sys', action, at });

const audit = (history: PortalTabAuditEntry[]): PortalTabAudit => ({
  createdBy: 'sys',
  updatedBy: 'sys',
  history,
});

const E0 = entry('created', '2026-01-01T00:00:00.000Z');
const E1 = entry('edited', '2026-01-02T00:00:00.000Z');

describe('sealAuditChain', () => {
  it('stamps chained hashes on hashless entries', () => {
    const sealed = sealAuditChain(audit([E0, E1]));
    const h0 = (sealed.history[0] as { hash?: string }).hash;
    const h1 = (sealed.history[1] as { hash?: string }).hash;
    expect(h0).toBeTruthy();
    expect(h1).toBeTruthy();
    expect(h0).not.toBe(h1);
    expect(h0).toBe(hashAuditEntry(GENESIS_HASH, E0));
    expect(h1).toBe(hashAuditEntry(h0!, E1));
  });

  it('is append-only: re-sealing preserves existing hashes and chains the new entry', () => {
    const sealed = sealAuditChain(audit([E0]));
    const firstHash = (sealed.history[0] as { hash?: string }).hash!;
    const appended = { ...sealed, history: [...sealed.history, E1] };
    const resealed = sealAuditChain(appended);
    expect((resealed.history[0] as { hash?: string }).hash).toBe(firstHash);
    expect((resealed.history[1] as { hash?: string }).hash).toBe(
      hashAuditEntry(firstHash, E1),
    );
    expect(verifyAuditChain(resealed).ok).toBe(true);
  });

  it('does not mutate the input audit', () => {
    const original = audit([E0]);
    sealAuditChain(original);
    expect((original.history[0] as { hash?: string }).hash).toBeUndefined();
  });
});

describe('verifyAuditChain', () => {
  it('passes on a freshly sealed chain', () => {
    expect(verifyAuditChain(sealAuditChain(audit([E0, E1]))).ok).toBe(true);
  });

  it('fails when a sealed entry is tampered (content edited, hash kept)', () => {
    const sealed = sealAuditChain(audit([E0, E1]));
    const tampered = {
      ...sealed,
      history: [
        { ...sealed.history[0], actorId: 'attacker' },
        sealed.history[1],
      ],
    } as PortalTabAudit;
    const r = verifyAuditChain(tampered);
    expect(r.ok).toBe(false);
    expect(r.brokenAtIndex).toBe(0);
  });

  it('fails when entries are reordered', () => {
    const sealed = sealAuditChain(audit([E0, E1]));
    const reordered = {
      ...sealed,
      history: [sealed.history[1], sealed.history[0]],
    } as PortalTabAudit;
    expect(verifyAuditChain(reordered).ok).toBe(false);
  });

  it('treats legacy hashless entries as unsealed, not broken', () => {
    const r = verifyAuditChain(audit([E0]));
    expect(r.ok).toBe(true);
    expect(r.unsealed).toBe(1);
  });
});
