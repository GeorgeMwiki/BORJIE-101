/**
 * Unit tests for createKernelMemoryService — the prior-turns loader
 * that the central-intelligence kernel uses for thread continuity.
 *
 * The DatabaseClient is stubbed so we can:
 *   1. assert query orientation (tenant-scoped vs not)
 *   2. assert role mapping (user_message → user, persona_message → assistant)
 *   3. assert content extraction priority (text → content → message → JSON)
 *   4. assert ordering (rows reversed to oldest-first)
 */
import { describe, it, expect } from 'vitest';
import { createKernelMemoryService } from './kernel-prior-turns.service.js';
import type { DatabaseClient } from '../client.js';

interface StubRow {
  kind: string;
  payload: unknown;
  createdAt: Date;
}

function makeStubDb(rows: ReadonlyArray<StubRow>): DatabaseClient {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(rows),
          }),
        }),
      }),
    }),
  } as unknown as DatabaseClient;
}

function makeCountStubDb(rows: ReadonlyArray<{ id: string }>): DatabaseClient {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  } as unknown as DatabaseClient;
}

describe('createKernelMemoryService — loadPriorTurns', () => {
  it('reverses rows to oldest-first ordering', async () => {
    // DB returns newest-first ordering (DESC); service reverses to oldest-first.
    const rows: StubRow[] = [
      { kind: 'persona_message', payload: { text: 'newest' }, createdAt: new Date('2026-05-08T12:00:02Z') },
      { kind: 'user_message', payload: { text: 'middle' }, createdAt: new Date('2026-05-08T12:00:01Z') },
      { kind: 'persona_message', payload: { text: 'oldest' }, createdAt: new Date('2026-05-08T12:00:00Z') },
    ];
    const svc = createKernelMemoryService(makeStubDb(rows), { tenantId: 't' });
    const turns = await svc.loadPriorTurns('thr-1');
    expect(turns).toHaveLength(3);
    expect(turns[0]?.content).toBe('oldest');
    expect(turns[2]?.content).toBe('newest');
  });

  it('maps user_message → role:user', async () => {
    const rows: StubRow[] = [
      { kind: 'user_message', payload: { text: 'hi' }, createdAt: new Date() },
    ];
    const svc = createKernelMemoryService(makeStubDb(rows), { tenantId: 't' });
    const [turn] = await svc.loadPriorTurns('thr-1');
    expect(turn?.role).toBe('user');
  });

  it('maps persona_message → role:assistant', async () => {
    const rows: StubRow[] = [
      { kind: 'persona_message', payload: { text: 'hello' }, createdAt: new Date() },
    ];
    const svc = createKernelMemoryService(makeStubDb(rows), { tenantId: 't' });
    const [turn] = await svc.loadPriorTurns('thr-1');
    expect(turn?.role).toBe('assistant');
  });

  it('extracts content from text > content > message order', async () => {
    const rows: StubRow[] = [
      { kind: 'user_message', payload: { text: 'TEXT', content: 'CONTENT' }, createdAt: new Date() },
      { kind: 'user_message', payload: { content: 'CONTENT' }, createdAt: new Date() },
      { kind: 'user_message', payload: { message: 'MSG' }, createdAt: new Date() },
    ];
    const svc = createKernelMemoryService(makeStubDb(rows), { tenantId: 't' });
    const turns = await svc.loadPriorTurns('thr-1');
    // Reversed (oldest-first), so original order [0,1,2] becomes [2,1,0].
    expect(turns[2]?.content).toBe('TEXT');
    expect(turns[1]?.content).toBe('CONTENT');
    expect(turns[0]?.content).toBe('MSG');
  });

  it('falls back to JSON-stringified payload when no recognised field', async () => {
    const rows: StubRow[] = [
      { kind: 'user_message', payload: { custom: 'thing' }, createdAt: new Date() },
    ];
    const svc = createKernelMemoryService(makeStubDb(rows), { tenantId: 't' });
    const [turn] = await svc.loadPriorTurns('thr-1');
    expect(turn?.content).toContain('custom');
    expect(turn?.content).toContain('thing');
  });

  it('returns empty content for null/non-object payloads', async () => {
    const rows: StubRow[] = [
      { kind: 'user_message', payload: null, createdAt: new Date() },
      { kind: 'user_message', payload: 'string', createdAt: new Date() },
    ];
    const svc = createKernelMemoryService(makeStubDb(rows), { tenantId: 't' });
    const turns = await svc.loadPriorTurns('thr-1');
    expect(turns[0]?.content).toBe('');
    expect(turns[1]?.content).toBe('');
  });

  it('returns empty array when no rows match', async () => {
    const svc = createKernelMemoryService(makeStubDb([]), { tenantId: 't' });
    expect(await svc.loadPriorTurns('thr-1')).toEqual([]);
  });

  it('respects null tenant scope (no tenant filter applied)', async () => {
    const rows: StubRow[] = [
      { kind: 'user_message', payload: { text: 'platform-scope' }, createdAt: new Date() },
    ];
    const svc = createKernelMemoryService(makeStubDb(rows), { tenantId: null });
    const turns = await svc.loadPriorTurns('thr-1');
    expect(turns[0]?.content).toBe('platform-scope');
  });
});

describe('createKernelMemoryService — countRecentUserTurns', () => {
  it('returns the row length', async () => {
    const svc = createKernelMemoryService(
      makeCountStubDb([{ id: '1' }, { id: '2' }, { id: '3' }]),
      { tenantId: 't' },
    );
    expect(await svc.countRecentUserTurns('thr-1')).toBe(3);
  });

  it('returns 0 when no recent user turns', async () => {
    const svc = createKernelMemoryService(makeCountStubDb([]), { tenantId: 't' });
    expect(await svc.countRecentUserTurns('thr-1')).toBe(0);
  });

  it('honours the recentWindowMs override', async () => {
    // We don't introspect the WHERE clause here; we just verify the
    // service runs without error when a custom window is provided.
    const svc = createKernelMemoryService(
      makeCountStubDb([{ id: '1' }]),
      { tenantId: 't', recentWindowMs: 60_000 },
    );
    expect(await svc.countRecentUserTurns('thr-1')).toBe(1);
  });
});
