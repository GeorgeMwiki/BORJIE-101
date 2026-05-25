/**
 * Unit tests for `PostgresMemoryBlockStore`.
 *
 * Uses a hand-rolled SQL recorder fake — assertions are on the SQL
 * shape and the row marshalling, not on a live DB.
 */

import { describe, expect, it } from 'vitest';
import {
  PostgresMemoryBlockStore,
  type MemoryBlockDbPort,
} from '../postgres-memory-block-store.js';
import type { MemoryBlock, MemoryBlockStore } from '../memory-block-port.js';

interface RecordedCall {
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

function makeRecorder(
  responses: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>,
): {
  readonly db: MemoryBlockDbPort;
  readonly calls: RecordedCall[];
} {
  let i = 0;
  const calls: RecordedCall[] = [];
  return {
    calls,
    db: {
      async execute(args): Promise<ReadonlyArray<Record<string, unknown>>> {
        calls.push({ sql: args.sql, params: args.params });
        return responses[i++] ?? [];
      },
    },
  };
}

const now = new Date('2026-05-21T00:00:00Z');
const rowShape: Record<string, unknown> = {
  id: 'mb_1',
  tenant_id: 'tenant-A',
  session_id: 'session-1',
  kind: 'persona',
  content: 'I am the agent',
  metadata: { v: 1 },
  created_at: now,
  updated_at: now,
};

describe('PostgresMemoryBlockStore', (): void => {
  it('throws when db is missing', (): void => {
    expect(
      () =>
        new PostgresMemoryBlockStore({
          db: undefined as unknown as MemoryBlockDbPort,
        }),
    ).toThrow(/db.execute/);
  });

  it('satisfies the MemoryBlockStore port', (): void => {
    const { db } = makeRecorder([]);
    const store: MemoryBlockStore = new PostgresMemoryBlockStore({ db });
    expect(typeof store.list).toBe('function');
    expect(typeof store.upsert).toBe('function');
    expect(typeof store.remove).toBe('function');
  });

  it('lists by (tenant, session) and parses rows', async (): Promise<void> => {
    const { db, calls } = makeRecorder([[rowShape]]);
    const store = new PostgresMemoryBlockStore({ db });
    const rows = await store.list({
      tenantId: 'tenant-A',
      sessionId: 'session-1',
    });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('mb_1');
    expect(rows[0].kind).toBe('persona');
    expect(rows[0].metadata).toEqual({ v: 1 });
    expect(rows[0].createdAt instanceof Date).toBe(true);
    expect(calls[0].sql).toContain('SELECT id, tenant_id, session_id, kind');
    expect(calls[0].sql).toContain('memory_blocks');
    expect(calls[0].sql).toContain('ORDER BY updated_at DESC');
    expect(calls[0].params).toEqual(['tenant-A', 'session-1']);
  });

  it('handles NULL tenant_id in list', async (): Promise<void> => {
    const { db, calls } = makeRecorder([[]]);
    const store = new PostgresMemoryBlockStore({ db });
    await store.list({ tenantId: null, sessionId: 'session-1' });
    expect(calls[0].sql).toContain('tenant_id IS NULL');
    expect(calls[0].params).toEqual(['session-1']);
  });

  it('upsert returns the inserted row', async (): Promise<void> => {
    const { db, calls } = makeRecorder([[rowShape]]);
    const store = new PostgresMemoryBlockStore({
      db,
      generateId: () => 'mb_1',
      now: () => now,
    });
    const block = await store.upsert({
      tenantId: 'tenant-A',
      sessionId: 'session-1',
      kind: 'persona',
      content: 'I am the agent',
      metadata: { v: 1 },
    });
    expect(block.id).toBe('mb_1');
    expect(calls[0].sql).toContain('INSERT INTO memory_blocks');
    expect(calls[0].sql).toContain('ON CONFLICT');
    expect(calls[0].params[0]).toBe('mb_1');
    expect(calls[0].params[1]).toBe('tenant-A');
  });

  it('upsert falls back to UPDATE on PK collision', async (): Promise<void> => {
    const { db, calls } = makeRecorder([[], [rowShape]]);
    const store = new PostgresMemoryBlockStore({ db });
    const block = await store.upsert({
      id: 'mb_1',
      tenantId: 'tenant-A',
      sessionId: 'session-1',
      kind: 'persona',
      content: 'updated content',
    });
    expect(block.id).toBe('mb_1');
    expect(calls.length).toBe(2);
    expect(calls[1].sql).toContain('UPDATE memory_blocks');
    expect(calls[1].sql).toContain('SET content');
  });

  it('upsert throws when content is not a string', async (): Promise<void> => {
    const { db } = makeRecorder([]);
    const store = new PostgresMemoryBlockStore({ db });
    await expect(
      store.upsert({
        tenantId: 't',
        sessionId: 's',
        kind: 'persona',
        // @ts-expect-error - runtime guard
        content: 42,
      }),
    ).rejects.toThrow(/content/);
  });

  it('remove issues parameterised DELETE', async (): Promise<void> => {
    const { db, calls } = makeRecorder([[]]);
    const store = new PostgresMemoryBlockStore({ db });
    await store.remove({ tenantId: 'tenant-A', id: 'mb_1' });
    expect(calls[0].sql).toContain('DELETE FROM memory_blocks');
    expect(calls[0].params).toEqual(['mb_1', 'tenant-A']);
  });

  it('remove with NULL tenant uses IS NULL clause', async (): Promise<void> => {
    const { db, calls } = makeRecorder([[]]);
    const store = new PostgresMemoryBlockStore({ db });
    await store.remove({ tenantId: null, id: 'mb_1' });
    expect(calls[0].sql).toContain('tenant_id IS NULL');
    expect(calls[0].params).toEqual(['mb_1']);
  });

  it('parses metadata even when delivered as a JSON string', async (): Promise<void> => {
    const stringMetaRow = { ...rowShape, metadata: '{"k":"v"}' };
    const { db } = makeRecorder([[stringMetaRow]]);
    const store = new PostgresMemoryBlockStore({ db });
    const rows = await store.list({
      tenantId: 'tenant-A',
      sessionId: 'session-1',
    });
    expect(rows[0].metadata).toEqual({ k: 'v' });
  });

  it('parses null metadata to empty object', async (): Promise<void> => {
    const nullMetaRow: Record<string, unknown> = { ...rowShape, metadata: null };
    const { db } = makeRecorder([[nullMetaRow]]);
    const store = new PostgresMemoryBlockStore({ db });
    const rows: ReadonlyArray<MemoryBlock> = await store.list({
      tenantId: 'tenant-A',
      sessionId: 'session-1',
    });
    expect(rows[0].metadata).toEqual({});
  });
});
