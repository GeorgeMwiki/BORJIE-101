/**
 * Audit chain tests — hash determinism, chain growth, tenant partitioning.
 */

import { describe, it, expect } from 'vitest';
import {
  buildChainLink,
  computeChainHash,
  createInMemoryAuditChainSink,
  stableStringify,
} from '../audit-link.js';

describe('computeChainHash', () => {
  it('is deterministic for identical input', () => {
    const a = computeChainHash({
      prev_hash: 'X',
      action: 'capture_emitted',
      payload: { intent: 'propose_action' },
    });
    const b = computeChainHash({
      prev_hash: 'X',
      action: 'capture_emitted',
      payload: { intent: 'propose_action' },
    });
    expect(a).toBe(b);
  });

  it('changes when prev_hash changes', () => {
    const a = computeChainHash({
      prev_hash: 'X',
      action: 'capture_emitted',
      payload: { intent: 'propose_action' },
    });
    const b = computeChainHash({
      prev_hash: 'Y',
      action: 'capture_emitted',
      payload: { intent: 'propose_action' },
    });
    expect(a).not.toBe(b);
  });

  it('produces same hash regardless of payload key order', () => {
    const a = computeChainHash({
      prev_hash: 'X',
      action: 'capture_emitted',
      payload: { a: 1, b: 2 },
    });
    const b = computeChainHash({
      prev_hash: 'X',
      action: 'capture_emitted',
      payload: { b: 2, a: 1 },
    });
    expect(a).toBe(b);
  });
});

describe('stableStringify', () => {
  it('sorts object keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('handles nested objects', () => {
    expect(stableStringify({ x: { b: 1, a: 2 } })).toBe('{"x":{"a":2,"b":1}}');
  });

  it('handles arrays in order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('null+undefined+NaN coerce to null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify(NaN)).toBe('null');
  });

  it('strings + booleans + ints + nested', () => {
    expect(stableStringify({ s: 'hi', b: true, n: 42 })).toBe(
      '{"b":true,"n":42,"s":"hi"}',
    );
  });
});

describe('buildChainLink', () => {
  it('creates a link with computed hash', () => {
    const link = buildChainLink({
      id: 'a',
      tenant_id: 't1',
      turn_id: 'turn_1',
      session_id: null,
      action: 'capture_emitted',
      prev_hash: 'GENESIS',
      payload: { x: 1 },
      sequence_id: 1,
    });
    expect(link.this_hash).toBeDefined();
    expect(link.this_hash.length).toBe(64); // sha256 hex
  });
});

describe('createInMemoryAuditChainSink', () => {
  it('appends a genesis link with prev_hash=GENESIS', async () => {
    const sink = createInMemoryAuditChainSink();
    const a = await sink.append({
      tenant_id: 't1',
      turn_id: 'turn_1',
      action: 'capture_emitted',
      payload: { intent: 'propose_action' },
    });
    expect(a.prev_hash).toBe('GENESIS');
    expect(a.sequence_id).toBe(1);
  });

  it('chains the next link off the previous hash', async () => {
    const sink = createInMemoryAuditChainSink();
    const a = await sink.append({
      tenant_id: 't1',
      turn_id: 'turn_1',
      action: 'capture_emitted',
      payload: { x: 1 },
    });
    const b = await sink.append({
      tenant_id: 't1',
      turn_id: 'turn_1',
      action: 'proposal_created',
      payload: { y: 2 },
    });
    expect(b.prev_hash).toBe(a.this_hash);
    expect(b.sequence_id).toBe(2);
  });

  it('partitions chains by tenant', async () => {
    const sink = createInMemoryAuditChainSink();
    const t1 = await sink.append({
      tenant_id: 't1',
      turn_id: 'turn_1',
      action: 'x',
      payload: {},
    });
    const t2 = await sink.append({
      tenant_id: 't2',
      turn_id: 'turn_2',
      action: 'x',
      payload: {},
    });
    expect(t1.prev_hash).toBe('GENESIS');
    expect(t2.prev_hash).toBe('GENESIS');
    expect(sink.snapshot('t1').length).toBe(1);
    expect(sink.snapshot('t2').length).toBe(1);
  });
});
