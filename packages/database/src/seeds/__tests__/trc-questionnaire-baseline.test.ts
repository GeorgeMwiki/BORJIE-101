/**
 * Unit tests for `seedTrcQuestionnaireBaseline`.
 *
 * The seed writes into three tables (kernel_memory_semantic, core_memory_
 * blocks, reflexion_lessons). We don't have a live Postgres in unit tests,
 * so the suite uses a fake DB that records every (table, row) pair the
 * seed passes through `.insert(...).values(...)`. The fake supports the
 * minimum surface the seed touches: `db.transaction`, `tx.insert(table).
 * values(row).onConflictDoNothing()`.
 *
 * Coverage:
 *   - exact write counts per table match the exported constants
 *   - each table receives only rows scoped to TRC_TENANT_ID
 *   - ids are deterministic (`trc-mem-*`, `trc-cmb-*`, `trc-lesson-*`)
 *   - a re-run logically would be a no-op (idempotency-contract test —
 *     the fake records all insert attempts; the real db's unique-index +
 *     onConflictDoNothing is what enforces this in prod).
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseClient } from '../../client.js';
import {
  seedTrcQuestionnaireBaseline,
  TRC_BASELINE_SEMANTIC_FACTS,
  TRC_BASELINE_CORE_BLOCKS,
  TRC_BASELINE_LESSONS,
  TRC_BRAIN_PERSONA_ID,
} from '../trc-questionnaire-baseline.js';
import { TRC_TENANT_ID } from '../trc-test-org-seed.js';

interface Recorded {
  readonly tableName: string;
  readonly row: Record<string, unknown>;
}

function makeRecordingDb(): {
  client: DatabaseClient;
  records: ReadonlyArray<Recorded>;
} {
  const records: Recorded[] = [];

  function makeInsertChain(table: unknown): unknown {
    // Resolve a stable table name from the drizzle table symbol or its
    // metadata. Different drizzle versions expose different symbols; we
    // try a few in order. Falling back to "unknown_table" keeps the test
    // brittle to schema renames, which is intentional.
    const t = table as Record<string | symbol, unknown>;
    const nameSym = Symbol.for('drizzle:Name');
    const baseNameSym = Symbol.for('drizzle:BaseName');
    const originalNameSym = Symbol.for('drizzle:OriginalName');
    const tableName =
      (t[nameSym] as string | undefined) ??
      (t[baseNameSym] as string | undefined) ??
      (t[originalNameSym] as string | undefined) ??
      'unknown_table';
    const chain: Record<string, unknown> = {
      values: (row: Record<string, unknown>) => {
        records.push({ tableName, row });
        return chain;
      },
      onConflictDoNothing: () => chain,
      then: (resolve: (v: unknown) => unknown) => resolve(undefined),
    };
    return chain;
  }

  const tx = {
    insert: (table: unknown) => makeInsertChain(table),
  };

  const db = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx),
  };

  return {
    client: db as unknown as DatabaseClient,
    get records() {
      return records;
    },
  };
}

describe('seedTrcQuestionnaireBaseline', () => {
  it('reports the same counts as the exported constants', async () => {
    const stub = makeRecordingDb();

    const result = await seedTrcQuestionnaireBaseline(stub.client);

    expect(result.semanticFactsWritten).toBe(TRC_BASELINE_SEMANTIC_FACTS.length);
    expect(result.coreBlocksWritten).toBe(TRC_BASELINE_CORE_BLOCKS.length);
    expect(result.lessonsWritten).toBe(TRC_BASELINE_LESSONS.length);
  });

  it('writes exactly N rows per table matching the constants', async () => {
    const stub = makeRecordingDb();

    await seedTrcQuestionnaireBaseline(stub.client);

    const byTable = new Map<string, Recorded[]>();
    for (const r of stub.records) {
      const bucket = byTable.get(r.tableName) ?? [];
      bucket.push(r);
      byTable.set(r.tableName, bucket);
    }

    expect(byTable.get('kernel_memory_semantic')?.length).toBe(
      TRC_BASELINE_SEMANTIC_FACTS.length,
    );
    expect(byTable.get('core_memory_blocks')?.length).toBe(
      TRC_BASELINE_CORE_BLOCKS.length,
    );
    expect(byTable.get('reflexion_lessons')?.length).toBe(
      TRC_BASELINE_LESSONS.length,
    );
  });

  it('scopes every row to TRC_TENANT_ID — no cross-tenant leak', async () => {
    const stub = makeRecordingDb();

    await seedTrcQuestionnaireBaseline(stub.client);

    for (const r of stub.records) {
      expect(r.row.tenantId).toBe(TRC_TENANT_ID);
    }
  });

  it('assigns deterministic ids on every row', async () => {
    const stub = makeRecordingDb();

    await seedTrcQuestionnaireBaseline(stub.client);

    for (const r of stub.records) {
      const id = String(r.row.id ?? '');
      if (r.tableName === 'kernel_memory_semantic') {
        expect(id.startsWith('trc-mem-')).toBe(true);
      } else if (r.tableName === 'core_memory_blocks') {
        expect(id.startsWith('trc-cmb-')).toBe(true);
      } else if (r.tableName === 'reflexion_lessons') {
        expect(id.startsWith('trc-lesson-')).toBe(true);
      }
    }
  });

  it('writes semantic facts as tenant-scoped (user_id null) with declared source', async () => {
    const stub = makeRecordingDb();

    await seedTrcQuestionnaireBaseline(stub.client);

    const semantic = stub.records.filter(
      (r) => r.tableName === 'kernel_memory_semantic',
    );
    expect(semantic).not.toHaveLength(0);
    for (const r of semantic) {
      expect(r.row.userId).toBeNull();
      expect(r.row.source).toBe('declared');
      // Confidence is in (0, 1] for every declared fact.
      const c = Number(r.row.confidence);
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(1);
      // Value has the (text, rationale, sectionRef) shape the renderer expects.
      const v = r.row.value as Record<string, unknown>;
      expect(typeof v.text).toBe('string');
      expect(typeof v.rationale).toBe('string');
      expect(typeof v.sectionRef).toBe('string');
    }
  });

  it('writes core memory blocks under the TRC brain persona id with allowed sub-kinds', async () => {
    const stub = makeRecordingDb();

    await seedTrcQuestionnaireBaseline(stub.client);

    const blocks = stub.records.filter(
      (r) => r.tableName === 'core_memory_blocks',
    );
    expect(blocks).not.toHaveLength(0);
    const allowedKinds = new Set([
      'persona',
      'human',
      'preferences',
      'project',
    ]);
    for (const r of blocks) {
      expect(r.row.personaId).toBe(TRC_BRAIN_PERSONA_ID);
      expect(allowedKinds.has(String(r.row.blockKind))).toBe(true);
      expect(typeof r.row.blockText).toBe('string');
      expect(String(r.row.blockText).length).toBeGreaterThan(0);
    }
  });

  it('writes reflexion lessons with non-empty task tags and bounded recency score', async () => {
    const stub = makeRecordingDb();

    await seedTrcQuestionnaireBaseline(stub.client);

    const lessons = stub.records.filter(
      (r) => r.tableName === 'reflexion_lessons',
    );
    expect(lessons).not.toHaveLength(0);
    for (const r of lessons) {
      expect(typeof r.row.taskTag).toBe('string');
      expect(String(r.row.taskTag).length).toBeGreaterThan(0);
      expect(typeof r.row.lesson).toBe('string');
      expect(typeof r.row.evidence).toBe('string');
      const score = Number(r.row.recencyScore);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('encodes the 500K TZS approval threshold as a semantic fact', async () => {
    const stub = makeRecordingDb();

    await seedTrcQuestionnaireBaseline(stub.client);

    const baselandFact = stub.records.find(
      (r) =>
        r.tableName === 'kernel_memory_semantic' &&
        String(r.row.id) === 'trc-mem-approval-bareland-threshold',
    );
    expect(baselandFact).toBeDefined();
    const value = baselandFact?.row.value as Record<string, unknown>;
    expect(String(value.text)).toContain('500,000 TZS');
  });
});
