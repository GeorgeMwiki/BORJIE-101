/**
 * Unit tests for createSessionReplayChunksService.
 *
 * Mirrors the sensorium-event-log.service.test.ts pattern: hand-rolled
 * in-memory Drizzle stub + drizzle-orm operator mocks so we can assert:
 *
 *   1. appendChunk inserts a valid row, returns ok=true with chunkId
 *   2. appendChunk dedupes on (session_id, sequence_number) — duplicate
 *      simulated unique-violation returns ok=false, reason='duplicate'
 *   3. appendChunk rejects rows with missing required fields (invalid)
 *   4. appendChunk surfaces ok=false reason='db-error' on hard DB failure
 *   5. listForSession returns chunks ordered oldest-first by sequence,
 *      scoped to (tenantId, sessionId)
 *   6. listForSession returns [] on DB error (side-channel safety)
 *   7. listRecentSessions groups by sessionId and reports chunkCount /
 *      first+last capture timestamps within the rolling window
 *   8. appendChunk caps + sanitises numeric fields (negative event/
 *      byte counts coerced to 0)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSessionReplayChunksService,
  type SessionReplayChunkInput,
} from '../session-replay-chunks.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredRow {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  surface: string;
  sequenceNumber: number;
  eventCount: number;
  byteSize: number;
  storageUri: string;
  capturedAt: Date;
  receivedAt: Date;
}

interface CapturedFilter {
  tenantId?: string;
  sessionId?: string;
  sinceMs?: number;
}

const captured: { current: CapturedFilter } = { current: {} };

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'tenant_id') captured.current.tenantId = String(value);
      else if (colName === 'session_id')
        captured.current.sessionId = String(value);
      return { _op: 'eq', col: colName, value };
    },
    gte: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'captured_at' && value instanceof Date) {
        captured.current.sinceMs = value.getTime();
      }
      return { _op: 'gte', col: colName, value };
    },
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    asc: (column: unknown) => ({ _op: 'asc', column }),
    desc: (column: unknown) => ({ _op: 'desc', column }),
    sql: Object.assign(
      (strings: TemplateStringsArray) => ({ _sql: strings.join('') }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

function makeStubDb(initial: ReadonlyArray<StoredRow> = []): {
  client: DatabaseClient;
  readonly rows: StoredRow[];
  fail: { insert: 'duplicate' | 'db-error' | null; select: boolean };
} {
  const state = {
    rows: [...initial],
    fail: { insert: null, select: false } as {
      insert: 'duplicate' | 'db-error' | null;
      select: boolean;
    },
  };

  function applyFilter(rows: StoredRow[]): StoredRow[] {
    const f = captured.current;
    let out = [...rows];
    if (f.tenantId !== undefined) {
      out = out.filter((r) => r.tenantId === f.tenantId);
    }
    if (f.sessionId !== undefined) {
      out = out.filter((r) => r.sessionId === f.sessionId);
    }
    if (f.sinceMs !== undefined) {
      out = out.filter((r) => r.capturedAt.getTime() >= (f.sinceMs ?? 0));
    }
    return out;
  }

  function makeSelectChain(project: 'rows' | 'summary'): unknown {
    let appliedLimit = Infinity;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: (n: number) => {
        appliedLimit = n;
        return chain;
      },
      then: (resolve: (rows: unknown) => unknown) => {
        if (state.fail.select) {
          captured.current = {};
          throw new Error('stub select failure');
        }
        const filtered = applyFilter(state.rows);
        if (project === 'summary') {
          const byKey = new Map<
            string,
            {
              sessionId: string;
              userId: string;
              surface: string;
              firstCapturedAt: Date;
              lastCapturedAt: Date;
              chunkCount: number;
            }
          >();
          for (const r of filtered) {
            const key = `${r.sessionId}::${r.userId}::${r.surface}`;
            const prev = byKey.get(key);
            if (!prev) {
              byKey.set(key, {
                sessionId: r.sessionId,
                userId: r.userId,
                surface: r.surface,
                firstCapturedAt: r.capturedAt,
                lastCapturedAt: r.capturedAt,
                chunkCount: 1,
              });
            } else {
              prev.chunkCount += 1;
              if (r.capturedAt < prev.firstCapturedAt) {
                prev.firstCapturedAt = r.capturedAt;
              }
              if (r.capturedAt > prev.lastCapturedAt) {
                prev.lastCapturedAt = r.capturedAt;
              }
            }
          }
          const all = [...byKey.values()].sort(
            (a, b) =>
              b.lastCapturedAt.getTime() - a.lastCapturedAt.getTime(),
          );
          const sliced = Number.isFinite(appliedLimit)
            ? all.slice(0, appliedLimit)
            : all;
          captured.current = {};
          return resolve(sliced);
        }
        const sorted = filtered.sort(
          (a, b) => a.sequenceNumber - b.sequenceNumber,
        );
        const sliced = Number.isFinite(appliedLimit)
          ? sorted.slice(0, appliedLimit)
          : sorted;
        captured.current = {};
        return resolve(sliced);
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    const chain: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        if (state.fail.insert === 'duplicate') {
          return {
            then: (_resolve: unknown, reject: (e: Error) => unknown) =>
              reject(
                new Error(
                  'duplicate key value violates unique constraint "idx_session_replay_chunks_session_seq"',
                ),
              ),
          };
        }
        if (state.fail.insert === 'db-error') {
          return {
            then: (_resolve: unknown, reject: (e: Error) => unknown) =>
              reject(new Error('connection reset')),
          };
        }
        // Defence: check sequence-uniqueness in the stub too.
        const seqClash = state.rows.find(
          (r) =>
            r.sessionId === String(v.sessionId) &&
            r.sequenceNumber === Number(v.sequenceNumber),
        );
        if (seqClash) {
          return {
            then: (_resolve: unknown, reject: (e: Error) => unknown) =>
              reject(
                new Error(
                  'duplicate key value violates unique constraint "idx_session_replay_chunks_session_seq"',
                ),
              ),
          };
        }
        state.rows.push({
          id: String(v.id ?? `r_${state.rows.length}`),
          tenantId: String(v.tenantId ?? ''),
          userId: String(v.userId ?? ''),
          sessionId: String(v.sessionId ?? ''),
          surface: String(v.surface ?? ''),
          sequenceNumber: Number(v.sequenceNumber ?? 0),
          eventCount: Number(v.eventCount ?? 0),
          byteSize: Number(v.byteSize ?? 0),
          storageUri: String(v.storageUri ?? ''),
          capturedAt:
            v.capturedAt instanceof Date
              ? v.capturedAt
              : new Date(String(v.capturedAt ?? Date.now())),
          receivedAt: new Date(),
        });
        return { then: (resolve: () => unknown) => resolve() };
      },
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: (cols?: Record<string, unknown>) => {
      const keyCount = cols ? Object.keys(cols).length : Infinity;
      return makeSelectChain(keyCount === 6 ? 'summary' : 'rows');
    },
    insert: () => makeInsertChain(),
  };
  const result = {
    client: db as unknown as DatabaseClient,
  } as {
    client: DatabaseClient;
    readonly rows: StoredRow[];
    fail: { insert: 'duplicate' | 'db-error' | null; select: boolean };
  };
  Object.defineProperty(result, 'rows', { get: () => state.rows });
  Object.defineProperty(result, 'fail', { get: () => state.fail });
  return result;
}

function makeInput(
  overrides: Partial<SessionReplayChunkInput> = {},
): SessionReplayChunkInput {
  return {
    tenantId: 't_demo',
    userId: 'u_alice',
    sessionId: 'sess_1',
    surface: 'admin-web',
    sequenceNumber: 0,
    eventCount: 12,
    byteSize: 4096,
    storageUri: 'file:///tmp/session-replay/abc.gz',
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeStored(overrides: Partial<StoredRow>): StoredRow {
  return {
    id: 'id-x',
    tenantId: 't_demo',
    userId: 'u_alice',
    sessionId: 'sess_1',
    surface: 'admin-web',
    sequenceNumber: 0,
    eventCount: 0,
    byteSize: 0,
    storageUri: 'file:///tmp/x.gz',
    capturedAt: new Date(),
    receivedAt: new Date(),
    ...overrides,
  };
}

describe('createSessionReplayChunksService', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('appendChunk inserts a valid row', async () => {
    const stub = makeStubDb();
    const svc = createSessionReplayChunksService(stub.client);
    const out = await svc.appendChunk(makeInput());
    expect(out.ok).toBe(true);
    expect(out.reason).toBe('inserted');
    expect(typeof out.chunkId).toBe('string');
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.sequenceNumber).toBe(0);
  });

  it('appendChunk dedupes on (sessionId, sequenceNumber)', async () => {
    const stub = makeStubDb();
    const svc = createSessionReplayChunksService(stub.client);
    const first = await svc.appendChunk(
      makeInput({ sequenceNumber: 7 }),
    );
    expect(first.ok).toBe(true);
    const second = await svc.appendChunk(
      makeInput({ sequenceNumber: 7 }),
    );
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('duplicate');
    expect(stub.rows).toHaveLength(1);
  });

  it('appendChunk rejects rows missing required fields as invalid', async () => {
    const stub = makeStubDb();
    const svc = createSessionReplayChunksService(stub.client);
    const out = await svc.appendChunk(
      makeInput({ tenantId: '' }),
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('invalid');
    expect(stub.rows).toHaveLength(0);
  });

  it('appendChunk surfaces db-error on hard DB failure', async () => {
    const stub = makeStubDb();
    stub.fail.insert = 'db-error';
    const svc = createSessionReplayChunksService(stub.client);
    const out = await svc.appendChunk(makeInput());
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('db-error');
  });

  it('appendChunk clamps negative numeric fields to zero', async () => {
    const stub = makeStubDb();
    const svc = createSessionReplayChunksService(stub.client);
    const out = await svc.appendChunk(
      makeInput({
        sequenceNumber: 3,
        eventCount: -5,
        byteSize: -1024,
      }),
    );
    expect(out.ok).toBe(true);
    expect(stub.rows[0]?.eventCount).toBe(0);
    expect(stub.rows[0]?.byteSize).toBe(0);
  });

  it('listForSession returns chunks ordered oldest-first by sequence, tenant+session scoped', async () => {
    const stub = makeStubDb([
      makeStored({
        id: 'c1',
        sessionId: 'sess_1',
        sequenceNumber: 2,
      }),
      makeStored({
        id: 'c0',
        sessionId: 'sess_1',
        sequenceNumber: 0,
      }),
      makeStored({
        id: 'c1b',
        sessionId: 'sess_1',
        sequenceNumber: 1,
      }),
      makeStored({
        id: 'other',
        sessionId: 'sess_2',
        sequenceNumber: 0,
      }),
      makeStored({
        id: 'cross-tenant',
        tenantId: 't_other',
        sessionId: 'sess_1',
        sequenceNumber: 99,
      }),
    ]);
    const svc = createSessionReplayChunksService(stub.client);
    const rows = await svc.listForSession({
      tenantId: 't_demo',
      sessionId: 'sess_1',
    });
    expect(rows.map((r) => r.id)).toEqual(['c0', 'c1b', 'c1']);
  });

  it('listForSession returns [] on DB error (side-channel safety)', async () => {
    const stub = makeStubDb([
      makeStored({ id: 'c0', sessionId: 'sess_1', sequenceNumber: 0 }),
    ]);
    stub.fail.select = true;
    const svc = createSessionReplayChunksService(stub.client);
    const rows = await svc.listForSession({
      tenantId: 't_demo',
      sessionId: 'sess_1',
    });
    expect(rows).toEqual([]);
  });

  it('listRecentSessions groups by sessionId with chunkCount + capture window', async () => {
    const now = Date.now();
    const stub = makeStubDb([
      makeStored({
        id: 'a',
        sessionId: 'sess_1',
        sequenceNumber: 0,
        capturedAt: new Date(now - 60 * 1000),
      }),
      makeStored({
        id: 'b',
        sessionId: 'sess_1',
        sequenceNumber: 1,
        capturedAt: new Date(now - 10 * 1000),
      }),
      makeStored({
        id: 'c',
        sessionId: 'sess_2',
        sequenceNumber: 0,
        capturedAt: new Date(now - 30 * 1000),
      }),
    ]);
    const svc = createSessionReplayChunksService(stub.client);
    const sessions = await svc.listRecentSessions({
      tenantId: 't_demo',
      windowMinutes: 60,
    });
    expect(sessions).toHaveLength(2);
    const sess1 = sessions.find((s) => s.sessionId === 'sess_1');
    expect(sess1?.chunkCount).toBe(2);
    // Newest session is first.
    expect(sessions[0]?.sessionId).toBe('sess_1');
  });
});
