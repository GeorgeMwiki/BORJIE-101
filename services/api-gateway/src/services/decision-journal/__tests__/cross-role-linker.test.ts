/**
 * Cross-role linker (K-C) tests.
 *
 * Covers:
 *  - owner decision touching a site fans out to managers + workers
 *  - assignees deduped across multiple tasks at the same scope
 *  - non-owner decisions do not auto-fan-out
 *  - empty scopeIds is a no-op
 *  - listDecisionsAffectingUser returns ordered subjects + rationale
 *  - foreign roles (e.g. T1_owner_strategist) are filtered out
 */

import { describe, it, expect } from 'vitest';
import {
  createCrossRoleLinker,
  createDefaultCrossRoleInsertPort,
  listDecisionsAffectingUser,
  type CrossRoleLinkerDb,
  type CrossRoleDirectInsertPort,
} from '../cross-role-linker.js';
import type { RecordedDecision } from '../types.js';

interface TaskFixture {
  readonly assigneeId: string;
  readonly assigneeRole: string;
  readonly scopeId: string;
  readonly status: 'open' | 'in_progress' | 'blocked' | 'done';
}

interface LinkFixture {
  readonly tenantId: string;
  readonly sourceDecisionId: string;
  readonly targetUserId: string;
  readonly targetRole: string;
  readonly note: string;
}

function makeDb(tasks: ReadonlyArray<TaskFixture>): {
  db: CrossRoleLinkerDb;
} {
  const db: CrossRoleLinkerDb = {
    async execute(query: unknown) {
      const q = query as { queryChunks?: ReadonlyArray<unknown> };
      const fragments = (q.queryChunks ?? []).map((c) => JSON.stringify(c));
      const joined = fragments.join(' ');
      if (joined.includes('mining_tasks')) {
        // Extract the bound scopeIds + tenantId — for the test we
        // just filter the fixture array on status / role.
        const open = tasks.filter(
          (t) => t.status === 'open' || t.status === 'in_progress' || t.status === 'blocked',
        );
        return open.map((t) => ({
          assignee_id: t.assigneeId,
          assignee_role: t.assigneeRole,
        }));
      }
      return [];
    },
  };
  return { db };
}

function makeRecordedDecision(
  partial: Partial<RecordedDecision> & {
    readonly id: string;
    readonly tenantId: string;
    readonly scopeIds: ReadonlyArray<string>;
  },
): RecordedDecision {
  return Object.freeze({
    id: partial.id,
    tenantId: partial.tenantId,
    decidedByKind: partial.decidedByKind ?? 'owner',
    decidedByActorId: partial.decidedByActorId ?? 'owner_001',
    decisionSubject: partial.decisionSubject ?? 'expand Mwadui pit B operations',
    decisionSubjectEntityKind: partial.decisionSubjectEntityKind ?? null,
    decisionSubjectEntityId: partial.decisionSubjectEntityId ?? null,
    decidedValue: partial.decidedValue ?? Object.freeze({ choice: 'expand' }),
    alternativesConsidered: partial.alternativesConsidered ?? Object.freeze([]),
    rationale: partial.rationale ?? 'increased copper assay results',
    confidence: partial.confidence ?? 0.85,
    decidedAt: partial.decidedAt ?? '2026-05-29T10:00:00.000Z',
    scopeIds: Object.freeze(partial.scopeIds.slice()),
    relatedPredictionId: partial.relatedPredictionId ?? null,
    relatedActionAuditHash: partial.relatedActionAuditHash ?? null,
    status: partial.status ?? 'committed',
    provenance: partial.provenance ?? Object.freeze({}),
    entryHash: partial.entryHash ?? 'hash_x',
    prevHash: partial.prevHash ?? null,
  });
}

function makeCapturingInsertPort(): {
  port: CrossRoleDirectInsertPort;
  captured: LinkFixture[];
} {
  const captured: LinkFixture[] = [];
  const port: CrossRoleDirectInsertPort = {
    async insertRoleLink(input) {
      captured.push({
        tenantId: input.tenantId,
        sourceDecisionId: input.sourceDecisionId,
        targetUserId: input.targetUserId,
        targetRole: input.targetRole,
        note: input.note ?? '',
      });
    },
  };
  return { port, captured };
}

describe('createCrossRoleLinker', () => {
  it('fans an owner decision out to every manager + worker on the scope', async () => {
    const { db } = makeDb([
      { assigneeId: 'mgr_john', assigneeRole: 'T3_module_manager', scopeId: 'mwadui', status: 'open' },
      { assigneeId: 'worker_hassan', assigneeRole: 'T4_field_employee', scopeId: 'mwadui', status: 'in_progress' },
    ]);
    const { port, captured } = makeCapturingInsertPort();
    const linker = createCrossRoleLinker({ db, insertPort: port });
    const assignees = await linker.linkAffected(
      makeRecordedDecision({
        id: 'dec_1',
        tenantId: 'tenant_a',
        scopeIds: ['mwadui'],
      }),
    );
    expect(assignees).toHaveLength(2);
    expect(captured).toHaveLength(2);
    expect(captured[0]?.targetRole).toBe('T3_module_manager');
    expect(captured[1]?.targetRole).toBe('T4_field_employee');
  });

  it('dedupes assignees across multiple tasks at the same scope', async () => {
    const { db } = makeDb([
      { assigneeId: 'mgr_john', assigneeRole: 'T3_module_manager', scopeId: 'mwadui', status: 'open' },
      { assigneeId: 'mgr_john', assigneeRole: 'T3_module_manager', scopeId: 'mwadui', status: 'in_progress' },
    ]);
    const { port, captured } = makeCapturingInsertPort();
    const linker = createCrossRoleLinker({ db, insertPort: port });
    const assignees = await linker.linkAffected(
      makeRecordedDecision({
        id: 'dec_2',
        tenantId: 'tenant_a',
        scopeIds: ['mwadui'],
      }),
    );
    expect(assignees).toHaveLength(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.targetUserId).toBe('mgr_john');
  });

  it('does not fan out non-owner decisions (brain / agent_apply / policy)', async () => {
    const { db } = makeDb([
      { assigneeId: 'mgr_john', assigneeRole: 'T3_module_manager', scopeId: 'mwadui', status: 'open' },
    ]);
    const { port, captured } = makeCapturingInsertPort();
    const linker = createCrossRoleLinker({ db, insertPort: port });
    const result = await linker.linkAffected(
      makeRecordedDecision({
        id: 'dec_3',
        tenantId: 'tenant_a',
        scopeIds: ['mwadui'],
        decidedByKind: 'brain',
      }),
    );
    expect(result).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it('is a no-op when the decision has no scopeIds', async () => {
    const { db } = makeDb([
      { assigneeId: 'mgr_john', assigneeRole: 'T3_module_manager', scopeId: 'mwadui', status: 'open' },
    ]);
    const { port, captured } = makeCapturingInsertPort();
    const linker = createCrossRoleLinker({ db, insertPort: port });
    const result = await linker.linkAffected(
      makeRecordedDecision({
        id: 'dec_4',
        tenantId: 'tenant_a',
        scopeIds: [],
      }),
    );
    expect(result).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it('filters out roles that are not manager / worker / buyer / vendor', async () => {
    const { db } = makeDb([
      // T1 owner should NOT receive a cross-role link (they're the source).
      { assigneeId: 'owner_001', assigneeRole: 'T1_owner_strategist', scopeId: 'mwadui', status: 'open' },
      { assigneeId: 'worker_hassan', assigneeRole: 'T4_field_employee', scopeId: 'mwadui', status: 'open' },
    ]);
    const { port, captured } = makeCapturingInsertPort();
    const linker = createCrossRoleLinker({ db, insertPort: port });
    const result = await linker.linkAffected(
      makeRecordedDecision({
        id: 'dec_5',
        tenantId: 'tenant_a',
        scopeIds: ['mwadui'],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.targetRole).toBe('T4_field_employee');
    expect(captured).toHaveLength(1);
  });
});

describe('listDecisionsAffectingUser', () => {
  it('returns decisions ordered DESC by decided_at', async () => {
    const db: CrossRoleLinkerDb = {
      async execute() {
        return [
          {
            id: 'dec_2',
            decision_subject: 'expand pit C',
            rationale: 'follow up on assay',
            decided_at: '2026-05-29T12:00:00Z',
            scope_ids: ['mwadui'],
            target_role: 'T3_module_manager',
          },
          {
            id: 'dec_1',
            decision_subject: 'expand pit B',
            rationale: 'initial assay results',
            decided_at: '2026-05-28T10:00:00Z',
            scope_ids: ['mwadui'],
            target_role: 'T3_module_manager',
          },
        ];
      },
    };
    const out = await listDecisionsAffectingUser(db, {
      tenantId: 'tenant_a',
      targetUserId: 'mgr_john',
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.subject).toBe('expand pit C');
    expect(out[1]?.subject).toBe('expand pit B');
  });

  it('returns frozen arrays + frozen rows', async () => {
    const db: CrossRoleLinkerDb = {
      async execute() {
        return [
          {
            id: 'dec_1',
            decision_subject: 'subj',
            rationale: 'rat',
            decided_at: '2026-05-29T00:00:00Z',
            scope_ids: ['mwadui'],
            target_role: 'T3_module_manager',
          },
        ];
      },
    };
    const out = await listDecisionsAffectingUser(db, {
      tenantId: 't',
      targetUserId: 'u',
    });
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out[0])).toBe(true);
  });
});

describe('createDefaultCrossRoleInsertPort', () => {
  it('builds an insert port that calls db.execute', async () => {
    let called = 0;
    const db: CrossRoleLinkerDb = {
      async execute() {
        called += 1;
        return [];
      },
    };
    const port = createDefaultCrossRoleInsertPort(db);
    await port.insertRoleLink({
      tenantId: 't',
      sourceDecisionId: 'd',
      targetUserId: 'u',
      targetRole: 'T3_module_manager',
    });
    expect(called).toBeGreaterThan(0);
  });
});
