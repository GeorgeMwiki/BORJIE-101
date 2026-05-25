import { describe, expect, it } from 'vitest';

import {
  buildProvenance,
  computeProvenanceHash,
  hashFileBytes,
  PROVENANCE_HASH_VERSION,
} from '../provenance/hash.js';

const baseSeed = {
  tenant_id: 'tenant-prov-test',
  file_hash: 'abc123',
  conversation_id: 'conv-1',
  message_id: 'msg-1',
  row_idx: 0,
  llm_inferred_schema_version: 'sniff-v1',
  ingest_plan_id: 'plan-1',
  timestamp: '2026-05-19T10:00:00.000Z',
};

describe('provenance hash', () => {
  it('produces a 64-char lowercase hex sha256', () => {
    const hash = computeProvenanceHash(baseSeed);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for identical inputs', () => {
    const a = computeProvenanceHash(baseSeed);
    const b = computeProvenanceHash({ ...baseSeed });
    expect(a).toEqual(b);
  });

  it('differs when row_idx changes', () => {
    const a = computeProvenanceHash(baseSeed);
    const b = computeProvenanceHash({ ...baseSeed, row_idx: 1 });
    expect(a).not.toEqual(b);
  });

  it('differs when tenant_id changes (no cross-tenant replay)', () => {
    // Two tenants ingesting the same file must produce different
    // provenance hashes. Otherwise tenant B could replay tenant A's
    // hashes and skip writes that should have landed.
    const a = computeProvenanceHash(baseSeed);
    const b = computeProvenanceHash({ ...baseSeed, tenant_id: 'tenant-other' });
    expect(a).not.toEqual(b);
  });

  it('differs when file_hash changes', () => {
    const a = computeProvenanceHash(baseSeed);
    const b = computeProvenanceHash({ ...baseSeed, file_hash: 'different' });
    expect(a).not.toEqual(b);
  });

  it('differs when ingest_plan_id changes', () => {
    const a = computeProvenanceHash(baseSeed);
    const b = computeProvenanceHash({ ...baseSeed, ingest_plan_id: 'plan-2' });
    expect(a).not.toEqual(b);
  });

  it('differs when llm_inferred_schema_version changes', () => {
    const a = computeProvenanceHash(baseSeed);
    const b = computeProvenanceHash({
      ...baseSeed,
      llm_inferred_schema_version: 'sniff-v2',
    });
    expect(a).not.toEqual(b);
  });

  it('differs when message_id changes (prov-v3: per-message re-upload lands)', () => {
    // DA1 MEDIUM (prov-v3): message_id is now identity-bearing. The
    // prior recipe collapsed re-uploads under a new chat message to the
    // same hash, silently dropping the user's intent to "replace" the
    // earlier upload. New contract:
    //   - same message_id → SAME hash (retry-safe idempotency)
    //   - new message_id  → NEW hash  (re-upload lands)
    const a = computeProvenanceHash(baseSeed);
    const b = computeProvenanceHash({ ...baseSeed, message_id: 'msg-2' });
    expect(a).not.toEqual(b);
  });

  it('IGNORES timestamp (not identity-bearing)', () => {
    // Timestamp is purely a record field — re-emitting the SAME write a
    // moment later must still be idempotent.
    const a = computeProvenanceHash(baseSeed);
    const b = computeProvenanceHash({
      ...baseSeed,
      timestamp: '2030-01-01T00:00:00.000Z',
    });
    expect(a).toEqual(b);
  });

  it('same (tenant, file, message) re-upload → SAME hash (idempotent retry)', () => {
    // DA1 MEDIUM v3: retry of an identical upload (same message)
    // collapses to one hash, so a network blip never duplicates writes.
    const a = computeProvenanceHash(baseSeed);
    const b = computeProvenanceHash({ ...baseSeed, timestamp: '2099-01-01T00:00:00.000Z' });
    expect(a).toEqual(b);
  });

  it('two messages re-uploading the same file → DIFFERENT hashes', () => {
    // DA1 MEDIUM v3: the load-bearing property of the new recipe.
    const seedFirst = baseSeed;
    const seedSecond = { ...baseSeed, message_id: 'msg-2' };
    expect(computeProvenanceHash(seedFirst)).not.toEqual(
      computeProvenanceHash(seedSecond),
    );
  });

  it('records prov-v3 as the active recipe version', () => {
    // The version is part of the public contract (downstream comparators
    // gate on it); bumping the recipe requires bumping the version.
    expect(PROVENANCE_HASH_VERSION).toBe('prov-v3');
  });

  it('buildProvenance returns a frozen record with all fields', () => {
    const prov = buildProvenance(baseSeed);
    expect(prov.file_hash).toEqual('abc123');
    expect(prov.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(prov)).toBe(true);
  });

  it('hashFileBytes hashes Buffer + Uint8Array consistently', () => {
    const buf = Buffer.from('hello world', 'utf8');
    const u8 = new Uint8Array(buf);
    expect(hashFileBytes(buf)).toEqual(hashFileBytes(u8));
    expect(hashFileBytes(buf)).toEqual(hashFileBytes('hello world'));
  });
});
