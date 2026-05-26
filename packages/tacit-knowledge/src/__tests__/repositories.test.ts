/**
 * In-memory repository adapters — invariants + lifecycle.
 */

import { describe, expect, it } from 'vitest';
import {
  computeTacitAuditHash,
  createInMemoryTacitConsentRepository,
  createInMemoryTacitExtractionRepository,
  createInMemoryTacitInterviewRepository,
  type Extraction,
  type Interview,
} from '../index.js';

function makeInterview(overrides: Partial<Interview> = {}): Interview {
  const base: Interview = {
    id: 'iv-1',
    tenantId: 'tnt-1',
    subjectUserId: 'subj-1',
    interviewer: 'mr-mwikila',
    mode: 'walk-the-floor',
    startedAt: '2026-05-26T04:40:00Z',
    endedAt: null,
    status: 'running',
    transcript: [],
    locationGeog: null,
    auditHash: computeTacitAuditHash({ k: 'start', id: 'iv-1' }),
    prevHash: 'GENESIS',
  };
  return { ...base, ...overrides };
}

function makeExtraction(overrides: Partial<Extraction> = {}): Extraction {
  const base: Extraction = {
    id: 'ex-1',
    interviewId: 'iv-1',
    tenantId: 'tnt-1',
    entityKind: 'rule',
    entity: {
      text: 'You must leave at 04:40 to clear the Geita weighbridge.',
      structured: {},
      citations: [],
    },
    confidence: 0.82,
    novel: true,
    redundantWithCellId: null,
    persistedCellId: null,
    createdAt: '2026-05-26T04:42:00Z',
    auditHash: computeTacitAuditHash({ k: 'extract', id: 'ex-1' }),
  };
  return { ...base, ...overrides };
}

describe('in-memory interview repository', () => {
  it('insert + read round-trips a frozen row + enforces tenant isolation', async () => {
    const repo = createInMemoryTacitInterviewRepository();
    const inserted = await repo.insert(makeInterview());
    expect(inserted.status).toBe('running');
    expect(Object.isFrozen(inserted)).toBe(true);

    const readSelf = await repo.read('iv-1', 'tnt-1');
    expect(readSelf).not.toBeNull();
    const crossTenant = await repo.read('iv-1', 'tnt-other');
    expect(crossTenant).toBeNull();
  });

  it('appendTurn produces a new immutable row with the turn appended', async () => {
    const repo = createInMemoryTacitInterviewRepository();
    await repo.insert(makeInterview());
    const after = await repo.appendTurn('iv-1', 'tnt-1', {
      speaker: 'subject',
      text: 'You must leave at 04:40.',
      at: '2026-05-26T04:42:00Z',
    });
    expect(after).not.toBeNull();
    expect(after!.transcript.length).toBe(1);
    expect(after!.transcript[0]!.text).toContain('04:40');
  });

  it('setStatus flips lifecycle + records endedAt', async () => {
    const repo = createInMemoryTacitInterviewRepository();
    await repo.insert(makeInterview());
    const closed = await repo.setStatus(
      'iv-1',
      'tnt-1',
      'ended_ok',
      '2026-05-26T05:00:00Z',
    );
    expect(closed).not.toBeNull();
    expect(closed!.status).toBe('ended_ok');
    expect(closed!.endedAt).toBe('2026-05-26T05:00:00Z');
  });
});

describe('in-memory extraction repository', () => {
  it('listForInterview filters by interview + tenant', async () => {
    const repo = createInMemoryTacitExtractionRepository();
    await repo.insert(makeExtraction({ id: 'ex-1' }));
    await repo.insert(makeExtraction({ id: 'ex-2' }));
    await repo.insert(
      makeExtraction({ id: 'ex-3', interviewId: 'iv-other' }),
    );
    const list = await repo.listForInterview('iv-1', 'tnt-1');
    expect(list.length).toBe(2);
  });

  it('setRedundantWith flips novel + records the matched cell', async () => {
    const repo = createInMemoryTacitExtractionRepository();
    await repo.insert(makeExtraction());
    const updated = await repo.setRedundantWith('ex-1', 'tnt-1', 'cell-99');
    expect(updated).not.toBeNull();
    expect(updated!.redundantWithCellId).toBe('cell-99');
    expect(updated!.novel).toBe(false);
  });

  it('setPersisted attaches the cognitive-memory cellId', async () => {
    const repo = createInMemoryTacitExtractionRepository();
    await repo.insert(makeExtraction());
    const updated = await repo.setPersisted('ex-1', 'tnt-1', 'cell-200');
    expect(updated).not.toBeNull();
    expect(updated!.persistedCellId).toBe('cell-200');
  });
});

describe('in-memory consent repository', () => {
  it('grant + read returns the granted row', async () => {
    const repo = createInMemoryTacitConsentRepository();
    const granted = await repo.grant('subj-1', 'tnt-1');
    expect(granted.status).toBe('granted');
    const row = await repo.read('subj-1', 'tnt-1');
    expect(row).not.toBeNull();
    expect(row!.status).toBe('granted');
  });

  it('revoke chains the audit hash forward from grant', async () => {
    const repo = createInMemoryTacitConsentRepository();
    const granted = await repo.grant('subj-1', 'tnt-1');
    const revoked = await repo.revoke('subj-1', 'tnt-1');
    expect(revoked).not.toBeNull();
    expect(revoked!.auditHash).not.toBe(granted.auditHash);
    expect(revoked!.status).toBe('revoked');
  });
});
