/**
 * Offline audit-chain verify — tamper-detection tests.
 *
 * Proves the verifier is RED on every tamper class (payload mutation, prev-hash
 * rewire, sequence gap, signature forgery, head truncation) and GREEN on a
 * clean, byte-consistent export. Also pins the hash recipe against a hand-rolled
 * SHA-256 so it stays byte-identical to ai-copilot's `hashEntry`.
 */

import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  verifyAuditChainExport,
  recomputeThisHash,
  recomputeSignature,
  GENESIS_PREV_HASH_V2,
  type SerializedAuditEvent,
  type AuditChainExport,
} from './offline-chain-verify.js';

const SECRET = 'test-signing-secret-0123456789abcdef';

/** Build a clean, hash-linked, signed export of `count` events. */
function buildExport(count: number, tenantId = 'tnt_estate_1'): AuditChainExport {
  const events: SerializedAuditEvent[] = [];
  let prevHash = GENESIS_PREV_HASH_V2;
  for (let i = 0; i < count; i++) {
    const base = {
      sequenceId: i + 1,
      prevHash,
      tenantId,
      occurredAt: `2026-07-02T00:0${i}:00.000Z`,
      actorKind: 'ai_execution',
      actionKind: 'royalty.assessment_posted',
      actionCategory: 'royalty_collection',
      decision: 'executed',
      evidence: { evidence_id: `ev_${i}`, amount: 1000 + i },
    };
    const thisHash = recomputeThisHash({
      ...base,
      thisHash: '',
      signature: null,
    });
    const signature = recomputeSignature(thisHash, SECRET);
    events.push({ ...base, thisHash, signature });
    prevHash = thisHash;
  }
  return {
    tenantId,
    exportedAt: '2026-07-02T01:00:00.000Z',
    head: events.length > 0 ? events[events.length - 1]!.thisHash : GENESIS_PREV_HASH_V2,
    events,
  };
}

describe('verifyAuditChainExport — GREEN on clean chain', () => {
  it('verifies a clean signed chain', () => {
    const result = verifyAuditChainExport(buildExport(5), { signingSecret: SECRET });
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(5);
    expect(result.brokenAt).toBeUndefined();
  });

  it('verifies an empty chain with a genesis head', () => {
    const result = verifyAuditChainExport(buildExport(0));
    expect(result.valid).toBe(true);
    expect(result.recomputedHead).toBe(GENESIS_PREV_HASH_V2);
  });

  it('verifies without a secret (hash-chain only)', () => {
    const result = verifyAuditChainExport(buildExport(3));
    expect(result.valid).toBe(true);
  });
});

describe('verifyAuditChainExport — RED on tamper', () => {
  it('detects a mutated payload', () => {
    const exp = buildExport(4);
    // Mutate evidence of row 3 WITHOUT recomputing its hash.
    const tampered: AuditChainExport = {
      ...exp,
      events: exp.events.map((e, i) =>
        i === 2 ? { ...e, evidence: { evidence_id: 'FORGED', amount: 999999 } } : e,
      ),
    };
    const result = verifyAuditChainExport(tampered, { signingSecret: SECRET });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('payload-mutated');
    expect(result.brokenAt).toBe(3);
  });

  it('detects a rewired prev-hash', () => {
    const exp = buildExport(4);
    const tampered: AuditChainExport = {
      ...exp,
      events: exp.events.map((e, i) =>
        i === 2 ? { ...e, prevHash: 'deadbeef'.repeat(8) } : e,
      ),
    };
    const result = verifyAuditChainExport(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('prev-hash-mismatch');
    expect(result.brokenAt).toBe(3);
  });

  it('detects a sequence gap (dropped row)', () => {
    const exp = buildExport(4);
    const tampered: AuditChainExport = {
      ...exp,
      // Drop row 2 → row 3 now sits at index 1 with sequenceId 3.
      events: [exp.events[0]!, exp.events[2]!, exp.events[3]!],
    };
    const result = verifyAuditChainExport(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('sequence-gap');
  });

  it('detects a forged signature', () => {
    const exp = buildExport(3);
    const tampered: AuditChainExport = {
      ...exp,
      events: exp.events.map((e, i) =>
        i === 1 ? { ...e, signature: 'a'.repeat(64) } : e,
      ),
    };
    const result = verifyAuditChainExport(tampered, { signingSecret: SECRET });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature-mismatch');
    expect(result.brokenAt).toBe(2);
  });

  it('detects a truncated chain via head mismatch', () => {
    const exp = buildExport(5);
    // Drop the last row but keep the ORIGINAL claimed head.
    const tampered: AuditChainExport = {
      ...exp,
      events: exp.events.slice(0, 4),
    };
    const result = verifyAuditChainExport(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('head-mismatch');
  });

  it('flags an empty export claiming a non-genesis head', () => {
    const result = verifyAuditChainExport({
      tenantId: 'tnt_estate_1',
      exportedAt: '2026-07-02T01:00:00.000Z',
      head: 'f'.repeat(64),
      events: [],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('head-mismatch');
  });

  it('fail-safe: a schema-invalid export is reported broken, never passed', () => {
    const result = verifyAuditChainExport({ garbage: true });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('schema-invalid');
  });
});

describe('recomputeThisHash — recipe pin (must match ai-copilot hashEntry)', () => {
  it('produces the byte-identical SHA-256 of the pipe-joined canonical payload', () => {
    const event: SerializedAuditEvent = {
      sequenceId: 7,
      prevHash: 'abc123',
      tenantId: 'tnt_estate_1',
      occurredAt: '2026-07-02T00:00:00.000Z',
      actorKind: 'ai_execution',
      actionKind: 'offtake.contract_signed',
      actionCategory: 'offtake',
      decision: 'executed',
      evidence: { b: 2, a: 1 }, // deliberately unsorted → recipe sorts keys
      thisHash: '',
      signature: null,
    };
    // Hand-rolled expectation mirroring ai-copilot/src/audit-trail/hash-chain.ts.
    const canonicalEvidence = JSON.stringify({ a: 1, b: 2 });
    const serialised = [
      '7',
      'abc123',
      'tnt_estate_1',
      '2026-07-02T00:00:00.000Z',
      'ai_execution',
      'offtake.contract_signed',
      'offtake',
      'executed',
      canonicalEvidence,
    ].join('|');
    const expected = createHash('sha256').update(serialised).digest('hex');
    expect(recomputeThisHash(event)).toBe(expected);
  });

  it('recomputeSignature matches a hand-rolled HMAC', () => {
    const hash = 'deadbeef'.repeat(8);
    const expected = createHmac('sha256', SECRET).update(hash).digest('hex');
    expect(recomputeSignature(hash, SECRET)).toBe(expected);
    expect(recomputeSignature(hash, null)).toBeNull();
  });
});
