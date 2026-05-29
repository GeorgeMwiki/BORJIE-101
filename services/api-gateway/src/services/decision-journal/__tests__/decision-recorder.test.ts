/**
 * decision-recorder tests.
 *
 * Drives the createDecisionRecorder facade with an in-memory db stub.
 * Verifies: happy path persists with hash, missing-fields rejection,
 * hash-chain integrity across two consecutive decisions, outcome write
 * fails for unknown decision, link write rejects self-loop.
 */

import { describe, expect, it, vi } from 'vitest';

import { createDecisionRecorder, DecisionRecorderError } from '../recorder';

interface StubDbCall {
  readonly textMatch?: RegExp;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

function makeStubDb(calls: ReadonlyArray<StubDbCall>) {
  let i = 0;
  const seen: string[] = [];
  const execute = vi.fn(async (query: unknown) => {
    const text = String((query as { queryChunks?: unknown[] })?.queryChunks ?? query);
    seen.push(text);
    const expected = calls[i];
    i += 1;
    if (!expected) {
      throw new Error(
        `stub db: unexpected call ${i}: ${text.slice(0, 200)}`,
      );
    }
    if (expected.textMatch && !expected.textMatch.test(text)) {
      throw new Error(
        `stub db: call ${i} did not match ${expected.textMatch}: ${text.slice(0, 200)}`,
      );
    }
    return { rows: expected.rows };
  });
  return { db: { execute }, calls: () => seen };
}

const TENANT = 'tenant-acme';
const NOW = () => new Date('2026-05-29T12:00:00.000Z');

describe('createDecisionRecorder.recordDecision', () => {
  it('persists a decision with a hash and returns the row id', async () => {
    const { db } = makeStubDb([
      { textMatch: /SELECT entry_hash/i, rows: [] },
      { textMatch: /INSERT INTO decisions/i, rows: [{ id: 'dec-001' }] },
    ]);
    const recorder = createDecisionRecorder({ db, now: NOW });
    const result = await recorder.recordDecision({
      tenantId: TENANT,
      decidedByKind: 'owner',
      decidedByActorId: 'user-mwikila',
      decisionSubject: 'File April royalty on the 9th vs the 12th',
      decidedValue: { choice: 'file_now', date: '2026-04-09' },
      alternativesConsidered: [
        { option: { choice: 'file_friday' }, whyNot: '5% penalty risk if Friday slips' },
      ],
      rationale: 'Filing 3 days early avoids the auto-imposed 5% penalty',
      confidence: 0.82,
      scopeIds: ['geita'],
    });
    expect(result.id).toBe('dec-001');
    expect(result.entryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.prevHash).toBeNull();
    expect(result.decidedAt).toBe('2026-05-29T12:00:00.000Z');
    expect(result.alternativesConsidered).toHaveLength(1);
    expect(result.status).toBe('committed');
  });

  it('rejects when the rationale is missing or too short', async () => {
    const { db } = makeStubDb([]);
    const recorder = createDecisionRecorder({ db });
    await expect(
      recorder.recordDecision({
        tenantId: TENANT,
        decidedByKind: 'brain',
        decidedByActorId: 'mr_mwikila',
        decisionSubject: 'File royalty now or Friday',
        decidedValue: { choice: 'file_now' },
        rationale: 'x',
      }),
    ).rejects.toBeInstanceOf(DecisionRecorderError);
  });

  it('rejects when confidence is out of [0,1]', async () => {
    const { db } = makeStubDb([]);
    const recorder = createDecisionRecorder({ db });
    await expect(
      recorder.recordDecision({
        tenantId: TENANT,
        decidedByKind: 'brain',
        decidedByActorId: 'mr_mwikila',
        decisionSubject: 'File royalty now or Friday',
        decidedValue: { choice: 'file_now' },
        rationale: 'Avoids penalty',
        confidence: 1.5,
      }),
    ).rejects.toBeInstanceOf(DecisionRecorderError);
  });

  it('chains the second decision onto the first via prev_hash', async () => {
    const FIRST_HASH = 'abc123' + 'd'.repeat(58);
    const { db } = makeStubDb([
      { textMatch: /SELECT entry_hash/i, rows: [] },
      { textMatch: /INSERT INTO decisions/i, rows: [{ id: 'dec-001' }] },
      { textMatch: /SELECT entry_hash/i, rows: [{ entry_hash: FIRST_HASH }] },
      { textMatch: /INSERT INTO decisions/i, rows: [{ id: 'dec-002' }] },
    ]);
    const recorder = createDecisionRecorder({ db, now: NOW });
    const a = await recorder.recordDecision({
      tenantId: TENANT,
      decidedByKind: 'owner',
      decidedByActorId: 'user-mwikila',
      decisionSubject: 'File April royalty now',
      decidedValue: { choice: 'file_now' },
      rationale: 'Avoids penalty',
    });
    const b = await recorder.recordDecision({
      tenantId: TENANT,
      decidedByKind: 'owner',
      decidedByActorId: 'user-mwikila',
      decisionSubject: 'Snooze NEMC EIA reminder 24h',
      decidedValue: { snoozeHours: 24 },
      rationale: 'Awaiting NEMC reply on the renewal form',
    });
    expect(a.prevHash).toBeNull();
    expect(b.prevHash).toBe(FIRST_HASH);
    expect(b.entryHash).not.toBe(a.entryHash);
  });

  it('changes the hash when the rationale changes', async () => {
    const { db: db1 } = makeStubDb([
      { textMatch: /SELECT entry_hash/i, rows: [] },
      { textMatch: /INSERT INTO decisions/i, rows: [{ id: 'dec-001' }] },
    ]);
    const { db: db2 } = makeStubDb([
      { textMatch: /SELECT entry_hash/i, rows: [] },
      { textMatch: /INSERT INTO decisions/i, rows: [{ id: 'dec-002' }] },
    ]);
    const recorder1 = createDecisionRecorder({ db: db1, now: NOW });
    const recorder2 = createDecisionRecorder({ db: db2, now: NOW });
    const base = {
      tenantId: TENANT,
      decidedByKind: 'owner' as const,
      decidedByActorId: 'user-mwikila',
      decisionSubject: 'File April royalty now',
      decidedValue: { choice: 'file_now' },
    };
    const a = await recorder1.recordDecision({
      ...base,
      rationale: 'Avoids 5% penalty',
    });
    const b = await recorder2.recordDecision({
      ...base,
      rationale: 'Avoids the 5% penalty',
    });
    expect(a.entryHash).not.toBe(b.entryHash);
  });
});

describe('createDecisionRecorder.recordOutcome', () => {
  it('persists an outcome row + grades the decision', async () => {
    const { db } = makeStubDb([
      { textMatch: /SELECT 1 FROM decisions/i, rows: [{ '?column?': 1 }] },
      { textMatch: /SELECT entry_hash/i, rows: [] },
      { textMatch: /INSERT INTO decision_outcomes/i, rows: [{ id: 'out-001' }] },
    ]);
    const recorder = createDecisionRecorder({ db, now: NOW });
    const out = await recorder.recordOutcome({
      tenantId: TENANT,
      decisionId: '11111111-2222-3333-4444-555555555555',
      outcomeSummary: 'Filing accepted same day, no penalty incurred',
      observedValueTzs: 2500000,
      retrospectiveGrade: 'good',
      recordedBy: 'reconciler',
      learnings: 'Filing 3 days early reliably avoids penalty',
    });
    expect(out.id).toBe('out-001');
    expect(out.retrospectiveGrade).toBe('good');
    expect(out.entryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an outcome for an unknown decision', async () => {
    const { db } = makeStubDb([{ textMatch: /SELECT 1 FROM decisions/i, rows: [] }]);
    const recorder = createDecisionRecorder({ db });
    await expect(
      recorder.recordOutcome({
        tenantId: TENANT,
        decisionId: '11111111-2222-3333-4444-555555555555',
        outcomeSummary: 'orphan',
        retrospectiveGrade: 'good',
        recordedBy: 'reconciler',
      }),
    ).rejects.toMatchObject({ code: 'unknown_decision' });
  });
});

describe('createDecisionRecorder.recordLink', () => {
  it('rejects a self-loop link', async () => {
    const { db } = makeStubDb([]);
    const recorder = createDecisionRecorder({ db });
    const sameId = '11111111-2222-3333-4444-555555555555';
    await expect(
      recorder.recordLink({
        tenantId: TENANT,
        sourceDecisionId: sameId,
        targetDecisionId: sameId,
        relationship: 'supersedes',
      }),
    ).rejects.toBeInstanceOf(DecisionRecorderError);
  });

  it('persists a supersedes link with a chained hash', async () => {
    const { db } = makeStubDb([
      { textMatch: /SELECT 1 FROM decisions/i, rows: [{ '?column?': 1 }] },
      { textMatch: /SELECT 1 FROM decisions/i, rows: [{ '?column?': 1 }] },
      { textMatch: /SELECT entry_hash/i, rows: [] },
      { textMatch: /INSERT INTO decision_links/i, rows: [] },
    ]);
    const recorder = createDecisionRecorder({ db });
    const link = await recorder.recordLink({
      tenantId: TENANT,
      sourceDecisionId: '11111111-2222-3333-4444-555555555555',
      targetDecisionId: '99999999-8888-7777-6666-555555555555',
      relationship: 'supersedes',
      note: 'Updated rationale after NEMC clarification',
    });
    expect(link.relationship).toBe('supersedes');
    expect(link.entryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(link.prevHash).toBeNull();
  });
});
