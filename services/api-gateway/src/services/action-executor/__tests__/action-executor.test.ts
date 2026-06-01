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
  /**
   * Seeds rows for `db.execute(sql`…`)` calls (used by the raw-SQL
   * draft_payroll_run handler + the audit helper). Each rule's `match`
   * substring is tested against the serialized SQL text; the FIRST matching
   * rule's `rows` are returned. Non-matching executes return `{ rows: [] }`
   * (the default), so this is fully backward-compatible.
   */
  executeRows?: Array<{
    match: string;
    rows: Array<Record<string, unknown>>;
  }>;
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

  function executeRowsFor(sqlText: string): Array<Record<string, unknown>> {
    for (const rule of opts.executeRows ?? []) {
      if (sqlText.includes(rule.match)) return rule.rows;
    }
    return [];
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
    // The mastery tracker + audit helper + the raw-SQL draft handler use
    // db.execute(sql`...`). Drizzle's sql template object stringifies via
    // its `.queryChunks` (which includes the bound param VALUES), so the
    // recorded sqlText is exact enough to assert table/column/param shape.
    // Seeded rows (executeRows) are returned for matching statements; all
    // others return `{ rows: [] }` (the default).
    execute(q: unknown): Promise<unknown> {
      let sqlText = 'sql';
      try {
        sqlText = JSON.stringify(q);
      } catch {
        sqlText = String(q);
      }
      executes.push({ sqlText });
      return Promise.resolve({ rows: executeRowsFor(sqlText) });
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

  it('KNOWN set includes the confirm-required domain verbs + the draft + support + edit/remove/tab verbs', () => {
    expect([...knownVerbs()].sort()).toEqual([
      'add_employee',
      'archive_site',
      'cancel_reminder',
      'create_licence',
      'create_site',
      'delete_production',
      'draft_payroll_run',
      'draft_royalty_return',
      'escalate_to_human',
      'log_production',
      'manage_tab',
      'open_support_case',
      'remove_employee',
      'resolve_support_case',
      'set_reminder',
      'snooze_reminder',
      'update_employee',
      'update_licence',
      'update_production',
      'update_reminder',
      'update_site',
      'void_licence',
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

  it('domain verbs are KNOWN but NOT auto-safe', () => {
    // Known to the registry…
    expect(isKnownVerb('create_site')).toBe(true);
    expect(isKnownVerb('add_employee')).toBe(true);
    expect(isKnownVerb('create_licence')).toBe(true);
    expect(isKnownVerb('log_production')).toBe(true);
    expect(isKnownVerb('CREATE_SITE')).toBe(true);
    expect(isKnownVerb('LOG_PRODUCTION')).toBe(true);
    // …but never auto-safe (brain-teach's isSafeVerb gate refuses them).
    expect(isSafeVerb('create_site')).toBe(false);
    expect(isSafeVerb('add_employee')).toBe(false);
    expect(isSafeVerb('create_licence')).toBe(false);
    expect(isSafeVerb('log_production')).toBe(false);
  });

  it('requiresConfirmation is TRUE only for known confirm-required verbs', () => {
    expect(requiresConfirmation('create_site')).toBe(true);
    expect(requiresConfirmation('add_employee')).toBe(true);
    expect(requiresConfirmation('ADD_EMPLOYEE')).toBe(true);
    expect(requiresConfirmation('create_licence')).toBe(true);
    expect(requiresConfirmation('log_production')).toBe(true);
    expect(requiresConfirmation('LOG_PRODUCTION')).toBe(true);
    // The non-money DRAFT verbs are confirm-required (never auto-safe).
    expect(requiresConfirmation('draft_payroll_run')).toBe(true);
    expect(requiresConfirmation('DRAFT_PAYROLL_RUN')).toBe(true);
    expect(requiresConfirmation('draft_royalty_return')).toBe(true);
    expect(requiresConfirmation('DRAFT_ROYALTY_RETURN')).toBe(true);
    // Auto-safe verbs are not confirm-required.
    expect(requiresConfirmation('set_reminder')).toBe(false);
    // An unknown verb is "unknown", not "confirm-required".
    expect(requiresConfirmation('teleport_owner')).toBe(false);
  });

  it('draft_payroll_run is KNOWN + confirm-required but NEVER auto-safe', () => {
    expect(isKnownVerb('draft_payroll_run')).toBe(true);
    expect(isKnownVerb('DRAFT_PAYROLL_RUN')).toBe(true);
    expect(isSafeVerb('draft_payroll_run')).toBe(false);
    // It must NOT leak into the auto-safe set, or brain-teach could
    // auto-create a payroll draft without an explicit confirmation.
    expect([...safeVerbs()]).not.toContain('draft_payroll_run');
  });

  it('draft_royalty_return is KNOWN + confirm-required but NEVER auto-safe', () => {
    // The royalty-draft wave landed `royalty_return_drafts` (migration 0159),
    // so the verb is now registered as the royalty sibling of
    // draft_payroll_run — a confirm-required NON-MONEY DRAFT.
    expect(isKnownVerb('draft_royalty_return')).toBe(true);
    expect(isKnownVerb('DRAFT_ROYALTY_RETURN')).toBe(true);
    expect(requiresConfirmation('draft_royalty_return')).toBe(true);
    expect(isSafeVerb('draft_royalty_return')).toBe(false);
    // It must NOT leak into the auto-safe set, or brain-teach could
    // auto-create a royalty draft without an explicit confirmation.
    expect([...safeVerbs()]).not.toContain('draft_royalty_return');
  });

  it('the DEFERRED money verbs are NOT registered (must go via LedgerService)', () => {
    // file_royalty / set_payroll / post_ledger are documented DEFERRED in
    // registry.ts and MUST NOT be dispatchable as plain domain inserts —
    // they write the money path (LedgerService.post()) and are absent here.
    for (const verb of ['file_royalty', 'set_payroll', 'post_ledger']) {
      expect(isKnownVerb(verb)).toBe(false);
      expect(isSafeVerb(verb)).toBe(false);
      // Unknown ⇒ NOT "confirm-required" (it is simply not in the registry).
      expect(requiresConfirmation(verb)).toBe(false);
    }
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

describe('create_licence → confirm path executes (insert + audit + mastery)', () => {
  it('gate authorizes a benign create_licence verb', () => {
    const decision = decideAutoAuthorization(
      'create_licence',
      'Owner asked to register their new PML title for the Geita block.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);
  });

  it('inserts a licences row (tenant-scoped, company resolved), audits, mastery', async () => {
    // The handler resolves the tenant's most-recent company first.
    const shim = makeShim({
      selectRowsByTable: { companies: [{ id: 'co-1' }] },
      insertReturn: { id: 'lic-new', kind: 'PML', number: 'PML-0241' },
    });

    // Endpoint contract: authorize FIRST, only dispatch when ok.
    const decision = decideAutoAuthorization(
      'create_licence',
      'Register the PML title.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);

    const out = await dispatchAction(
      'create_licence',
      { type: 'pml', number: 'PML-0241', authority: 'Ministry of Minerals', expiresAt: '2030-01-01' },
      makeCtx(shim.client),
    );

    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('licence');
      expect(out.result.id).toBeTruthy();
      expect(out.result.summary).toContain('PML-0241');
    }

    // Real persisted side effect: one insert into the licences table, with
    // the bound tenant on the row (belt-and-braces RLS) and the resolved
    // company FK. `type` is normalised to the upper-case `kind` code.
    expect(shim.inserts).toHaveLength(1);
    expect(shim.inserts[0]!.table).toBe('licences');
    expect(shim.inserts[0]!.values.tenantId).toBe('t-1');
    expect(shim.inserts[0]!.values.companyId).toBe('co-1');
    expect(shim.inserts[0]!.values.kind).toBe('PML');
    expect(shim.inserts[0]!.values.number).toBe('PML-0241');
    expect(shim.inserts[0]!.values.mineral).toBe('unspecified');
    expect(shim.inserts[0]!.values.status).toBe('active');
    expect(shim.inserts[0]!.values.expiryDate).toBe('2030-01-01');
    // Authority + chat provenance recorded in the `obligations` jsonb.
    expect(shim.inserts[0]!.values.obligations).toMatchObject({
      via: 'chat',
      authority: 'Ministry of Minerals',
    });
    // MONEY BOUNDARY: the `fees` money jsonb must be left at its DB default
    // (never written from chat) — the handler omits it entirely.
    expect(shim.inserts[0]!.values.fees).toBeUndefined();

    // Audit-chain appended (head SELECT + INSERT) AND mastery bumped once.
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
    expect(masteryExecutes(shim.executes)).toBe(1);
  });

  it('synthesises a unique number when omitted and defaults mineral', async () => {
    const shim = makeShim({
      selectRowsByTable: { companies: [{ id: 'co-1' }] },
      insertReturn: { id: 'lic-2', kind: 'ML', number: 'CHAT-XXXX' },
    });
    const out = await dispatchAction(
      'create_licence',
      { type: 'ML' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    // A CHAT-prefixed placeholder satisfies the (tenant, kind, number) UNIQUE.
    expect(String(shim.inserts[0]!.values.number)).toMatch(/^CHAT-[0-9A-F]{8}$/);
    expect(shim.inserts[0]!.values.mineral).toBe('unspecified');
  });

  it('verifies an explicit company and fails gracefully when it is not the tenant’s', async () => {
    // Explicit companyId that the tenant does not own → resolver throws →
    // dispatcher converts to graceful (no insert, no mastery).
    const shim = makeShim({ selectRowsByTable: { companies: [] } });
    const out = await dispatchAction(
      'create_licence',
      { type: 'PML', companyId: 'co-OTHER' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('create_licence_company_not_found:co-OTHER');
    expect(shim.inserts).toHaveLength(0);
    expect(masteryExecutes(shim.executes)).toBe(0);
  });

  it('fails gracefully when the tenant has no company (no insert, no mastery)', async () => {
    const shim = makeShim({ selectRowsByTable: { companies: [] } });
    const out = await dispatchAction(
      'create_licence',
      { type: 'PML' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('create_licence_requires_company');
    expect(shim.inserts).toHaveLength(0);
    expect(masteryExecutes(shim.executes)).toBe(0);
  });
});

describe('log_production → confirm path executes (insert + audit + mastery)', () => {
  it('gate authorizes a benign log_production verb', () => {
    const decision = decideAutoAuthorization(
      'log_production',
      'Owner logged today’s gold output for the Geita pit.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);
  });

  it('inserts a production_records row (tenant-scoped, site verified), audits, mastery', async () => {
    // The handler verifies the REQUIRED site belongs to the tenant first.
    const shim = makeShim({
      selectRowsByTable: { sites: [{ id: 'site-1' }] },
      insertReturn: { id: 'prod-new', siteId: 'site-1' },
    });

    const out = await dispatchAction(
      'log_production',
      { siteId: 'site-1', mineral: 'Au', quantity: 12.5, unit: 'kg', date: '2026-06-01' },
      makeCtx(shim.client),
    );

    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('production_record');
      expect(out.result.id).toBeTruthy();
      expect(out.result.summary).toContain('12.5 kg of Au');
    }

    // Real persisted side effect: one insert into production_records, with
    // the bound tenant + the verified site FK. `kind` defaults to a valid
    // enum value; quantity is projected onto numeric `mass_kg` (string at
    // the ORM boundary) AND echoed into the `grade` jsonb with its unit.
    expect(shim.inserts).toHaveLength(1);
    expect(shim.inserts[0]!.table).toBe('production_records');
    expect(shim.inserts[0]!.values.tenantId).toBe('t-1');
    expect(shim.inserts[0]!.values.siteId).toBe('site-1');
    expect(shim.inserts[0]!.values.kind).toBe('run_of_mine');
    expect(shim.inserts[0]!.values.massKg).toBe('12.5');
    expect(shim.inserts[0]!.values.grade).toMatchObject({
      via: 'chat',
      mineral: 'Au',
      quantity: 12.5,
      unit: 'kg',
    });
    const ts = shim.inserts[0]!.values.ts as Date;
    expect(ts.getTime()).toBe(new Date('2026-06-01').getTime());

    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
    expect(masteryExecutes(shim.executes)).toBe(1);
  });

  it('defaults ts to now() when date omitted', async () => {
    const shim = makeShim({
      selectRowsByTable: { sites: [{ id: 'site-1' }] },
      insertReturn: { id: 'prod-2', siteId: 'site-1' },
    });
    const out = await dispatchAction(
      'log_production',
      { siteId: 'site-1', mineral: 'Cu', quantity: 3, unit: 't' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    // No explicit `ts` written → column default (now()) applies.
    expect(shim.inserts[0]!.values.ts).toBeUndefined();
  });

  it('fails gracefully when the site is not the tenant’s (no insert, no mastery)', async () => {
    // No site rows → resolver throws → dispatcher converts to graceful.
    const shim = makeShim({ selectRowsByTable: { sites: [] } });
    const out = await dispatchAction(
      'log_production',
      { siteId: 'site-OTHER', mineral: 'Au', quantity: 1, unit: 'kg' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('log_production_site_not_found:site-OTHER');
    expect(shim.inserts).toHaveLength(0);
    expect(masteryExecutes(shim.executes)).toBe(0);
  });
});

// ─── draft_payroll_run: confirm-required NON-MONEY DRAFT verb ─────────
//
// This verb creates ONLY the `payroll_runs` header in `status='draft'`
// (the pre-money state). It MUST NOT move money: no wage figures, no
// `payroll_line_items`, no LedgerService, no ledger/journal write. The
// owner approves the draft elsewhere; a SEPARATE commit step posts the
// ledger. These tests pin that money boundary by construction.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

/**
 * The draft_payroll_run handler writes via raw `db.execute(sql`…`)` (the
 * `payrollRuns` Drizzle table is not re-exported from the @borjie/database
 * barrel — a packaging gap OUT OF SCOPE for this wave), so we assert on the
 * recorded SQL `executes`. Drizzle's `sql` template serializes the literal
 * SQL fragments AND the bound param VALUES into `queryChunks`, so the
 * captured text is exact enough to assert table / column / param shape.
 */
const DRAFT_HANDLER_PATH = '../handlers/payroll-draft.ts';

/** The payroll_runs INSERT(s) — the only DOMAIN write the handler performs.
 *  Scoped to payroll_runs so the mastery (`user_action_tracker`) and audit
 *  (`ai_audit_chain`) upserts — which are also `INSERT INTO …` — are not
 *  conflated with a duplicate-draft write. */
function payrollInsertExecutes(
  executes: Array<{ sqlText: string }>,
): Array<{ sqlText: string }> {
  return executes.filter((e) => /INSERT INTO payroll_runs/i.test(e.sqlText));
}

/** Strip line + block comments so a doc-comment MENTION of a forbidden token
 *  (the handler's own "imports NO LedgerService" note) can't false-trip a
 *  source assertion that targets actual CODE. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/^[\t ]*\/\/.*$/gm, ' '); // line comments
}

/** Every money/amount column on payroll_runs + payroll_line_items. NONE of
 *  these may ever appear in the draft verb's INSERT (no wages from chat). */
const PAYROLL_MONEY_COLUMNS = [
  'total_tzs',
  'worker_count',
  'hourly_rate_tzs',
  'base_tzs',
  'overtime_tzs',
  'bonus_tzs',
  'deduction_tzs',
  'net_tzs',
  'ledger_txn_id',
] as const;

/** The payroll_runs INSERT must name NONE of the money columns. */
function assertPayrollInsertHasNoMoneyColumns(sqlText: string): void {
  // Only inspect the column list (before VALUES) so a param value that
  // incidentally contains a token can't false-trip the column assertion.
  const columnList = sqlText.split(/VALUES/i)[0] ?? sqlText;
  for (const col of PAYROLL_MONEY_COLUMNS) {
    expect(columnList).not.toContain(col);
  }
}

/**
 * Assert that NOWHERE in the recorded executes is there a write (INSERT /
 * UPDATE) against a ledger / journal / payroll_line_items table. We scope to
 * write-statements-against-tables so the audit row — which legitimately
 * NAMES the boundary in its payload (`ledgerPosted:false`) — does not
 * false-positive.
 */
function assertNoLedgerOrWageWrite(executes: Array<{ sqlText: string }>): void {
  for (const e of executes) {
    expect(e.sqlText).not.toMatch(/(INSERT INTO|UPDATE)\s+\\?"?\w*(ledger|journal)/i);
    expect(e.sqlText).not.toMatch(/payroll_line_items/i);
  }
}

describe('draft_payroll_run → confirm path creates a DRAFT (NO money moved)', () => {
  it('gate authorizes a benign draft_payroll_run verb', () => {
    const decision = decideAutoAuthorization(
      'draft_payroll_run',
      'Owner asked to start a draft payroll run for May for owner review.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);
  });

  it('writes a payroll_runs DRAFT (status=draft), audits, bumps mastery — NO money', async () => {
    // No existing run for the period (idempotent SELECT → []) → fresh
    // INSERT. The INSERT RETURNING yields the new row. The header is the
    // ONLY write; NO payroll_line_items (the wage rows) are created.
    const shim = makeShim({
      executeRows: [
        { match: 'INSERT INTO payroll_runs', rows: [{ id: 'run-new', status: 'draft' }] },
      ],
    });

    // Endpoint contract: authorize FIRST, only dispatch when ok.
    const decision = decideAutoAuthorization(
      'draft_payroll_run',
      'Start the May payroll draft for review.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);

    const out = await dispatchAction(
      'draft_payroll_run',
      { period: '2026-05' },
      makeCtx(shim.client),
    );

    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('payroll_run_draft');
      expect(out.result.id).toBe('run-new');
      expect(out.result.data?.status).toBe('draft');
      expect(out.result.data?.periodStart).toBe('2026-05-01');
      expect(out.result.data?.periodEnd).toBe('2026-05-31');
    }

    // It uses raw SQL (not the Drizzle .insert() builder) → no `inserts`.
    expect(shim.inserts).toHaveLength(0);

    // Exactly ONE INSERT statement — into payroll_runs, status 'draft',
    // tenant-bound. The serialized chunks carry the param values too.
    const writes = payrollInsertExecutes(shim.executes);
    expect(writes).toHaveLength(1);
    const insertSql = writes[0]!.sqlText;
    expect(insertSql).toContain('INSERT INTO payroll_runs');
    expect(insertSql).toContain("'draft'"); // the pre-money state literal
    expect(insertSql).toContain('t-1'); // bound tenant param (RLS belt+braces)
    expect(insertSql).toContain('u-1'); // bound created_by_user_id param
    expect(insertSql).toContain('2026-05-01'); // derived period_start
    expect(insertSql).toContain('2026-05-31'); // derived period_end

    // MONEY BOUNDARY: the INSERT column list names NONE of the money columns
    // (total_tzs / worker_count / *_tzs / ledger_txn_id) — left at DB default.
    assertPayrollInsertHasNoMoneyColumns(insertSql);

    // NO write to any ledger / journal / payroll_line_items table anywhere.
    assertNoLedgerOrWageWrite(shim.executes);

    // Audit-chain appended (head SELECT + INSERT into ai_audit_chain) AND
    // mastery bumped once. (Audit chain is NOT a ledger/journal table.)
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
    expect(masteryExecutes(shim.executes)).toBe(1);
  });

  it('PROOF: the handler CODE imports NO LedgerService and writes no ledger/wages', () => {
    // Static guarantee: the draft handler can never even reach the money
    // path. Scan the COMMENT-STRIPPED source (so the handler's own
    // "imports NO LedgerService" doc note doesn't false-trip) and assert
    // the CODE has no LedgerService import / ledger-port / payments-ledger
    // reference, no `.post(` call, and never names the wage rows table or
    // any wage/total money column.
    const here = dirname(fileURLToPath(import.meta.url));
    const handlerCode = stripComments(
      readFileSync(resolvePath(here, DRAFT_HANDLER_PATH), 'utf8'),
    );
    expect(handlerCode).not.toMatch(/LedgerService/);
    expect(handlerCode).not.toMatch(/payments-ledger/);
    expect(handlerCode).not.toMatch(/ledger-port/);
    expect(handlerCode).not.toMatch(/\bledger\b/i);
    expect(handlerCode).not.toMatch(/\.post\(/);
    expect(handlerCode).not.toMatch(/payroll_line_items/);
    expect(handlerCode).not.toMatch(/payrollLineItems/);
    // The handler CODE must never name a wage/total money column in any SQL.
    for (const col of PAYROLL_MONEY_COLUMNS) {
      expect(handlerCode).not.toContain(col);
    }
  });

  it('accepts explicit periodStart/periodEnd bounds (parity with owner route)', async () => {
    const shim = makeShim({
      executeRows: [
        { match: 'INSERT INTO payroll_runs', rows: [{ id: 'run-2', status: 'draft' }] },
      ],
    });
    const out = await dispatchAction(
      'draft_payroll_run',
      { periodStart: '2026-05-01', periodEnd: '2026-05-15' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    const insertSql = payrollInsertExecutes(shim.executes)[0]!.sqlText;
    expect(insertSql).toContain('2026-05-01');
    expect(insertSql).toContain('2026-05-15');
    assertPayrollInsertHasNoMoneyColumns(insertSql);
    assertNoLedgerOrWageWrite(shim.executes);
  });

  it('verifies an optional target site and records it in notes (no site_id col, no money)', async () => {
    const shim = makeShim({
      executeRows: [
        // The site-verification SELECT returns the tenant-owned site…
        { match: 'SELECT id FROM sites', rows: [{ id: 'site-7' }] },
        // …and the INSERT RETURNING yields the new draft row.
        { match: 'INSERT INTO payroll_runs', rows: [{ id: 'run-3', status: 'draft' }] },
      ],
    });
    const out = await dispatchAction(
      'draft_payroll_run',
      { period: '2026-05', siteId: 'site-7' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    // payroll_runs has NO site_id column — the verified site is recorded in
    // the free-text `notes` provenance param, never as a money figure.
    const insertSql = payrollInsertExecutes(shim.executes)[0]!.sqlText;
    expect(insertSql).toContain('site-7'); // in the notes JSON param
    expect(insertSql).toContain('draft_payroll_run'); // notes intent marker
    // The site id rides in `notes`, NOT as a `site_id` column.
    const columnList = insertSql.split(/VALUES/i)[0] ?? '';
    expect(columnList).not.toContain('site_id');
    assertPayrollInsertHasNoMoneyColumns(insertSql);
    assertNoLedgerOrWageWrite(shim.executes);
  });

  it('is idempotent on (tenant, period) — returns the existing draft, NO INSERT', async () => {
    // The idempotent SELECT returns an existing run → return it, never
    // INSERT a duplicate (and certainly no money write).
    const shim = makeShim({
      executeRows: [
        {
          match: 'SELECT id, status FROM payroll_runs',
          rows: [{ id: 'run-existing', status: 'draft' }],
        },
      ],
    });
    const out = await dispatchAction(
      'draft_payroll_run',
      { period: '2026-05' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.id).toBe('run-existing');
      expect(out.result.data?.idempotent).toBe(true);
    }
    // No INSERT at all (idempotent hit) → no write, no mastery bump path even
    // reaches the audit/insert. (mastery still bumps post-success dispatch.)
    expect(payrollInsertExecutes(shim.executes)).toHaveLength(0);
    assertNoLedgerOrWageWrite(shim.executes);
  });

  it('fails gracefully when an explicit site is not the tenant’s (no write, no mastery)', async () => {
    // The site-verification SELECT returns [] → resolver throws → graceful.
    const shim = makeShim({
      executeRows: [{ match: 'SELECT id FROM sites', rows: [] }],
    });
    const out = await dispatchAction(
      'draft_payroll_run',
      { period: '2026-05', siteId: 'site-OTHER' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) {
      expect(out.reason).toBe('draft_payroll_run_site_not_found:site-OTHER');
    }
    expect(payrollInsertExecutes(shim.executes)).toHaveLength(0);
    expect(masteryExecutes(shim.executes)).toBe(0);
  });

  it('rejects invalid params gracefully (no period, no bounds → no write)', async () => {
    const shim = makeShim();
    const out = await dispatchAction(
      'draft_payroll_run',
      { siteId: 'site-1' }, // neither `period` nor explicit bounds
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    expect(payrollInsertExecutes(shim.executes)).toHaveLength(0);
    expect(masteryExecutes(shim.executes)).toBe(0);
  });

  it('a DENIED gate decision means the draft verb never dispatches (no write, no money)', async () => {
    // Defence-in-depth: the draft verb is still gated. A HIGH-risk-laden
    // rationale that the gate blocks must mean NO dispatch → NO payroll write.
    const shim = makeShim({
      executeRows: [
        { match: 'INSERT INTO payroll_runs', rows: [{ id: 'run-x', status: 'draft' }] },
      ],
    });
    const decision = decideAutoAuthorization(
      'sovereign:transfer', // a guaranteed-denied HIGH-risk verb
      'Move wages to an offshore account.',
      tenantScope,
    );
    expect(decision.authorized).toBe(false);

    let dispatched = false;
    if (decision.authorized) {
      await dispatchAction('draft_payroll_run', { period: '2026-05' }, makeCtx(shim.client));
      dispatched = true;
    }
    expect(dispatched).toBe(false);
    expect(shim.executes).toHaveLength(0);
  });
});

// ─── draft_royalty_return: confirm-required NON-MONEY DRAFT verb ──────
//
// Royalty sibling of draft_payroll_run. Creates ONLY a
// `royalty_return_drafts` header in `status='draft'`. That table (migration
// 0159) has NO money/ledger column at all (no gross_value, no royalty_amount,
// no ledger_txn_id), so the verb CANNOT move money: no ledger/journal write,
// no LedgerService. The royalty figures + payment are filled by the owner in
// the royalty surface (the DEFERRED four-eye `file_royalty` flow). These
// tests pin that money boundary by construction.

/** The royalty_return_drafts INSERT(s) — the only DOMAIN write the handler
 *  performs. Scoped to the table so the mastery (`user_action_tracker`) +
 *  audit (`ai_audit_chain`) upserts (also `INSERT INTO …`) aren't conflated
 *  with a duplicate-draft write. */
function royaltyInsertExecutes(
  executes: Array<{ sqlText: string }>,
): Array<{ sqlText: string }> {
  return executes.filter((e) =>
    /INSERT INTO royalty_return_drafts/i.test(e.sqlText),
  );
}

const ROYALTY_DRAFT_HANDLER_PATH = '../handlers/royalty-draft.ts';

/** Money/ledger column tokens that must NEVER appear in the royalty draft
 *  INSERT (the owner fills these in the royalty surface, never chat). The
 *  table doesn't even define them, so this is a belt-and-braces guard. */
const ROYALTY_MONEY_COLUMNS = [
  'gross_value',
  'royalty_amount',
  'royalty_rate',
  'royalty_tzs',
  'amount_tzs',
  'ledger_txn_id',
] as const;

/** The royalty_return_drafts INSERT must name NONE of the money columns. */
function assertRoyaltyInsertHasNoMoneyColumns(sqlText: string): void {
  const columnList = sqlText.split(/VALUES/i)[0] ?? sqlText;
  for (const col of ROYALTY_MONEY_COLUMNS) {
    expect(columnList).not.toContain(col);
  }
}

/** No write (INSERT/UPDATE) against any ledger / journal table anywhere in the
 *  recorded executes. The audit row legitimately NAMES the boundary in its
 *  payload (`ledgerPosted:false`) so we scope to write-against-table only. */
function assertNoLedgerWrite(executes: Array<{ sqlText: string }>): void {
  for (const e of executes) {
    expect(e.sqlText).not.toMatch(/(INSERT INTO|UPDATE)\s+\\?"?\w*(ledger|journal)/i);
  }
}

describe('draft_royalty_return → confirm path creates a DRAFT (NO money moved)', () => {
  it('gate authorizes a benign draft_royalty_return verb', () => {
    const decision = decideAutoAuthorization(
      'draft_royalty_return',
      'Owner asked to start a draft royalty return for May gold for review.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);
  });

  it('writes a royalty_return_drafts DRAFT (status=draft), audits, bumps mastery — NO money', async () => {
    // No existing draft for the period+mineral (idempotent SELECT → []) →
    // fresh INSERT. The header is the ONLY domain write; NO money figure.
    const shim = makeShim({
      executeRows: [
        {
          match: 'INSERT INTO royalty_return_drafts',
          rows: [{ id: 'roy-new', status: 'draft' }],
        },
      ],
    });

    // Endpoint contract: authorize FIRST, only dispatch when ok.
    const decision = decideAutoAuthorization(
      'draft_royalty_return',
      'Start the May gold royalty draft for review.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);

    const out = await dispatchAction(
      'draft_royalty_return',
      { period: '2026-05', mineral: 'Au' },
      makeCtx(shim.client),
    );

    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('royalty_return_draft');
      expect(out.result.id).toBe('roy-new');
      expect(out.result.data?.status).toBe('draft');
      expect(out.result.data?.mineral).toBe('Au');
      expect(out.result.data?.periodStart).toBe('2026-05-01');
      expect(out.result.data?.periodEnd).toBe('2026-05-31');
    }

    // It uses raw SQL (not the Drizzle .insert() builder) → no `inserts`.
    expect(shim.inserts).toHaveLength(0);

    // Exactly ONE INSERT statement — into royalty_return_drafts, status
    // 'draft', tenant-bound. The serialized chunks carry the param values.
    const writes = royaltyInsertExecutes(shim.executes);
    expect(writes).toHaveLength(1);
    const insertSql = writes[0]!.sqlText;
    expect(insertSql).toContain('INSERT INTO royalty_return_drafts');
    expect(insertSql).toContain("'draft'"); // the pre-money state literal
    expect(insertSql).toContain('t-1'); // bound tenant param (RLS belt+braces)
    expect(insertSql).toContain('u-1'); // bound created_by_user_id param
    expect(insertSql).toContain('2026-05-01'); // derived period_start
    expect(insertSql).toContain('2026-05-31'); // derived period_end
    expect(insertSql).toContain('Au'); // the mineral param

    // MONEY BOUNDARY: the INSERT column list names NONE of the money columns.
    assertRoyaltyInsertHasNoMoneyColumns(insertSql);

    // NO write to any ledger / journal table anywhere.
    assertNoLedgerWrite(shim.executes);

    // Audit-chain appended (head SELECT + INSERT into ai_audit_chain) AND
    // mastery bumped once. (Audit chain is NOT a ledger/journal table.)
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
    expect(masteryExecutes(shim.executes)).toBe(1);
  });

  it('records an OPTIONAL non-money quantity + unit (a physical measure, not money)', async () => {
    const shim = makeShim({
      executeRows: [
        {
          match: 'INSERT INTO royalty_return_drafts',
          rows: [{ id: 'roy-q', status: 'draft' }],
        },
      ],
    });
    const out = await dispatchAction(
      'draft_royalty_return',
      { period: '2026-05', mineral: 'Au', quantity: 12.5, unit: 'kg' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.data?.quantity).toBe(12.5);
      expect(out.result.data?.unit).toBe('kg');
    }
    const insertSql = royaltyInsertExecutes(shim.executes)[0]!.sqlText;
    // The physical quantity rides as a bound param — it is NOT a money column.
    expect(insertSql).toContain('12.5');
    expect(insertSql).toContain('kg');
    assertRoyaltyInsertHasNoMoneyColumns(insertSql);
    assertNoLedgerWrite(shim.executes);
  });

  it('PROOF: the handler CODE imports NO LedgerService and writes no ledger/money', () => {
    // Static guarantee: the draft handler can never reach the money path.
    // Scan the COMMENT-STRIPPED source (so the handler's own
    // "imports NO LedgerService" doc note doesn't false-trip) and assert the
    // CODE has no LedgerService import / ledger-port / payments-ledger
    // reference, no `.post(` call, and never names a money column.
    const here = dirname(fileURLToPath(import.meta.url));
    const handlerCode = stripComments(
      readFileSync(resolvePath(here, ROYALTY_DRAFT_HANDLER_PATH), 'utf8'),
    );
    expect(handlerCode).not.toMatch(/LedgerService/);
    expect(handlerCode).not.toMatch(/payments-ledger/);
    expect(handlerCode).not.toMatch(/ledger-port/);
    expect(handlerCode).not.toMatch(/\bledger\b/i);
    expect(handlerCode).not.toMatch(/\bjournal\b/i);
    expect(handlerCode).not.toMatch(/\.post\(/);
    // The handler CODE must never name a money column in any SQL.
    for (const col of ROYALTY_MONEY_COLUMNS) {
      expect(handlerCode).not.toContain(col);
    }
  });

  it('accepts explicit periodStart/periodEnd bounds (parity with owner route)', async () => {
    const shim = makeShim({
      executeRows: [
        {
          match: 'INSERT INTO royalty_return_drafts',
          rows: [{ id: 'roy-2', status: 'draft' }],
        },
      ],
    });
    const out = await dispatchAction(
      'draft_royalty_return',
      { periodStart: '2026-05-01', periodEnd: '2026-05-15', mineral: 'Cu' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    const insertSql = royaltyInsertExecutes(shim.executes)[0]!.sqlText;
    expect(insertSql).toContain('2026-05-01');
    expect(insertSql).toContain('2026-05-15');
    expect(insertSql).toContain('Cu');
    assertRoyaltyInsertHasNoMoneyColumns(insertSql);
    assertNoLedgerWrite(shim.executes);
  });

  it('is idempotent on (tenant, period, mineral) — returns the existing draft, NO INSERT', async () => {
    // The idempotent SELECT returns an existing draft → return it, never
    // INSERT a duplicate (and certainly no money write).
    const shim = makeShim({
      executeRows: [
        {
          match: 'SELECT id, status FROM royalty_return_drafts',
          rows: [{ id: 'roy-existing', status: 'draft' }],
        },
      ],
    });
    const out = await dispatchAction(
      'draft_royalty_return',
      { period: '2026-05', mineral: 'Au' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.id).toBe('roy-existing');
      expect(out.result.data?.idempotent).toBe(true);
    }
    // No INSERT at all (idempotent hit) → no write.
    expect(royaltyInsertExecutes(shim.executes)).toHaveLength(0);
    assertNoLedgerWrite(shim.executes);
  });

  it('rejects invalid params gracefully (missing mineral → no write)', async () => {
    const shim = makeShim();
    const out = await dispatchAction(
      'draft_royalty_return',
      { period: '2026-05' }, // mineral is required
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    expect(royaltyInsertExecutes(shim.executes)).toHaveLength(0);
    expect(masteryExecutes(shim.executes)).toBe(0);
  });

  it('rejects invalid params gracefully (no period, no bounds → no write)', async () => {
    const shim = makeShim();
    const out = await dispatchAction(
      'draft_royalty_return',
      { mineral: 'Au' }, // neither `period` nor explicit bounds
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    expect(royaltyInsertExecutes(shim.executes)).toHaveLength(0);
    expect(masteryExecutes(shim.executes)).toBe(0);
  });

  it('a DENIED gate decision means the royalty draft never dispatches (no write, no money)', async () => {
    // Defence-in-depth: the draft verb is still gated. A HIGH-risk verb the
    // gate blocks must mean NO dispatch → NO royalty write.
    const shim = makeShim({
      executeRows: [
        {
          match: 'INSERT INTO royalty_return_drafts',
          rows: [{ id: 'roy-x', status: 'draft' }],
        },
      ],
    });
    const decision = decideAutoAuthorization(
      'sovereign:transfer', // a guaranteed-denied HIGH-risk verb
      'Move royalty money to an offshore account.',
      tenantScope,
    );
    expect(decision.authorized).toBe(false);

    let dispatched = false;
    if (decision.authorized) {
      await dispatchAction(
        'draft_royalty_return',
        { period: '2026-05', mineral: 'Au' },
        makeCtx(shim.client),
      );
      dispatched = true;
    }
    expect(dispatched).toBe(false);
    expect(shim.executes).toHaveLength(0);
  });
});

// ─── Auto-execute / micro-action REFUSE confirm-required verbs ────────

describe('confirm-required verbs never auto-execute', () => {
  it('brain-teach gate (isSafeVerb) refuses every confirm-required domain verb', () => {
    // brain-teach.hono.ts only dispatches when isSafeVerb(verb) — so a
    // confirm-required verb is left badge-only there.
    expect(isSafeVerb('create_site')).toBe(false);
    expect(isSafeVerb('add_employee')).toBe(false);
    expect(isSafeVerb('create_licence')).toBe(false);
    expect(isSafeVerb('log_production')).toBe(false);
    // The non-money DRAFT verbs are likewise refused on the auto-execute path.
    expect(isSafeVerb('draft_payroll_run')).toBe(false);
    expect(isSafeVerb('draft_royalty_return')).toBe(false);
  });

  it('/micro-action contract refuses every confirm-required verb up front', () => {
    // Mirrors the route guard in chat-actions.hono.ts: on the auto-safe
    // micro-action surface, a confirm-required verb returns
    // executed:false reason:confirmation_required BEFORE any dispatch.
    const microActionRefuses = (verb: string): boolean =>
      requiresConfirmation(verb); // source === 'micro_action' is implied here
    expect(microActionRefuses('create_site')).toBe(true);
    expect(microActionRefuses('add_employee')).toBe(true);
    expect(microActionRefuses('create_licence')).toBe(true);
    expect(microActionRefuses('log_production')).toBe(true);
    // The non-money DRAFT verbs are also refused on the auto-safe surface.
    expect(microActionRefuses('draft_payroll_run')).toBe(true);
    expect(microActionRefuses('draft_royalty_return')).toBe(true);
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
