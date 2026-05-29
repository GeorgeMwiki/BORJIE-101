/**
 * decision-journal-tools tests.
 *
 * Drives the six read-only brain tools (recent, explain, search,
 * replay, what_did_i_decide, success_rate) with an in-memory db
 * stub. Verifies that each tool wires the right SQL shape, parses
 * the rows correctly, and returns the schema-validated payload.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  configureDecisionJournalTools,
  decisionsExplainTool,
  decisionsRecentTool,
  decisionsReplayTool,
  decisionsSearchTool,
  decisionsSuccessRateTool,
  decisionsWhatDidIDecideTool,
} from '../decision-journal-tools';

interface StubCall {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

function makeStubDb(callsInOrder: ReadonlyArray<StubCall>) {
  let i = 0;
  const execute = vi.fn(async () => {
    const next = callsInOrder[i] ?? { rows: [] };
    i += 1;
    return { rows: next.rows };
  });
  return { execute };
}

const TENANT_CTX = Object.freeze({
  tenantId: 'tenant-acme',
  actorId: 'user-mwikila',
  personaSlug: 'T1_owner_strategist',
});

describe('decision-journal-tools', () => {
  beforeEach(() => {
    configureDecisionJournalTools({
      db: makeStubDb([]),
    });
  });

  describe('decisions.recent', () => {
    it('returns recent decisions with default limit', async () => {
      configureDecisionJournalTools({
        db: makeStubDb([
          {
            rows: [
              {
                id: 'dec-001',
                decided_by_kind: 'owner',
                decided_by_actor_id: 'user-mwikila',
                decision_subject: 'File April royalty now',
                decision_subject_entity_kind: 'royalty_filing',
                decision_subject_entity_id: 'royalty-2026-04',
                rationale: 'Avoids penalty',
                confidence: 0.82,
                decided_at: '2026-05-29T12:00:00.000Z',
                scope_ids: ['geita'],
                status: 'committed',
              },
            ],
          },
        ]),
      });
      const result = await decisionsRecentTool.handler({}, TENANT_CTX);
      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0]!.id).toBe('dec-001');
      expect(result.decisions[0]!.scopeIds).toEqual(['geita']);
      expect(result.decisions[0]!.confidence).toBe(0.82);
    });

    it('returns empty when no decisions match', async () => {
      configureDecisionJournalTools({ db: makeStubDb([{ rows: [] }]) });
      const result = await decisionsRecentTool.handler(
        { kindFilter: 'four_eye' },
        TENANT_CTX,
      );
      expect(result.decisions).toHaveLength(0);
    });
  });

  describe('decisions.explain', () => {
    it('returns rationale + outcome when graded', async () => {
      configureDecisionJournalTools({
        db: makeStubDb([
          {
            rows: [
              {
                id: '11111111-2222-3333-4444-555555555555',
                decision_subject: 'File April royalty now',
                decided_by_kind: 'owner',
                decided_by_actor_id: 'user-mwikila',
                decided_value: { choice: 'file_now' },
                alternatives_considered: [
                  { option: { choice: 'wait_friday' }, whyNot: '5% penalty' },
                ],
                rationale: 'Avoids penalty',
                confidence: 0.82,
                decided_at: '2026-04-09T08:00:00.000Z',
                status: 'committed',
                o_grade: 'good',
                o_summary: 'Filing accepted same day',
                o_value: 2500000,
                o_learnings: 'Filing 3 days early works',
                o_recorded_by: 'reconciler',
                o_observed_at: '2026-04-12T00:00:00.000Z',
              },
            ],
          },
        ]),
      });
      const result = await decisionsExplainTool.handler(
        { id: '11111111-2222-3333-4444-555555555555' },
        TENANT_CTX,
      );
      expect(result.rationale).toBe('Avoids penalty');
      expect(result.alternativesConsidered).toHaveLength(1);
      expect(result.outcome).not.toBeNull();
      expect(result.outcome?.grade).toBe('good');
      expect(result.outcome?.observedValueTzs).toBe(2500000);
    });

    it('returns outcome=null when the decision has no grade yet', async () => {
      configureDecisionJournalTools({
        db: makeStubDb([
          {
            rows: [
              {
                id: '11111111-2222-3333-4444-555555555555',
                decision_subject: 'Snooze NEMC reminder 24h',
                decided_by_kind: 'owner',
                decided_by_actor_id: 'user-mwikila',
                decided_value: { snoozeHours: 24 },
                alternatives_considered: [],
                rationale: 'Awaiting reply',
                confidence: null,
                decided_at: '2026-05-29T12:00:00.000Z',
                status: 'committed',
                o_grade: null,
              },
            ],
          },
        ]),
      });
      const result = await decisionsExplainTool.handler(
        { id: '11111111-2222-3333-4444-555555555555' },
        TENANT_CTX,
      );
      expect(result.outcome).toBeNull();
      expect(result.confidence).toBeNull();
    });

    it('throws when no decision matches the id', async () => {
      configureDecisionJournalTools({ db: makeStubDb([{ rows: [] }]) });
      await expect(
        decisionsExplainTool.handler(
          { id: '11111111-2222-3333-4444-555555555555' },
          TENANT_CTX,
        ),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('decisions.search', () => {
    it('returns full-text matches', async () => {
      configureDecisionJournalTools({
        db: makeStubDb([
          {
            rows: [
              {
                id: 'dec-001',
                decided_by_kind: 'owner',
                decided_by_actor_id: 'user-mwikila',
                decision_subject: 'Geita compliance follow-up plan',
                decision_subject_entity_kind: null,
                decision_subject_entity_id: null,
                rationale: 'NEMC EIA renewal coming up',
                confidence: 0.71,
                decided_at: '2026-04-12T00:00:00.000Z',
                scope_ids: ['geita'],
                status: 'committed',
              },
            ],
          },
        ]),
      });
      const result = await decisionsSearchTool.handler(
        { query: 'Geita compliance' },
        TENANT_CTX,
      );
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.decisionSubject).toMatch(/Geita/);
    });
  });

  describe('decisions.replay', () => {
    it('returns linked decisions + provenance', async () => {
      configureDecisionJournalTools({
        db: makeStubDb([
          {
            rows: [
              {
                id: '11111111-2222-3333-4444-555555555555',
                decision_subject: 'File April royalty now',
                rationale: 'Avoids penalty',
                decided_at: '2026-04-09T08:00:00.000Z',
                related_prediction_id: 'pred-royalty-apr',
                provenance: { via: 'chat', sessionId: 's1', turnId: 't42' },
              },
            ],
          },
          {
            rows: [
              {
                relationship: 'informed_by',
                id: '99999999-8888-7777-6666-555555555555',
                decision_subject: 'Defer May filing',
                decided_at: '2026-05-05T00:00:00.000Z',
              },
            ],
          },
        ]),
      });
      const result = await decisionsReplayTool.handler(
        { id: '11111111-2222-3333-4444-555555555555' },
        TENANT_CTX,
      );
      expect(result.predictionId).toBe('pred-royalty-apr');
      expect(result.provenance.sessionId).toBe('s1');
      expect(result.linkedDecisions).toHaveLength(1);
      expect(result.linkedDecisions[0]!.relationship).toBe('informed_by');
    });
  });

  describe('decisions.what_did_i_decide', () => {
    it('returns matching decisions with grade', async () => {
      configureDecisionJournalTools({
        db: makeStubDb([
          {
            rows: [
              {
                id: 'dec-001',
                decision_subject: 'File April royalty 3 days early',
                rationale: 'Avoids penalty',
                decided_at: '2026-04-09T08:00:00.000Z',
                grade: 'good',
                summary: 'Filing accepted same day, no penalty',
              },
            ],
          },
        ]),
      });
      const result = await decisionsWhatDidIDecideTool.handler(
        { about: 'royalty filing' },
        TENANT_CTX,
      );
      expect(result.about).toBe('royalty filing');
      expect(result.decisions[0]!.grade).toBe('good');
      expect(result.decisions[0]!.summary).toMatch(/accepted same day/);
    });
  });

  describe('decisions.success_rate', () => {
    it('aggregates grades into a success rate', async () => {
      configureDecisionJournalTools({
        db: makeStubDb([
          {
            rows: [
              { grade: 'good', n: 7 },
              { grade: 'neutral', n: 2 },
              { grade: 'bad', n: 1 },
            ],
          },
        ]),
      });
      const result = await decisionsSuccessRateTool.handler({}, TENANT_CTX);
      expect(result.totalGraded).toBe(10);
      expect(result.good).toBe(7);
      expect(result.successRate).toBe(0.7);
    });

    it('returns successRate=0 when no graded decisions exist', async () => {
      configureDecisionJournalTools({ db: makeStubDb([{ rows: [] }]) });
      const result = await decisionsSuccessRateTool.handler({}, TENANT_CTX);
      expect(result.totalGraded).toBe(0);
      expect(result.successRate).toBe(0);
    });
  });
});
