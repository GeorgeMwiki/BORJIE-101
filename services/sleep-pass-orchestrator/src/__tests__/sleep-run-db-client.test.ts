/**
 * Tests for the concrete SleepRunDbClient SQL adapter (LP-21).
 *
 * A capturing fake `execute(query)` records each statement and returns canned
 * rows. We assert the adapter:
 *   - parses RETURNING id from insertRunningRun;
 *   - maps a brain_sleep_runs row from findRunningRun;
 *   - returns latestStartedAt as an ISO string;
 *   - skips the emissions INSERT when the list is empty;
 *   - issues exactly one statement for a multi-emission insert;
 *   - throws when insertRunningRun gets no id (so the store can record it).
 */

import { describe, expect, it } from 'vitest';
import {
  createSleepRunDbClient,
  type SleepRunExecutor,
} from '../sleep-run-db-client.js';

function capturing(
  responder: (text: string) => unknown,
): SleepRunExecutor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async execute(query: unknown): Promise<unknown> {
      const text = sqlTextOf(query);
      calls.push(text);
      return responder(text);
    },
  };
}

function sqlTextOf(query: unknown): string {
  const q = query as { queryChunks?: unknown[]; sql?: string };
  if (typeof q.sql === 'string') return q.sql;
  try {
    return JSON.stringify(q.queryChunks ?? query);
  } catch {
    return String(query);
  }
}

describe('createSleepRunDbClient', () => {
  it('parses RETURNING id from insertRunningRun', async () => {
    const db = capturing((t) =>
      t.includes('INSERT INTO brain_sleep_runs') ? { rows: [{ id: 'uuid-9' }] } : { rows: [] },
    );
    const client = createSleepRunDbClient(db);
    await expect(client.insertRunningRun('p1')).resolves.toBe('uuid-9');
  });

  it('throws when insertRunningRun returns no id', async () => {
    const db = capturing(() => ({ rows: [] }));
    const client = createSleepRunDbClient(db);
    await expect(client.insertRunningRun('p1')).rejects.toThrow(/did not return an id/);
  });

  it('maps a running row from findRunningRun', async () => {
    const startedAt = '2026-06-03T10:00:00.000Z';
    const db = capturing(() => ({
      rows: [{ id: 'r1', started_at: startedAt, status: 'running' }],
    }));
    const client = createSleepRunDbClient(db);
    await expect(client.findRunningRun('p1')).resolves.toEqual({
      id: 'r1',
      startedAt,
      status: 'running',
    });
  });

  it('returns null from findRunningRun when no row', async () => {
    const db = capturing(() => ({ rows: [] }));
    const client = createSleepRunDbClient(db);
    await expect(client.findRunningRun('p1')).resolves.toBeNull();
  });

  it('returns latestStartedAt as an ISO string (Date or string)', async () => {
    const asDate = capturing(() => ({
      rows: [{ started_at: new Date('2026-06-03T11:00:00.000Z') }],
    }));
    await expect(
      createSleepRunDbClient(asDate).latestStartedAt('p1'),
    ).resolves.toBe('2026-06-03T11:00:00.000Z');

    const asStr = capturing(() => ({ rows: [{ started_at: '2026-06-03T12:00:00.000Z' }] }));
    await expect(
      createSleepRunDbClient(asStr).latestStartedAt('p1'),
    ).resolves.toBe('2026-06-03T12:00:00.000Z');
  });

  it('skips the emissions INSERT when the list is empty', async () => {
    const db = capturing(() => ({ rows: [] }));
    const client = createSleepRunDbClient(db);
    await client.insertEmissions('r1', []);
    expect(db.calls).toHaveLength(0);
  });

  it('issues exactly one statement for a multi-emission insert', async () => {
    const db = capturing(() => ({ rows: [] }));
    const client = createSleepRunDbClient(db);
    await client.insertEmissions('r1', [
      { kind: 'lesson', payload: { a: 1 } },
      { kind: 'nudge', payload: 'x' },
    ]);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toContain('brain_sleep_emissions');
  });

  it('issues an UPDATE for updateRun', async () => {
    const db = capturing(() => ({ rows: [] }));
    const client = createSleepRunDbClient(db);
    await client.updateRun('r1', {
      status: 'done',
      itemsProcessed: 1,
      itemsEmitted: 0,
      durationMs: 5,
      notes: 'ok',
    });
    expect(db.calls[0]).toContain('UPDATE brain_sleep_runs');
  });
});
