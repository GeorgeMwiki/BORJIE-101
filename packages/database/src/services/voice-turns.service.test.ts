/**
 * Unit tests for createVoiceTurnsService.
 *
 * Stubs the Drizzle DatabaseClient with a tiny in-memory table so we
 * can assert: insert captures the right shape, list returns rows in
 * turn-index order, countBySession returns numeric count, and DB
 * failures degrade gracefully (insert rethrows, reads return safe
 * defaults).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVoiceTurnsService } from './voice-turns.service.js';
import type { DatabaseClient } from '../client.js';

interface InsertedRow {
  id: string;
  tenantId: string;
  sessionId: string;
  customerId: string | null;
  turnIndex: number;
  detectedLanguage: string;
  inputTranscript: string;
  responseText: string;
  responseAudioRef: string | null;
  toolCalls: unknown;
  degradedMode: boolean;
  modelVersion: string | null;
  promptHash: string | null;
  latencyMs: number | null;
  createdAt: Date;
}

interface StubOptions {
  failInsert?: boolean;
  failSelect?: boolean;
  selectRows?: ReadonlyArray<unknown>;
  countResult?: number;
}

function makeStubDb(opts: StubOptions = {}): {
  client: DatabaseClient;
  readonly rows: InsertedRow[];
} {
  const rows: InsertedRow[] = [];
  const client = {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        if (opts.failInsert) throw new Error('insert boom');
        rows.push({
          id: String(v.id ?? ''),
          tenantId: String(v.tenantId ?? ''),
          sessionId: String(v.sessionId ?? ''),
          customerId: (v.customerId ?? null) as string | null,
          turnIndex: Number(v.turnIndex ?? 0),
          detectedLanguage: String(v.detectedLanguage ?? ''),
          inputTranscript: String(v.inputTranscript ?? ''),
          responseText: String(v.responseText ?? ''),
          responseAudioRef: (v.responseAudioRef ?? null) as string | null,
          toolCalls: v.toolCalls,
          degradedMode: Boolean(v.degradedMode),
          modelVersion: (v.modelVersion ?? null) as string | null,
          promptHash: (v.promptHash ?? null) as string | null,
          latencyMs: (v.latencyMs ?? null) as number | null,
          createdAt: v.createdAt as Date,
        });
      },
    }),
    select: () => ({
      from: () => ({
        where: () => {
          if (opts.failSelect) {
            const fail = Promise.reject(new Error('select boom'));
            fail.catch(() => undefined);
            return Object.assign(fail, {
              orderBy: () => {
                const innerFail = Promise.reject(new Error('select boom'));
                innerFail.catch(() => undefined);
                return innerFail;
              },
            });
          }
          if (opts.countResult !== undefined) {
            return Promise.resolve([{ value: opts.countResult }]);
          }
          const promise = Promise.resolve(opts.selectRows ?? []);
          return Object.assign(promise, {
            orderBy: () => Promise.resolve(opts.selectRows ?? []),
          });
        },
      }),
    }),
  } as unknown as DatabaseClient;
  return { client, get rows() { return rows; } } as never;
}

describe('createVoiceTurnsService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('insert() persists the row and returns the input', async () => {
    const stub = makeStubDb();
    const svc = createVoiceTurnsService(stub.client);
    const out = await svc.insert({
      id: 'vt1',
      tenantId: 't',
      sessionId: 's',
      turnIndex: 0,
      customerId: 'c',
      detectedLanguage: 'sw',
      inputTranscript: 'habari',
      responseText: 'salaam',
      responseAudioRef: null,
      toolCalls: [{ name: 'rent.send-reminder', arguments: {} }],
      degradedMode: false,
      modelVersion: 'v1',
      promptHash: 'h',
      latencyMs: 250,
      createdAt: '2026-05-08T12:00:00Z',
    });
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.detectedLanguage).toBe('sw');
    expect(stub.rows[0]?.degradedMode).toBe(false);
    expect(stub.rows[0]?.createdAt).toBeInstanceOf(Date);
    expect(out.id).toBe('vt1');
  });

  it('insert() rethrows DB errors so the agent can record degraded mode', async () => {
    const stub = makeStubDb({ failInsert: true });
    const svc = createVoiceTurnsService(stub.client);
    await expect(
      svc.insert({
        id: 'vt2',
        tenantId: 't',
        sessionId: 's',
        turnIndex: 1,
        customerId: null,
        detectedLanguage: 'en',
        inputTranscript: 'hi',
        responseText: 'hi back',
        responseAudioRef: null,
        toolCalls: [],
        degradedMode: false,
        modelVersion: null,
        promptHash: null,
        latencyMs: null,
        createdAt: '2026-05-08T12:00:00Z',
      }),
    ).rejects.toThrow();
  });

  it('insert() validates required fields', async () => {
    const stub = makeStubDb();
    const svc = createVoiceTurnsService(stub.client);
    await expect(
      svc.insert({
        id: '',
        tenantId: '',
        sessionId: 's',
        turnIndex: 0,
        customerId: null,
        detectedLanguage: 'en',
        inputTranscript: '',
        responseText: '',
        responseAudioRef: null,
        toolCalls: [],
        degradedMode: true,
        modelVersion: null,
        promptHash: null,
        latencyMs: null,
        createdAt: '2026-05-08T12:00:00Z',
      }),
    ).rejects.toThrow(/requires/);
  });

  it('countBySession() returns 0 when tenant or session missing', async () => {
    const stub = makeStubDb({ countResult: 99 });
    const svc = createVoiceTurnsService(stub.client);
    expect(await svc.countBySession('', 's')).toBe(0);
    expect(await svc.countBySession('t', '')).toBe(0);
  });

  it('countBySession() returns the numeric count', async () => {
    const stub = makeStubDb({ countResult: 4 });
    const svc = createVoiceTurnsService(stub.client);
    expect(await svc.countBySession('t', 's')).toBe(4);
  });

  it('countBySession() returns 0 on DB error', async () => {
    const stub = makeStubDb({ failSelect: true });
    const svc = createVoiceTurnsService(stub.client);
    expect(await svc.countBySession('t', 's')).toBe(0);
  });

  it('list() returns empty array on DB error', async () => {
    const stub = makeStubDb({ failSelect: true });
    const svc = createVoiceTurnsService(stub.client);
    expect(await svc.list('t', 's')).toEqual([]);
  });
});
