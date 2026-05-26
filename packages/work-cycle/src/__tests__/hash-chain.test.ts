/**
 * Hash-chain unit tests — determinism + sensitivity.
 */

import { describe, it, expect } from 'vitest';

import { computeJournalHash, GENESIS_HASH } from '../audit/hash-chain.js';
import type { TickInput, TickOutput } from '../types.js';

const baseInputs: TickInput = {
  tenant_id: 't1',
  tick_no: 1n,
  mode: 'night',
  last_hash: null,
  recall: [],
  pending_threads: [],
  clock_iso: '2026-05-26T02:00:00.000Z',
};

const baseOutputs: TickOutput = {
  status: 'completed',
  kind: 'sweep',
  summary: 'Mr. Mwikila ran a sweep.',
  artifact_refs: [],
  requires_owner_attention: false,
};

const basePayload = {
  tick_no: 1n,
  tenant_id: 't1',
  started_at: '2026-05-26T02:00:00.000Z',
  ended_at: '2026-05-26T02:00:01.000Z',
  mode: 'night' as const,
  inputs: baseInputs,
  outputs: baseOutputs,
  cost_usd_cents: 0,
};

describe('hash-chain', () => {
  it('produces a deterministic 64-char hex hash', () => {
    const a = computeJournalHash({ prev_hash: null, payload: basePayload });
    const b = computeJournalHash({ prev_hash: null, payload: basePayload });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the hash when any payload field changes', () => {
    const a = computeJournalHash({ prev_hash: null, payload: basePayload });
    const b = computeJournalHash({
      prev_hash: null,
      payload: { ...basePayload, cost_usd_cents: 1 },
    });
    expect(a).not.toBe(b);
  });

  it('changes the hash when prev_hash changes', () => {
    const a = computeJournalHash({ prev_hash: null, payload: basePayload });
    const b = computeJournalHash({
      prev_hash: 'a'.repeat(64),
      payload: basePayload,
    });
    expect(a).not.toBe(b);
  });

  it('treats null and undefined prev_hash identically (both fall back to GENESIS)', () => {
    const a = computeJournalHash({ prev_hash: null, payload: basePayload });
    const b = computeJournalHash({
      prev_hash: undefined,
      payload: basePayload,
    });
    expect(a).toBe(b);
  });

  it('GENESIS_HASH is a well-known string', () => {
    expect(GENESIS_HASH).toMatch(/^[0-9a-zA-Z_:-]+$/);
  });
});
