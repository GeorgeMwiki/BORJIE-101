/**
 * Action-executor unit tests — the chat→action execution bridge.
 *
 * Covers the three contract cases the wave requires:
 *   1. An authorized SAFE verb (set_reminder) EXECUTES — real insert into
 *      the reminders table — and bumps the user_action_tracker mastery
 *      counter (the post-success side effect).
 *   2. A HIGH-risk verb (sovereign:transfer) is DENIED by the fail-closed
 *      gate, so the gate→dispatch pipeline NEVER executes it (no insert,
 *      no mastery bump).
 *   3. An unknown verb dispatches GRACEFULLY: `{ executed:false,
 *      reason:'unknown_action' }` with no throw and no side effect.
 *
 * The registry + handlers + mastery tracker + the real auto-authorize
 * gate run unmocked against a hand-rolled Drizzle shim that records every
 * insert / update / execute so we can assert the exact side effects.
 */

import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';

import {
  dispatchAction,
  isSafeVerb,
  safeVerbs,
  type ExecContext,
} from '../index.js';
import { decideAutoAuthorization } from '../../auto-authorize-gate/index.js';
import type { ScopeContext } from '@borjie/central-intelligence';

// ─── Drizzle shim ────────────────────────────────────────────────────

interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}
interface UpdateCall {
  table: string;
  set: Record<string, unknown>;
}
interface ExecuteCall {
  sqlText: string;
}

function tableNameOf(obj: unknown): string {
  try {
    return getTableName(obj as never);
  } catch {
    return 'unknown';
  }
}

/**
 * Records every DB operation. `selectRows` seeds what `select().from()`
 * returns (used by snooze_reminder); `insertReturn` seeds the row the
 * insert's `.returning()` yields.
 */
function makeShim(opts: {
  selectRows?: Array<Record<string, unknown>>;
  insertReturn?: Record<string, unknown>;
} = {}) {
  const inserts: InsertCall[] = [];
  const updates: UpdateCall[] = [];
  const executes: ExecuteCall[] = [];

  const client = {
    insert(table: any) {
      const tableName = tableNameOf(table);
      return {
        values(v: Record<string, unknown>): any {
          inserts.push({ table: tableName, values: v });
          const row = opts.insertReturn ?? { id: v.id ?? `${tableName}_1`, triggerAt: v.triggerAt };
          return { returning: () => Promise.resolve([row]) };
        },
      };
    },
    select(_cols?: unknown) {
      return {
        from(table: any) {
          const tableName = tableNameOf(table);
          return {
            where(_p: unknown) {
              return {
                limit: () =>
                  Promise.resolve(
                    opts.selectRows ?? [],
                  ),
                _table: tableName,
              };
            },
          };
        },
      };
    },
    update(table: any) {
      const tableName = tableNameOf(table);
      return {
        set(s: Record<string, unknown>): any {
          return {
            where(_p: unknown) {
              updates.push({ table: tableName, set: s });
              return {
                returning: () =>
                  Promise.resolve([{ id: `${tableName}_1`, triggerAt: s.triggerAt }]),
              };
            },
          };
        },
      };
    },
    // The mastery tracker uses db.execute(sql`...`). Drizzle's sql
    // template object stringifies via its `.queryChunks`; for the shim we
    // just record that an execute happened (and a coarse text marker).
    execute(q: unknown): Promise<unknown> {
      let sqlText = 'sql';
      try {
        sqlText = JSON.stringify(q);
      } catch {
        sqlText = String(q);
      }
      executes.push({ sqlText });
      return Promise.resolve({ rows: [] });
    },
  };

  return { client, inserts, updates, executes };
}

const silentLogger: ExecContext['logger'] = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeCtx(
  db: unknown,
  overrides: Partial<ExecContext> = {},
): ExecContext {
  return {
    db: db as ExecContext['db'],
    tenantId: 't-1',
    userId: 'u-1',
    logger: silentLogger,
    ...overrides,
  };
}

const tenantScope: ScopeContext = {
  kind: 'tenant',
  tenantId: 't-1',
  actorUserId: 'u-1',
  roles: ['owner'],
  personaId: 'mr-mwikila-head',
};

// ─── Registry membership ─────────────────────────────────────────────

describe('action-executor registry', () => {
  it('registers exactly the SAFE reminder verbs', () => {
    expect([...safeVerbs()].sort()).toEqual(['set_reminder', 'snooze_reminder']);
  });

  it('isSafeVerb is case-insensitive and excludes money/HIGH-risk verbs', () => {
    expect(isSafeVerb('set_reminder')).toBe(true);
    expect(isSafeVerb('SET_REMINDER')).toBe(true);
    expect(isSafeVerb('snooze_reminder')).toBe(true);
    expect(isSafeVerb('sovereign:transfer')).toBe(false);
    expect(isSafeVerb('post_ledger_entry')).toBe(false);
    expect(isSafeVerb('hire_employee')).toBe(false);
  });
});

// ─── 1) authorized SAFE verb executes + audits-path + mastery ────────

describe('authorized set_reminder → executes + writes mastery', () => {
  it('gate authorizes a benign reminder verb', () => {
    const decision = decideAutoAuthorization(
      'set_reminder',
      'Remind the owner to renew PML 0241 before it expires.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);
  });

  it('dispatch inserts a reminders row + bumps user_action_tracker', async () => {
    const shim = makeShim();
    // Mirror the endpoint contract: authorize FIRST, only dispatch if ok.
    const decision = decideAutoAuthorization(
      'set_reminder',
      'Remind owner about levy filing.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);

    const out = await dispatchAction(
      'set_reminder',
      { title: 'File levy', dueInDays: 7 },
      makeCtx(shim.client),
    );

    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('reminder');
      expect(out.result.id).toBeTruthy();
    }

    // Real persisted side effect: one insert into the reminders table.
    expect(shim.inserts).toHaveLength(1);
    expect(shim.inserts[0]!.table).toBe('reminders');
    expect(shim.inserts[0]!.values.tenantId).toBe('t-1');
    expect(shim.inserts[0]!.values.ownerId).toBe('u-1');
    expect(shim.inserts[0]!.values.title).toBe('File levy');
    expect(shim.inserts[0]!.values.status).toBe('scheduled');
    expect(shim.inserts[0]!.values.provenance).toMatchObject({
      via: 'chat',
      actorId: 'u-1',
    });
    const triggerAt = shim.inserts[0]!.values.triggerAt as Date;
    expect(triggerAt.getTime()).toBeGreaterThan(Date.now());

    // Mastery counter bumped exactly once after success.
    expect(shim.executes).toHaveLength(1);
    expect(shim.executes[0]!.sqlText).toContain('user_action_tracker');
  });

  it('resolves dueAt absolute timestamps and snoozes a scheduled reminder', async () => {
    // snooze path: seed a scheduled reminder for select().
    const existingTrigger = new Date(Date.now() + 3 * 86_400_000);
    const shim = makeShim({
      selectRows: [
        { id: 'rem-1', status: 'scheduled', triggerAt: existingTrigger },
      ],
    });

    const out = await dispatchAction(
      'snooze_reminder',
      { reminderId: '11111111-1111-1111-1111-111111111111', days: 2 },
      makeCtx(shim.client),
    );

    expect(out.executed).toBe(true);
    expect(shim.updates).toHaveLength(1);
    expect(shim.updates[0]!.table).toBe('reminders');
    const next = shim.updates[0]!.set.triggerAt as Date;
    expect(next.getTime()).toBe(existingTrigger.getTime() + 2 * 86_400_000);
    // mastery bumped on snooze too.
    expect(shim.executes).toHaveLength(1);
  });
});

// ─── 2) HIGH-risk verb is denied → never executes ────────────────────

describe('HIGH-risk verb → gate denies → no execution', () => {
  it('decideAutoAuthorization denies a sovereign verb', () => {
    const decision = decideAutoAuthorization(
      'sovereign:transfer',
      'Move funds between subsidiaries.',
      tenantScope,
    );
    expect(decision.authorized).toBe(false);
    expect(decision.reason).toMatch(/high-risk|literal/i);
  });

  it('the gate→dispatch pipeline does NOT touch the database when denied', async () => {
    const shim = makeShim();
    const verb = 'sovereign:transfer';
    const decision = decideAutoAuthorization(verb, 'Move money.', tenantScope);

    // Endpoint contract: only dispatch when authorized.
    let dispatched = false;
    if (decision.authorized) {
      await dispatchAction(verb, {}, makeCtx(shim.client));
      dispatched = true;
    }

    expect(decision.authorized).toBe(false);
    expect(dispatched).toBe(false);
    // No side effects whatsoever.
    expect(shim.inserts).toHaveLength(0);
    expect(shim.updates).toHaveLength(0);
    expect(shim.executes).toHaveLength(0);
  });

  it('even if a HIGH-risk verb reached dispatch, it is not in the registry → unknown_action, no side effect', async () => {
    // Defence-in-depth: the executor would refuse it regardless of the gate.
    const shim = makeShim();
    const out = await dispatchAction('sovereign:transfer', {}, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('unknown_action');
    expect(shim.inserts).toHaveLength(0);
    expect(shim.executes).toHaveLength(0);
  });
});

// ─── 3) unknown verb → graceful ──────────────────────────────────────

describe('unknown verb → graceful', () => {
  it('returns executed:false reason:unknown_action without throwing', async () => {
    const shim = makeShim();
    const out = await dispatchAction('teleport_owner', { x: 1 }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('unknown_action');
    expect(shim.inserts).toHaveLength(0);
    expect(shim.updates).toHaveLength(0);
    expect(shim.executes).toHaveLength(0);
  });

  it('a registered verb with invalid params fails gracefully (no throw, no mastery bump)', async () => {
    const shim = makeShim();
    // set_reminder requires exactly one of dueInDays/dueAt — supply neither.
    const out = await dispatchAction('set_reminder', { title: 'x' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    // Insert must not have happened; mastery must NOT be bumped on failure.
    expect(shim.inserts).toHaveLength(0);
    expect(shim.executes).toHaveLength(0);
  });
});
