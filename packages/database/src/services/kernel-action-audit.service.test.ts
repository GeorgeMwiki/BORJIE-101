/**
 * Unit tests for createKernelActionAuditService.
 *
 * The service is a thin insert. We mock the DatabaseClient and assert
 * that the values handed to insert().values(...) match the entry, and
 * that DB errors are logged + swallowed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKernelActionAuditService } from './kernel-action-audit.service.js';
import type { DatabaseClient } from '../client.js';

interface InsertedRow {
  id: string;
  tenantId: string;
  goalId: string;
  stepId: string;
  toolName: string | null;
  decision: string;
  payloadHash: string;
  outcome: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  latencyMs: number | null;
}

function makeStubDb(opts: { fail?: boolean } = {}): {
  client: DatabaseClient;
  readonly rows: InsertedRow[];
} {
  const rows: InsertedRow[] = [];
  const db: Record<string, unknown> = {
    insert: () => ({
      values: (v: Partial<InsertedRow>) => {
        if (opts.fail) {
          return {
            then: (_resolve: (rows: unknown) => unknown, reject: (e: unknown) => void) => {
              reject(new Error('boom'));
            },
          };
        }
        rows.push({
          id: String(v.id ?? ''),
          tenantId: String(v.tenantId ?? ''),
          goalId: String(v.goalId ?? ''),
          stepId: String(v.stepId ?? ''),
          toolName: (v.toolName ?? null) as string | null,
          decision: String(v.decision ?? ''),
          payloadHash: String(v.payloadHash ?? ''),
          outcome: (v.outcome ?? null) as string | null,
          errorMessage: (v.errorMessage ?? null) as string | null,
          startedAt: (v.startedAt ?? null) as Date | null,
          endedAt: (v.endedAt ?? null) as Date | null,
          latencyMs: v.latencyMs ?? null,
        });
        return { then: (resolve: (rows: unknown) => unknown) => resolve(undefined) };
      },
    }),
  };
  const out = { client: db as unknown as DatabaseClient } as {
    client: DatabaseClient;
    readonly rows: InsertedRow[];
  };
  Object.defineProperty(out, 'rows', { get: () => rows });
  return out;
}

describe('createKernelActionAuditService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('record() inserts the entry shaped as expected', async () => {
    const stub = makeStubDb();
    const svc = createKernelActionAuditService(stub.client);
    await svc.record({
      tenantId: 't',
      userId: 'u',
      goalId: 'g',
      stepId: 's',
      toolName: 'rent.send-reminder',
      decision: 'done',
      payloadHash: 'abcd',
      outcome: 'ok',
      errorMessage: null,
      startedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
      endedAt: new Date('2026-01-01T00:00:01Z').toISOString(),
      latencyMs: 1000,
    });
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.toolName).toBe('rent.send-reminder');
    expect(stub.rows[0]?.decision).toBe('done');
    expect(stub.rows[0]?.payloadHash).toBe('abcd');
    expect(stub.rows[0]?.startedAt instanceof Date).toBe(true);
  });

  it('record() short-circuits when tenantId / goalId / stepId is missing', async () => {
    const stub = makeStubDb();
    const svc = createKernelActionAuditService(stub.client);
    await svc.record({
      tenantId: '',
      userId: 'u',
      goalId: 'g',
      stepId: 's',
      toolName: null,
      decision: 'running',
      payloadHash: 'x',
      outcome: null,
      errorMessage: null,
      startedAt: null,
      endedAt: null,
      latencyMs: null,
    });
    expect(stub.rows).toHaveLength(0);
  });

  it('record() swallows DB errors so the executor never breaks', async () => {
    const stub = makeStubDb({ fail: true });
    const svc = createKernelActionAuditService(stub.client);
    await expect(
      svc.record({
        tenantId: 't',
        userId: 'u',
        goalId: 'g',
        stepId: 's',
        toolName: 'x',
        decision: 'done',
        payloadHash: 'h',
        outcome: null,
        errorMessage: null,
        startedAt: null,
        endedAt: null,
        latencyMs: null,
      }),
    ).resolves.toBeUndefined();
  });
});
