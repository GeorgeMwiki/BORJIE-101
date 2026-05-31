/**
 * Per-entity bulk-action dispatcher tests for Borjie — closes H2
 * deferral: "bulk-action records the undo-journal entry but doesn't
 * fire the per-entity verbs against the underlying tables".
 *
 * Each test asserts the dispatcher writes the correct REAL artifact
 * (mining_tasks update / incidents update / etc.). Hand-rolled Drizzle
 * shim captures SQL operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getTableName } from 'drizzle-orm';

import {
  dispatch,
  dispatchSnoozeReminder,
  dispatchCompleteTask,
  dispatchAcknowledgeIncident,
  dispatchArchiveDocument,
  dispatchWithdrawBid,
  type DispatchContext,
} from '../superpowers-dispatchers';

interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}
interface UpdateCall {
  table: string;
  set: Record<string, unknown>;
}

function tableNameOf(obj: unknown): string {
  try {
    return getTableName(obj as never);
  } catch {
    return 'unknown';
  }
}

function makeShim(opts: { returnFor?: Record<string, string[]> } = {}) {
  const inserts: InsertCall[] = [];
  const updates: UpdateCall[] = [];
  const returns: Record<string, string[]> = {
    mining_tasks: ['mt_1'],
    incidents: ['inc_1'],
    document_uploads: ['doc_1'],
    marketplace_bids: ['bid_1'],
    event_outbox: ['out_1'],
    ...(opts.returnFor ?? {}),
  };

  const client = {
    insert(table: any) {
      const tableName = tableNameOf(table);
      return {
        values(v: Record<string, unknown>): any {
          inserts.push({ table: tableName, values: v });
          return { returning: () => Promise.resolve([{ id: v.id ?? `${tableName}_1` }]) };
        },
      };
    },
    update(table: any) {
      const tableName = tableNameOf(table);
      return {
        set(s: Record<string, unknown>): any {
          return {
            where(_p: any) {
              updates.push({ table: tableName, set: s });
              return {
                returning: () =>
                  Promise.resolve(
                    (returns[tableName] ?? ['unknown_1']).map((id) => ({ id })),
                  ),
              };
            },
          };
        },
      };
    },
  };
  return { client, inserts, updates };
}

const baseCtx = (overrides: Partial<DispatchContext> = {}): DispatchContext => ({
  db: undefined as never,
  tenantId: 't1',
  actorId: 'u1',
  idempotencyKey: 'idem-1',
  reason: 'test',
  ...overrides,
});

describe('dispatchSnoozeReminder', () => {
  it('updates event_outbox.nextRetryAt forward', async () => {
    const shim = makeShim();
    const before = Date.now();
    const out = await dispatchSnoozeReminder(
      baseCtx({ db: shim.client as never }),
      'out_1',
      { minutes: 45 },
    );
    expect(out.ok).toBe(true);
    expect(shim.updates).toHaveLength(1);
    expect(shim.updates[0]!.table).toBe('event_outbox');
    const nextRetry = shim.updates[0]!.set.nextRetryAt as Date;
    expect(nextRetry.getTime()).toBeGreaterThanOrEqual(before + 45 * 60_000 - 1000);
  });

  it('rejects negative minutes', async () => {
    const shim = makeShim();
    const out = await dispatchSnoozeReminder(
      baseCtx({ db: shim.client as never }),
      'out_1',
      { minutes: -1 },
    );
    expect(out.ok).toBe(false);
    expect(shim.updates).toHaveLength(0);
  });
});

describe('dispatchCompleteTask', () => {
  it('updates mining_tasks status=done + completedAt', async () => {
    const shim = makeShim();
    const out = await dispatchCompleteTask(
      baseCtx({ db: shim.client as never }),
      'mt_1',
      {},
    );
    expect(out.ok).toBe(true);
    expect(shim.updates).toHaveLength(1);
    expect(shim.updates[0]!.table).toBe('mining_tasks');
    expect(shim.updates[0]!.set.status).toBe('done');
    expect(shim.updates[0]!.set.completedAt).toBeInstanceOf(Date);
  });
});

describe('dispatchAcknowledgeIncident', () => {
  it('updates incidents.status to under_investigation', async () => {
    const shim = makeShim();
    const out = await dispatchAcknowledgeIncident(
      baseCtx({ db: shim.client as never }),
      'inc_1',
      {},
    );
    expect(out.ok).toBe(true);
    expect(shim.updates).toHaveLength(1);
    expect(shim.updates[0]!.table).toBe('incidents');
    expect(shim.updates[0]!.set.status).toBe('under_investigation');
  });
});

describe('dispatchArchiveDocument', () => {
  it('soft-deletes via deletedAt', async () => {
    const shim = makeShim();
    const out = await dispatchArchiveDocument(
      baseCtx({ db: shim.client as never }),
      'doc_1',
      {},
    );
    expect(out.ok).toBe(true);
    expect(shim.updates).toHaveLength(1);
    expect(shim.updates[0]!.table).toBe('document_uploads');
    expect(shim.updates[0]!.set.deletedAt).toBeInstanceOf(Date);
  });
});

describe('dispatchWithdrawBid', () => {
  it('updates marketplace_bids status=withdrawn + attributes', async () => {
    const shim = makeShim();
    const out = await dispatchWithdrawBid(
      baseCtx({ db: shim.client as never }),
      'bid_1',
      {},
    );
    expect(out.ok).toBe(true);
    expect(shim.updates).toHaveLength(1);
    expect(shim.updates[0]!.table).toBe('marketplace_bids');
    expect(shim.updates[0]!.set.status).toBe('withdrawn');
    const attrs = shim.updates[0]!.set.attributes as Record<string, unknown>;
    expect(attrs.withdrawReason).toBe('test');
    expect(attrs.withdrawnByUserId).toBe('u1');
  });
});

describe('top-level dispatch', () => {
  it('returns ok=false for an unknown (entity, action) tuple', async () => {
    const shim = makeShim();
    const out = await dispatch(
      baseCtx({ db: shim.client as never }),
      'tasks' as never,
      'archive' as never,
      't1',
      {},
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no dispatcher/);
  });

  it('routes incidents.acknowledge → dispatchAcknowledgeIncident', async () => {
    const shim = makeShim();
    const out = await dispatch(
      baseCtx({ db: shim.client as never }),
      'incidents',
      'acknowledge',
      'inc_1',
      {},
    );
    expect(out.ok).toBe(true);
    expect(out.artifactKind).toBe('incident');
  });
});
