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

function makeShim(
  opts: {
    returnFor?: Record<string, string[]>;
    /** Rows the `.select()` path returns, keyed by table name. Used by the
     *  reminders.snooze dispatcher, which SELECTs the row (to check its
     *  snoozable status) before the UPDATE. Absent → empty (row not found). */
    selectFor?: Record<string, Array<Record<string, unknown>>>;
  } = {},
) {
  const inserts: InsertCall[] = [];
  const updates: UpdateCall[] = [];
  const returns: Record<string, string[]> = {
    mining_tasks: ['mt_1'],
    incidents: ['inc_1'],
    document_uploads: ['doc_1'],
    marketplace_bids: ['bid_1'],
    reminders: ['rem_1'],
    ...(opts.returnFor ?? {}),
  };
  const selectRows = opts.selectFor ?? {};

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
    select(_cols?: any) {
      return {
        from(table: any): any {
          const tableName = tableNameOf(table);
          const chain = {
            where(_p: any) {
              return chain;
            },
            limit(_n: number) {
              return Promise.resolve(selectRows[tableName] ?? []);
            },
          };
          return chain;
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
  // A scheduled reminder due in 5 min; snoozing must push trigger_at forward
  // on the `reminders` table (the ONLY place owner reminders live — never
  // event_outbox) so the reminders-dispatch worker re-picks it later.
  const scheduledRow = (triggerAt: Date) => ({
    reminders: [{ id: 'rem_1', status: 'scheduled', triggerAt }],
  });

  it('advances reminders.trigger_at by the requested HOURS (prompt contract)', async () => {
    // The persona prompt emits payload:{hours:24}; the delta must honour it
    // (the old code read only payload.minutes and silently defaulted to 60m).
    const base = new Date();
    const shim = makeShim({ selectFor: scheduledRow(base) });
    const out = await dispatchSnoozeReminder(
      baseCtx({ db: shim.client as never }),
      'rem_1',
      { hours: 24 },
    );
    expect(out.ok).toBe(true);
    expect(out.artifactKind).toBe('reminder');
    expect(shim.updates).toHaveLength(1);
    expect(shim.updates[0]!.table).toBe('reminders');
    const nextTrigger = shim.updates[0]!.set.triggerAt as Date;
    // trigger_at pushed forward ~24h from now (row's trigger is ~now).
    expect(nextTrigger.getTime()).toBeGreaterThanOrEqual(
      base.getTime() + 24 * 60 * 60_000 - 1000,
    );
    expect(nextTrigger.getTime()).toBeLessThanOrEqual(
      Date.now() + 24 * 60 * 60_000 + 1000,
    );
  });

  it('honours explicit payload.minutes over hours', async () => {
    const base = new Date();
    const shim = makeShim({ selectFor: scheduledRow(base) });
    const out = await dispatchSnoozeReminder(
      baseCtx({ db: shim.client as never }),
      'rem_1',
      { minutes: 45 },
    );
    expect(out.ok).toBe(true);
    const nextTrigger = shim.updates[0]!.set.triggerAt as Date;
    expect(nextTrigger.getTime()).toBeGreaterThanOrEqual(
      base.getTime() + 45 * 60_000 - 1000,
    );
    expect(nextTrigger.getTime()).toBeLessThanOrEqual(
      base.getTime() + 45 * 60_000 + 60 * 60_000,
    );
  });

  it('defaults to 60 minutes when neither minutes nor hours is given', async () => {
    const base = new Date();
    const shim = makeShim({ selectFor: scheduledRow(base) });
    const out = await dispatchSnoozeReminder(
      baseCtx({ db: shim.client as never }),
      'rem_1',
      {},
    );
    expect(out.ok).toBe(true);
    const nextTrigger = shim.updates[0]!.set.triggerAt as Date;
    expect(nextTrigger.getTime()).toBeGreaterThanOrEqual(
      base.getTime() + 60 * 60_000 - 1000,
    );
  });

  it('refuses an immutable (sent) reminder with an honest ok:false — no false success', async () => {
    const shim = makeShim({
      selectFor: { reminders: [{ id: 'rem_1', status: 'sent', triggerAt: new Date() }] },
    });
    const out = await dispatchSnoozeReminder(
      baseCtx({ db: shim.client as never }),
      'rem_1',
      { hours: 24 },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/cannot snooze a sent reminder/);
    // Critically: NO update was issued against the table.
    expect(shim.updates).toHaveLength(0);
  });

  it('returns ok:false not-found for a missing reminder', async () => {
    const shim = makeShim(); // selectFor absent → empty select
    const out = await dispatchSnoozeReminder(
      baseCtx({ db: shim.client as never }),
      'rem_missing',
      { hours: 24 },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not found/);
    expect(shim.updates).toHaveLength(0);
  });

  it('rejects negative minutes before touching the table', async () => {
    const shim = makeShim({ selectFor: scheduledRow(new Date()) });
    const out = await dispatchSnoozeReminder(
      baseCtx({ db: shim.client as never }),
      'rem_1',
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
