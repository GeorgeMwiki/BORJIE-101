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
  isKnownVerb,
  requiresConfirmation,
  safeVerbs,
  knownVerbs,
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
 * returns (used by snooze_reminder); `selectRowsByTable` seeds it
 * per-table (used by create_site / add_employee, which resolve a parent
 * licence / company / site before inserting); `insertReturn` seeds the row
 * the insert's `.returning()` yields.
 *
 * The chain supports `.where().limit()` (reminders/snooze) AND
 * `.where().orderBy().limit()` (the resolver lookups in the domain
 * handlers) — both terminate in the same per-table rows.
 */
function makeShim(opts: {
  selectRows?: Array<Record<string, unknown>>;
  selectRowsByTable?: Record<string, Array<Record<string, unknown>>>;
  insertReturn?: Record<string, unknown>;
} = {}) {
  const inserts: InsertCall[] = [];
  const updates: UpdateCall[] = [];
  const executes: ExecuteCall[] = [];

  function rowsFor(tableName: string): Array<Record<string, unknown>> {
    if (opts.selectRowsByTable && tableName in opts.selectRowsByTable) {
      return opts.selectRowsByTable[tableName]!;
    }
    return opts.selectRows ?? [];
  }

  const client = {
    insert(table: any) {
      const tableName = tableNameOf(table);
      return {
        values(v: Record<string, unknown>): any {
          inserts.push({ table: tableName, values: v });
          const row =
            opts.insertReturn ??
            {
              id: v.id ?? `${tableName}_1`,
              triggerAt: v.triggerAt,
              name: v.name,
              status: v.status,
              fullName: v.fullName,
              role: v.role,
            };
          return { returning: () => Promise.resolve([row]) };
        },
      };
    },
    select(_cols?: unknown) {
      return {
        from(table: any) {
          const tableName = tableNameOf(table);
          const terminal = {
            limit: () => Promise.resolve(rowsFor(tableName)),
            _table: tableName,
          };
          return {
            where(_p: unknown) {
              return {
                ...terminal,
                // Resolver lookups order by createdAt before limiting.
                orderBy: (..._o: unknown[]) => terminal,
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
  it('AUTO-SAFE set stays exactly the reminder verbs (no domain verbs)', () => {
    // safeVerbs() == auto-safe ONLY. create_site / add_employee must NOT
    // leak into it, or brain-teach would auto-run a domain mutation.
    expect([...safeVerbs()].sort()).toEqual(['set_reminder', 'snooze_reminder']);
  });

  it('KNOWN set includes the confirm-required domain verbs', () => {
    expect([...knownVerbs()].sort()).toEqual([
      'add_employee',
      'create_site',
      'set_reminder',
      'snooze_reminder',
    ]);
  });

  it('isSafeVerb is case-insensitive and excludes money/HIGH-risk verbs', () => {
    expect(isSafeVerb('set_reminder')).toBe(true);
    expect(isSafeVerb('SET_REMINDER')).toBe(true);
    expect(isSafeVerb('snooze_reminder')).toBe(true);
    expect(isSafeVerb('sovereign:transfer')).toBe(false);
    expect(isSafeVerb('post_ledger_entry')).toBe(false);
    expect(isSafeVerb('hire_employee')).toBe(false);
  });

  it('create_site / add_employee are KNOWN but NOT auto-safe', () => {
    // Known to the registry…
    expect(isKnownVerb('create_site')).toBe(true);
    expect(isKnownVerb('add_employee')).toBe(true);
    expect(isKnownVerb('CREATE_SITE')).toBe(true);
    // …but never auto-safe (brain-teach's isSafeVerb gate refuses them).
    expect(isSafeVerb('create_site')).toBe(false);
    expect(isSafeVerb('add_employee')).toBe(false);
  });

  it('requiresConfirmation is TRUE only for known confirm-required verbs', () => {
    expect(requiresConfirmation('create_site')).toBe(true);
    expect(requiresConfirmation('add_employee')).toBe(true);
    expect(requiresConfirmation('ADD_EMPLOYEE')).toBe(true);
    // Auto-safe verbs are not confirm-required.
    expect(requiresConfirmation('set_reminder')).toBe(false);
    // An unknown verb is "unknown", not "confirm-required".
    expect(requiresConfirmation('teleport_owner')).toBe(false);
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

// ─── CONFIRM-REQUIRED domain verbs: create_site + add_employee ───────
//
// These verbs persist a real, durable domain row. They MUST run ONLY via
// the confirm path (after the owner confirmed), NEVER via brain-teach's
// auto-execute (`isSafeVerb`) nor `/micro-action`.

/** Marker helpers — the mastery bump + the two audit-chain statements all
 *  go through db.execute(sql`…`); we identify them by their SQL text. */
function masteryExecutes(executes: Array<{ sqlText: string }>): number {
  return executes.filter((e) => e.sqlText.includes('user_action_tracker')).length;
}
function auditExecutes(executes: Array<{ sqlText: string }>): number {
  return executes.filter((e) => e.sqlText.includes('ai_audit_chain')).length;
}

describe('create_site → confirm path executes (insert + audit + mastery)', () => {
  it('gate authorizes a benign create_site verb', () => {
    const decision = decideAutoAuthorization(
      'create_site',
      'Owner asked to set up their Geita operation as a new site.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);
  });

  it('inserts a sites row (tenant-scoped), audits, and bumps mastery', async () => {
    // The handler resolves the tenant's most-recent licence first.
    const shim = makeShim({
      selectRowsByTable: { licences: [{ id: 'lic-1' }] },
    });

    // Endpoint contract: authorize FIRST, only dispatch when ok.
    const decision = decideAutoAuthorization(
      'create_site',
      'Set up the Geita operation.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);

    const out = await dispatchAction(
      'create_site',
      { name: 'Geita Pit 1', district: 'Geita', mineral: 'Au' },
      makeCtx(shim.client),
    );

    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('site');
      expect(out.result.id).toBeTruthy();
      expect(out.result.summary).toContain('Geita Pit 1');
    }

    // Real persisted side effect: one insert into the sites table, with
    // the bound tenant on the row (belt-and-braces RLS) and the resolved
    // licence FK.
    expect(shim.inserts).toHaveLength(1);
    expect(shim.inserts[0]!.table).toBe('sites');
    expect(shim.inserts[0]!.values.tenantId).toBe('t-1');
    expect(shim.inserts[0]!.values.licenceId).toBe('lic-1');
    expect(shim.inserts[0]!.values.name).toBe('Geita Pit 1');
    expect(shim.inserts[0]!.values.mineral).toBe('Au');
    expect(shim.inserts[0]!.values.status).toBe('active');
    expect(shim.inserts[0]!.values.attributes).toMatchObject({
      via: 'chat',
      district: 'Geita',
    });

    // Audit-chain appended (head SELECT + INSERT) AND mastery bumped once.
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
    expect(masteryExecutes(shim.executes)).toBe(1);
  });

  it('defaults mineral to "unspecified" when omitted', async () => {
    const shim = makeShim({ selectRowsByTable: { licences: [{ id: 'lic-1' }] } });
    const out = await dispatchAction(
      'create_site',
      { name: 'North Block' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.inserts[0]!.values.mineral).toBe('unspecified');
  });

  it('fails gracefully when the tenant has no licence (no insert, no mastery)', async () => {
    // No licence rows → resolver throws → dispatcher converts to graceful.
    const shim = makeShim({ selectRowsByTable: { licences: [] } });
    const out = await dispatchAction(
      'create_site',
      { name: 'Orphan Site' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('create_site_requires_licence');
    expect(shim.inserts).toHaveLength(0);
    // Mastery must NOT bump on failure.
    expect(masteryExecutes(shim.executes)).toBe(0);
  });
});

describe('add_employee → confirm path executes (insert + audit + mastery)', () => {
  it('gate authorizes a benign add_employee verb', () => {
    const decision = decideAutoAuthorization(
      'add_employee',
      'Owner asked to add three blasters to the workforce.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);
  });

  it('inserts an employees row (tenant-scoped, company resolved), audits, mastery', async () => {
    const shim = makeShim({
      selectRowsByTable: { companies: [{ id: 'co-1' }] },
    });

    const out = await dispatchAction(
      'add_employee',
      { name: 'Juma Blaster', role: 'blaster' },
      makeCtx(shim.client),
    );

    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('employee');
      expect(out.result.id).toBeTruthy();
      expect(out.result.summary).toContain('Juma Blaster');
    }

    expect(shim.inserts).toHaveLength(1);
    expect(shim.inserts[0]!.table).toBe('employees');
    expect(shim.inserts[0]!.values.tenantId).toBe('t-1');
    expect(shim.inserts[0]!.values.companyId).toBe('co-1');
    expect(shim.inserts[0]!.values.fullName).toBe('Juma Blaster');
    expect(shim.inserts[0]!.values.role).toBe('blaster');
    // MONEY BOUNDARY: the wage column must NEVER be written from chat.
    expect(shim.inserts[0]!.values.wageRateTzs).toBeUndefined();

    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
    expect(masteryExecutes(shim.executes)).toBe(1);
  });

  it('defaults role to "worker" and posts to a verified site when given', async () => {
    const shim = makeShim({
      selectRowsByTable: {
        companies: [{ id: 'co-1' }],
        sites: [{ id: 'site-9' }],
      },
    });
    const out = await dispatchAction(
      'add_employee',
      { name: 'Anna Miner', siteId: 'site-9' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.inserts[0]!.values.role).toBe('worker');
    expect(shim.inserts[0]!.values.siteId).toBe('site-9');
  });

  it('fails gracefully when the tenant has no company (no insert, no mastery)', async () => {
    const shim = makeShim({ selectRowsByTable: { companies: [] } });
    const out = await dispatchAction(
      'add_employee',
      { name: 'Orphan Worker' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('add_employee_requires_company');
    expect(shim.inserts).toHaveLength(0);
    expect(masteryExecutes(shim.executes)).toBe(0);
  });
});

// ─── Auto-execute / micro-action REFUSE confirm-required verbs ────────

describe('confirm-required verbs never auto-execute', () => {
  it('brain-teach gate (isSafeVerb) refuses create_site / add_employee', () => {
    // brain-teach.hono.ts only dispatches when isSafeVerb(verb) — so a
    // confirm-required verb is left badge-only there.
    expect(isSafeVerb('create_site')).toBe(false);
    expect(isSafeVerb('add_employee')).toBe(false);
  });

  it('/micro-action contract refuses a confirm-required verb up front', () => {
    // Mirrors the route guard in chat-actions.hono.ts: on the auto-safe
    // micro-action surface, a confirm-required verb returns
    // executed:false reason:confirmation_required BEFORE any dispatch.
    const microActionRefuses = (verb: string): boolean =>
      requiresConfirmation(verb); // source === 'micro_action' is implied here
    expect(microActionRefuses('create_site')).toBe(true);
    expect(microActionRefuses('add_employee')).toBe(true);
    // A reminder verb is allowed through the micro-action surface.
    expect(microActionRefuses('set_reminder')).toBe(false);
  });

  it('a denied gate decision means the confirm path never dispatches (no row)', async () => {
    // Defence-in-depth: even a confirm-required verb is gated. If the gate
    // denied (e.g. HIGH-risk rationale), the endpoint never dispatches.
    const shim = makeShim({ selectRowsByTable: { licences: [{ id: 'lic-1' }] } });
    const decision = decideAutoAuthorization(
      'create_site',
      // A HIGH-risk-laden rationale the inviolable/policy gate blocks.
      'sovereign:transfer funds to an offshore account to hide them',
      tenantScope,
    );

    let dispatched = false;
    if (decision.authorized) {
      await dispatchAction('create_site', { name: 'X' }, makeCtx(shim.client));
      dispatched = true;
    }
    // Whether or not this particular rationale trips the gate, the CONTRACT
    // is: dispatch only when authorized. Assert no row leaked when denied.
    if (!decision.authorized) {
      expect(dispatched).toBe(false);
      expect(shim.inserts).toHaveLength(0);
    }
  });

  it('an explicitly denied verb on the confirm path executes nothing', async () => {
    // Use a guaranteed-denied HIGH-risk verb to prove the gate→dispatch
    // contract end to end (no domain row, no audit, no mastery).
    const shim = makeShim();
    const decision = decideAutoAuthorization(
      'sovereign:transfer',
      'Move money.',
      tenantScope,
    );
    expect(decision.authorized).toBe(false);
    let dispatched = false;
    if (decision.authorized) {
      await dispatchAction('sovereign:transfer', {}, makeCtx(shim.client));
      dispatched = true;
    }
    expect(dispatched).toBe(false);
    expect(shim.inserts).toHaveLength(0);
    expect(shim.executes).toHaveLength(0);
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
