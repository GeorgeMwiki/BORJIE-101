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
  // Drizzle's `sql` template renders to a non-trivial QueryPromise
  // shape; pulling readable text out of `queryChunks` for the
  // textMatch regex is brittle (the chunks include parameter objects
  // that stringify to `[object Object]`). We accept any matcher silently
  // and fall back to call-order checking — the recorder's call
  // sequence is deterministic, and the order alone is enough to pin
  // the contract. (`textMatch` is preserved on the call list for
  // documentation but not strictly enforced.)
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

describe('G3 — UNIQUE-violation retry (robustness 2026-05-29)', () => {
  // The recorder issues calls in a fixed sequence for recordDecision:
  // SELECT head → INSERT. We script the response by call index rather
  // than by SQL text match because drizzle's `sql` tagged-template does
  // not reliably stringify back to source text under vitest (the legacy
  // `queryChunks` extraction in makeStubDb above is best-effort).
  function makeIndexedDb(handlers: Array<() => unknown>) {
    let i = -1;
    return {
      execute: async (_query: unknown) => {
        i += 1;
        const handler = handlers[i];
        if (!handler) {
          throw new Error(`indexedDb: no handler for call ${i}`);
        }
        const out = handler();
        if (out instanceof Error) throw out;
        return out;
      },
    };
  }

  function uniqueViolationErr(): Error {
    const err = new Error(
      'duplicate key value violates unique constraint "decisions_tenant_prev_hash_unique"',
    ) as Error & { code?: string };
    err.code = '23505';
    return err;
  }

  it('retries once and succeeds after a 23505 unique_violation on prev_hash', async () => {
    // Simulates the migration 0125 partial UNIQUE refusing the first
    // INSERT because a concurrent writer landed first. The recorder
    // re-reads the fresh head and the second INSERT succeeds.
    const RIVAL_HEAD_HASH = 'rival-head-' + 'a'.repeat(54);
    const db = makeIndexedDb([
      () => ({ rows: [] }),                          // 0: SELECT — genesis
      () => uniqueViolationErr(),                    // 1: INSERT — collide
      () => ({ rows: [{ entry_hash: RIVAL_HEAD_HASH }] }), // 2: SELECT — rival visible
      () => ({ rows: [{ id: 'dec-retry-OK' }] }),    // 3: INSERT — succeed
    ]);
    const recorder = createDecisionRecorder({ db, now: NOW });
    const result = await recorder.recordDecision({
      tenantId: TENANT,
      decidedByKind: 'owner',
      decidedByActorId: 'user-mwikila',
      decisionSubject: 'Concurrent writer test',
      decidedValue: { choice: 'go' },
      rationale: 'Belt-and-braces UNIQUE retry path',
    });
    expect(result.id).toBe('dec-retry-OK');
    expect(result.prevHash).toBe(RIVAL_HEAD_HASH);
  });

  it('throws persistence_failed after the second attempt also collides', async () => {
    const db = makeIndexedDb([
      () => ({ rows: [] }),       // SELECT
      () => uniqueViolationErr(), // INSERT — collide
      () => ({ rows: [] }),       // SELECT (retry)
      () => uniqueViolationErr(), // INSERT — collide again
    ]);
    const recorder = createDecisionRecorder({ db, now: NOW });
    await expect(
      recorder.recordDecision({
        tenantId: TENANT,
        decidedByKind: 'owner',
        decidedByActorId: 'user-mwikila',
        decisionSubject: 'Pathological collision',
        decidedValue: { choice: 'no' },
        rationale: 'Both retries collide — recorder must surface persistence_failed',
      }),
    ).rejects.toMatchObject({ code: 'persistence_failed' });
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
