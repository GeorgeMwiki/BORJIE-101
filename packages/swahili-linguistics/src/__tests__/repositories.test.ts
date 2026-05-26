/**
 * Tests for the in-memory repositories (Wave 19H).
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemorySwahiliTermsRepository,
  createInMemoryMorphologyCacheRepository,
  createInMemoryDialectSignalsRepository,
  type SwahiliTermRow,
  type SwahiliMorphologyCacheRow,
} from '../index.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const sampleTermRow: SwahiliTermRow = Object.freeze({
  id: '11111111-1111-1111-1111-111111111111',
  tenantId: TENANT_A,
  term: 'mrabaha',
  lemma: 'mrabaha',
  nounClass: 3,
  pluralClass: 4,
  register: 'formal',
  domain: 'royalty',
  enEquivalent: 'royalty',
  definition: Object.freeze({ sw: 'malipo ya serikali', en: 'royalty' }),
  citation: Object.freeze({
    url: 'https://www.tumemadini.go.tz/',
    title: 'TUME YA MADINI',
    accessedAt: '2026-05-26',
  }),
  createdAt: '2026-05-26T10:00:00Z',
  auditHash: 'hash-1',
});

describe('terms repository (in-memory)', () => {
  it('inserts and looks up a row by term', async () => {
    const repo = createInMemorySwahiliTermsRepository();
    await repo.insert(sampleTermRow);
    const found = await repo.lookupByTerm(TENANT_A, 'mrabaha');
    expect(found?.id).toBe(sampleTermRow.id);
    expect(found?.domain).toBe('royalty');
  });

  it('isolates rows by tenant', async () => {
    const repo = createInMemorySwahiliTermsRepository();
    await repo.insert(sampleTermRow);
    const found = await repo.lookupByTerm(TENANT_B, 'mrabaha');
    expect(found).toBeNull();
  });

  it('lists rows by domain', async () => {
    const repo = createInMemorySwahiliTermsRepository();
    await repo.insert(sampleTermRow);
    const list = await repo.listByDomain(TENANT_A, 'royalty');
    expect(list.length).toBe(1);
    expect(list[0]?.term).toBe('mrabaha');
  });
});

const sampleCacheRow: SwahiliMorphologyCacheRow = Object.freeze({
  id: '22222222-2222-2222-2222-222222222222',
  tenantId: TENANT_A,
  surfaceForm: 'ninakusoma',
  lemma: 'soma',
  morphemes: Object.freeze([
    Object.freeze({ value: 'ni', slot: 'subj' as const, gloss: '1sg' }),
    Object.freeze({ value: 'na', slot: 'tam' as const, gloss: 'present' }),
    Object.freeze({ value: 'ku', slot: 'obj' as const, gloss: '2sg' }),
    Object.freeze({ value: 'som', slot: 'root' as const }),
    Object.freeze({ value: 'a', slot: 'fv' as const }),
  ]),
  pos: 'verb',
  features: Object.freeze({}),
  confidence: 1.0,
  recordedAt: '2026-05-26T10:00:00Z',
  auditHash: 'hash-2',
});

describe('morphology-cache repository (in-memory)', () => {
  it('upserts and reads back', async () => {
    const repo = createInMemoryMorphologyCacheRepository();
    await repo.upsert(sampleCacheRow);
    const found = await repo.get(TENANT_A, 'ninakusoma');
    expect(found?.lemma).toBe('soma');
    expect(found?.morphemes.length).toBe(5);
  });

  it('returns null on a miss', async () => {
    const repo = createInMemoryMorphologyCacheRepository();
    const missing = await repo.get(TENANT_A, 'haijawapo');
    expect(missing).toBeNull();
  });
});

describe('dialect-signals repository (in-memory)', () => {
  it('increments counts and chains audit hashes', async () => {
    const repo = createInMemoryDialectSignalsRepository();
    const first = await repo.increment(
      TENANT_A,
      'user-1',
      'bongo',
      '2026-05-26T10:00:00Z',
    );
    expect(first.signalCount).toBe(1);

    const second = await repo.increment(
      TENANT_A,
      'user-1',
      'bongo',
      '2026-05-26T10:05:00Z',
    );
    expect(second.signalCount).toBe(2);
    expect(second.auditHash).not.toBe(first.auditHash);
  });

  it('returns per-user signals', async () => {
    const repo = createInMemoryDialectSignalsRepository();
    await repo.increment(TENANT_A, 'user-1', 'bongo', '2026-05-26T10:00:00Z');
    await repo.increment(TENANT_A, 'user-1', 'sheng', '2026-05-26T10:05:00Z');
    await repo.increment(TENANT_A, 'user-2', 'coastal', '2026-05-26T10:05:00Z');

    const rows = await repo.read(TENANT_A, 'user-1');
    expect(rows.length).toBe(2);
    const dialects = rows.map((r) => r.dialect).sort();
    expect(dialects).toEqual(['bongo', 'sheng']);
  });
});
