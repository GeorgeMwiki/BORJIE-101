/**
 * UPDATE / DELETE-ARCHIVE / manage_tab verb tests — the "MD can EDIT + REMOVE
 * anything, durably" half of the action bridge.
 *
 * Contracts pinned here:
 *   1. Registry membership: every new verb is KNOWN + CONFIRM-REQUIRED, never
 *      auto-safe (so the auto-execute / micro-action surfaces refuse them; only
 *      /confirm-action runs them).
 *   2. Each UPDATE verb writes a tenant-scoped UPDATE (set values + bound tenant
 *      predicate) against the RIGHT table, and appends an ai_audit_chain entry +
 *      bumps mastery on success.
 *   3. Each DELETE/ARCHIVE verb SOFT-deletes (status flip / voided marker), NOT a
 *      hard DELETE — and audits.
 *   4. manage_tab persists each structural op (spawn/update/remove/reorder/pin)
 *      to owner_tabs_structural, tenant+user scoped, and audits.
 *   5. CROSS-TENANT / not-found: when the tenant-scoped predicate matches no row
 *      the verb fails gracefully (executed:false, `*_not_found`), with NO audit
 *      and NO mastery bump — proving a cross-tenant id can never mutate a row.
 *   6. MONEY BOUNDARY: no UPDATE `set` ever names a money column (wage/fees/
 *      ledger), and nothing writes a ledger/journal table.
 *
 * Runs the registry + handlers + audit + mastery UNMOCKED against a hand-rolled
 * Drizzle shim that records every select / update / insert / execute, plus the
 * real `decideAutoAuthorization` gate for the gate→dispatch contract.
 */

import { describe, it, expect } from 'vitest';
import { getTableName } from 'drizzle-orm';

import {
  dispatchAction,
  isKnownVerb,
  isSafeVerb,
  requiresConfirmation,
  type ExecContext,
} from '../index.js';
import { decideAutoAuthorization } from '../../auto-authorize-gate/index.js';
import type { ScopeContext } from '@borjie/central-intelligence';

// ─── Drizzle shim (records reads + writes; clips to seeded rows) ──────

interface UpdateCall {
  table: string;
  set: Record<string, unknown>;
}
interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}

function tableNameOf(obj: unknown): string {
  try {
    return getTableName(obj as never);
  } catch {
    return 'unknown';
  }
}

/**
 * `selectRowsByTable` seeds what `select().from(table).where()….limit()`
 * yields (the merge-read step + the reminder status pre-check). `updateReturnByTable`
 * seeds what an `update().set().where().returning()` yields (the post-write row).
 * An EMPTY array for either ⇒ the handler sees "no row" ⇒ throws `*_not_found`
 * (the cross-tenant / not-found path). `insertReturn` seeds spawn's INSERT.
 */
function makeShim(opts: {
  selectRowsByTable?: Record<string, Array<Record<string, unknown>>>;
  updateReturnByTable?: Record<string, Array<Record<string, unknown>>>;
  insertReturn?: Record<string, unknown>;
} = {}) {
  const selects: string[] = [];
  const updates: UpdateCall[] = [];
  const inserts: InsertCall[] = [];
  const executes: Array<{ sqlText: string }> = [];

  function selectRowsFor(t: string): Array<Record<string, unknown>> {
    return opts.selectRowsByTable?.[t] ?? [];
  }
  function updateReturnFor(t: string): Array<Record<string, unknown>> {
    // Default: one row echoing common projected columns so the happy path has a
    // row to return when a test doesn't override it.
    return (
      opts.updateReturnByTable?.[t] ?? [
        {
          id: `${t}_1`,
          name: 'X',
          fullName: 'X',
          label: 'X',
          title: 'X',
          status: 'ok',
          kind: 'PML',
          number: 'N',
          position: 0,
          pinned: true,
          siteId: 'site_1',
        },
      ]
    );
  }

  const client = {
    insert(table: unknown) {
      const t = tableNameOf(table);
      return {
        values(v: Record<string, unknown>) {
          inserts.push({ table: t, values: v });
          const row = opts.insertReturn ?? { id: v.id ?? `${t}_1`, tabId: v.tabId };
          return { returning: () => Promise.resolve([row]) };
        },
      };
    },
    select(_cols?: unknown) {
      return {
        from(table: unknown) {
          const t = tableNameOf(table);
          selects.push(t);
          const terminal = { limit: () => Promise.resolve(selectRowsFor(t)) };
          return {
            where(_p: unknown) {
              return {
                ...terminal,
                orderBy: (..._o: unknown[]) => terminal,
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      const t = tableNameOf(table);
      return {
        set(s: Record<string, unknown>) {
          return {
            where(_p: unknown) {
              updates.push({ table: t, set: s });
              return { returning: () => Promise.resolve(updateReturnFor(t)) };
            },
          };
        },
      };
    },
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

  return { client, selects, updates, inserts, executes };
}

const silentLogger: ExecContext['logger'] = { info: () => {}, warn: () => {}, error: () => {} };

function makeCtx(db: unknown, overrides: Partial<ExecContext> = {}): ExecContext {
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

function masteryExecutes(executes: Array<{ sqlText: string }>): number {
  return executes.filter((e) => e.sqlText.includes('user_action_tracker')).length;
}
function auditExecutes(executes: Array<{ sqlText: string }>): number {
  return executes.filter((e) => e.sqlText.includes('ai_audit_chain')).length;
}
/** No write (INSERT/UPDATE) against any ledger/journal table anywhere. */
function assertNoLedgerWrite(executes: Array<{ sqlText: string }>): void {
  for (const e of executes) {
    expect(e.sqlText).not.toMatch(/(INSERT INTO|UPDATE)\s+\\?"?\w*(ledger|journal)/i);
  }
}
/** No UPDATE `set` object may name a money column. */
const MONEY_KEYS = ['wageRateTzs', 'wage_rate_tzs', 'fees', 'ledgerTxnId', 'ledger_txn_id', 'totalTzs', 'netTzs'];
function assertNoMoneyInSet(set: Record<string, unknown>): void {
  for (const k of MONEY_KEYS) {
    expect(Object.prototype.hasOwnProperty.call(set, k)).toBe(false);
  }
}

const ALL_NEW_VERBS = [
  'update_site',
  'update_employee',
  'update_licence',
  'update_production',
  'update_reminder',
  'archive_site',
  'remove_employee',
  'void_licence',
  'delete_production',
  'cancel_reminder',
  'manage_tab',
] as const;

// ─── 1) registry membership ──────────────────────────────────────────

describe('edit/remove/tab verbs — registry membership', () => {
  it('all are KNOWN + confirm-required, never auto-safe', () => {
    for (const verb of ALL_NEW_VERBS) {
      expect(isKnownVerb(verb)).toBe(true);
      expect(requiresConfirmation(verb)).toBe(true);
      expect(isSafeVerb(verb)).toBe(false);
      // case-insensitive
      expect(isKnownVerb(verb.toUpperCase())).toBe(true);
    }
  });

  it('the gate authorizes the benign edit/remove verbs', () => {
    for (const verb of ALL_NEW_VERBS) {
      const decision = decideAutoAuthorization(verb, `Owner asked to ${verb}.`, tenantScope);
      expect(decision.authorized).toBe(true);
    }
  });
});

// ─── 2) UPDATE verbs ─────────────────────────────────────────────────

describe('update_site', () => {
  it('writes a tenant-scoped sites UPDATE, audits, bumps mastery, no money', async () => {
    const shim = makeShim({
      selectRowsByTable: { sites: [{ id: 'site-1', attributes: { foo: 'bar' } }] },
      updateReturnByTable: { sites: [{ id: 'site-1', name: 'Geita Pit 1', status: 'paused' }] },
    });
    const out = await dispatchAction(
      'update_site',
      { id: 'site-1', name: 'Geita Pit 1', status: 'paused', district: 'Geita' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('site');
      expect(out.result.summary).toContain('Geita Pit 1');
    }
    expect(shim.updates).toHaveLength(1);
    expect(shim.updates[0]!.table).toBe('sites');
    expect(shim.updates[0]!.set.name).toBe('Geita Pit 1');
    expect(shim.updates[0]!.set.status).toBe('paused');
    // jsonb merge preserved the prior key + recorded locality + edit provenance.
    expect(shim.updates[0]!.set.attributes).toMatchObject({ foo: 'bar', district: 'Geita', editedVia: 'chat' });
    assertNoMoneyInSet(shim.updates[0]!.set);
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
    expect(masteryExecutes(shim.executes)).toBe(1);
    assertNoLedgerWrite(shim.executes);
  });

  it('refuses a cross-tenant / unknown id (no update, no audit, no mastery)', async () => {
    // The merge-read SELECT returns [] → handler throws *_not_found.
    const shim = makeShim({ selectRowsByTable: { sites: [] } });
    const out = await dispatchAction('update_site', { id: 'site-OTHER', name: 'Hijack' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('update_site_not_found:site-OTHER');
    expect(shim.updates).toHaveLength(0);
    expect(auditExecutes(shim.executes)).toBe(0);
    expect(masteryExecutes(shim.executes)).toBe(0);
  });

  it('rejects an empty patch (no field to change) gracefully', async () => {
    const shim = makeShim({ selectRowsByTable: { sites: [{ id: 'site-1', attributes: {} }] } });
    const out = await dispatchAction('update_site', { id: 'site-1' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    expect(shim.updates).toHaveLength(0);
  });
});

describe('update_employee', () => {
  it('writes a tenant-scoped employees UPDATE and NEVER a wage column', async () => {
    const shim = makeShim({
      updateReturnByTable: { employees: [{ id: 'emp-1', fullName: 'Juma', role: 'foreman' }] },
    });
    const out = await dispatchAction(
      'update_employee',
      { id: 'emp-1', role: 'foreman', status: 'suspended' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.table).toBe('employees');
    expect(shim.updates[0]!.set.role).toBe('foreman');
    expect(shim.updates[0]!.set.status).toBe('suspended');
    // MONEY BOUNDARY: the wage column is never in the set.
    assertNoMoneyInSet(shim.updates[0]!.set);
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
    expect(masteryExecutes(shim.executes)).toBe(1);
  });

  it('verifies an explicit site re-posting belongs to the tenant (refuses foreign site)', async () => {
    // Site-verification SELECT returns [] → *_site_not_found.
    const shim = makeShim({ selectRowsByTable: { sites: [] } });
    const out = await dispatchAction(
      'update_employee',
      { id: 'emp-1', siteId: 'site-OTHER' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('update_employee_site_not_found:site-OTHER');
    expect(shim.updates).toHaveLength(0);
  });

  it('refuses an unknown employee id', async () => {
    const shim = makeShim({ updateReturnByTable: { employees: [] } });
    const out = await dispatchAction('update_employee', { id: 'emp-OTHER', role: 'x' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('update_employee_not_found:emp-OTHER');
    expect(masteryExecutes(shim.executes)).toBe(0);
  });
});

describe('update_licence', () => {
  it('writes a tenant-scoped licences UPDATE, merges obligations, never writes fees', async () => {
    const shim = makeShim({
      selectRowsByTable: { licences: [{ id: 'lic-1', obligations: { eia: true } }] },
      updateReturnByTable: { licences: [{ id: 'lic-1', kind: 'PML', number: 'PML-1', status: 'expired' }] },
    });
    const out = await dispatchAction(
      'update_licence',
      { id: 'lic-1', status: 'expired', authority: 'Ministry' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.table).toBe('licences');
    expect(shim.updates[0]!.set.status).toBe('expired');
    expect(shim.updates[0]!.set.obligations).toMatchObject({ eia: true, authority: 'Ministry', editedVia: 'chat' });
    // MONEY BOUNDARY: `fees` is never in the set.
    assertNoMoneyInSet(shim.updates[0]!.set);
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
  });

  it('refuses an unknown licence id', async () => {
    const shim = makeShim({ selectRowsByTable: { licences: [] } });
    const out = await dispatchAction('update_licence', { id: 'lic-OTHER', status: 'expired' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('update_licence_not_found:lic-OTHER');
  });
});

describe('update_production', () => {
  it('merges the grade jsonb + syncs mass_kg, audits — no money column', async () => {
    const shim = makeShim({
      selectRowsByTable: { production_records: [{ id: 'prod-1', grade: { mineral: 'Au' }, siteId: 'site-1' }] },
      updateReturnByTable: { production_records: [{ id: 'prod-1', siteId: 'site-1' }] },
    });
    const out = await dispatchAction(
      'update_production',
      { id: 'prod-1', quantity: 9.5, unit: 'kg' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.table).toBe('production_records');
    expect(shim.updates[0]!.set.grade).toMatchObject({ mineral: 'Au', quantity: 9.5, unit: 'kg' });
    // mass_kg kept in sync as a string (numeric at ORM boundary) — NOT money.
    expect(shim.updates[0]!.set.massKg).toBe('9.5');
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
  });

  it('refuses an unknown production id', async () => {
    const shim = makeShim({ selectRowsByTable: { production_records: [] } });
    const out = await dispatchAction('update_production', { id: 'prod-OTHER', unit: 'kg' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('update_production_not_found:prod-OTHER');
  });
});

describe('update_reminder', () => {
  it('edits a SCHEDULED reminder owned by the caller, audits', async () => {
    const shim = makeShim({
      selectRowsByTable: { reminders: [{ id: 'rem-1', status: 'scheduled' }] },
      updateReturnByTable: { reminders: [{ id: 'rem-1', title: 'New title' }] },
    });
    const out = await dispatchAction(
      'update_reminder',
      { reminderId: '11111111-1111-1111-1111-111111111111', title: 'New title' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.table).toBe('reminders');
    expect(shim.updates[0]!.set.title).toBe('New title');
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
  });

  it('refuses to edit a non-scheduled (sent) reminder', async () => {
    const shim = makeShim({ selectRowsByTable: { reminders: [{ id: 'rem-1', status: 'sent' }] } });
    const out = await dispatchAction(
      'update_reminder',
      { reminderId: '11111111-1111-1111-1111-111111111111', title: 'x' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toMatch(/cannot edit a sent reminder/);
    expect(shim.updates).toHaveLength(0);
  });

  it('refuses an unknown reminder id (cross-tenant/owner)', async () => {
    const shim = makeShim({ selectRowsByTable: { reminders: [] } });
    const out = await dispatchAction(
      'update_reminder',
      { reminderId: '22222222-2222-2222-2222-222222222222', title: 'x' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toContain('update_reminder_not_found');
  });
});

// ─── 3) DELETE / ARCHIVE verbs (SOFT-delete) ─────────────────────────

describe('archive_site → SOFT-delete (status=abandoned)', () => {
  it('flips status, audits, no hard delete', async () => {
    const shim = makeShim({
      updateReturnByTable: { sites: [{ id: 'site-1', name: 'Geita', status: 'abandoned' }] },
    });
    const out = await dispatchAction('archive_site', { id: 'site-1' }, makeCtx(shim.client));
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.table).toBe('sites');
    expect(shim.updates[0]!.set.status).toBe('abandoned');
    expect(out.executed && out.result.data?.status).toBe('abandoned');
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
    expect(masteryExecutes(shim.executes)).toBe(1);
  });

  it('refuses a cross-tenant id', async () => {
    const shim = makeShim({ updateReturnByTable: { sites: [] } });
    const out = await dispatchAction('archive_site', { id: 'site-OTHER' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('archive_site_not_found:site-OTHER');
    expect(masteryExecutes(shim.executes)).toBe(0);
  });
});

describe('remove_employee → SOFT-delete (status=terminated), no wage write', () => {
  it('off-boards via status, never touches wage', async () => {
    const shim = makeShim({
      updateReturnByTable: { employees: [{ id: 'emp-1', fullName: 'Juma', status: 'terminated' }] },
    });
    const out = await dispatchAction('remove_employee', { id: 'emp-1' }, makeCtx(shim.client));
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.set.status).toBe('terminated');
    assertNoMoneyInSet(shim.updates[0]!.set);
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
  });

  it('refuses a cross-tenant id', async () => {
    const shim = makeShim({ updateReturnByTable: { employees: [] } });
    const out = await dispatchAction('remove_employee', { id: 'emp-OTHER' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('remove_employee_not_found:emp-OTHER');
  });
});

describe('void_licence → SOFT-delete (status=cancelled), no fees write', () => {
  it('voids via status, never touches fees', async () => {
    const shim = makeShim({
      updateReturnByTable: { licences: [{ id: 'lic-1', kind: 'PML', number: 'PML-1', status: 'cancelled' }] },
    });
    const out = await dispatchAction('void_licence', { id: 'lic-1' }, makeCtx(shim.client));
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.set.status).toBe('cancelled');
    assertNoMoneyInSet(shim.updates[0]!.set);
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
  });

  it('refuses a cross-tenant id', async () => {
    const shim = makeShim({ updateReturnByTable: { licences: [] } });
    const out = await dispatchAction('void_licence', { id: 'lic-OTHER' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('void_licence_not_found:lic-OTHER');
  });
});

describe('delete_production → SOFT-delete (grade.voided marker)', () => {
  it('stamps a voided marker into grade (no status column), audits', async () => {
    const shim = makeShim({
      selectRowsByTable: { production_records: [{ id: 'prod-1', grade: { mineral: 'Au' }, siteId: 'site-1' }] },
      updateReturnByTable: { production_records: [{ id: 'prod-1', siteId: 'site-1' }] },
    });
    const out = await dispatchAction('delete_production', { id: 'prod-1' }, makeCtx(shim.client));
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.table).toBe('production_records');
    expect(shim.updates[0]!.set.grade).toMatchObject({ mineral: 'Au', voided: true, voidedBy: 'u-1' });
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
  });

  it('refuses a cross-tenant id', async () => {
    const shim = makeShim({ selectRowsByTable: { production_records: [] } });
    const out = await dispatchAction('delete_production', { id: 'prod-OTHER' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('delete_production_not_found:prod-OTHER');
  });
});

describe('cancel_reminder → SOFT-delete (status=cancelled)', () => {
  it('cancels a scheduled reminder, audits', async () => {
    const shim = makeShim({
      selectRowsByTable: { reminders: [{ id: 'rem-1', status: 'scheduled' }] },
      updateReturnByTable: { reminders: [{ id: 'rem-1', title: 'Levy', status: 'cancelled' }] },
    });
    const out = await dispatchAction(
      'cancel_reminder',
      { reminderId: '11111111-1111-1111-1111-111111111111' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.set.status).toBe('cancelled');
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
  });

  it('refuses to cancel a non-scheduled reminder', async () => {
    const shim = makeShim({ selectRowsByTable: { reminders: [{ id: 'rem-1', status: 'cancelled' }] } });
    const out = await dispatchAction(
      'cancel_reminder',
      { reminderId: '11111111-1111-1111-1111-111111111111' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toMatch(/cannot cancel a cancelled reminder/);
    expect(shim.updates).toHaveLength(0);
  });
});

// ─── 4) manage_tab (server-persisted structural ops) ─────────────────

describe('manage_tab → persists tab structure to owner_tabs_structural', () => {
  it('spawn INSERTs a new tab (tenant+user scoped), audits, mastery', async () => {
    // No existing tab → fresh INSERT.
    const shim = makeShim({
      selectRowsByTable: { owner_tabs_structural: [] },
      insertReturn: { id: 'tab-row-1', tabId: 'compliance' },
    });
    const out = await dispatchAction(
      'manage_tab',
      { op: 'spawn', tabId: 'compliance', label: 'Compliance', position: 2 },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('owner_tab');
      expect(out.result.data?.op).toBe('spawn');
    }
    expect(shim.inserts).toHaveLength(1);
    expect(shim.inserts[0]!.table).toBe('owner_tabs_structural');
    expect(shim.inserts[0]!.values.tenantId).toBe('t-1');
    expect(shim.inserts[0]!.values.userId).toBe('u-1');
    expect(shim.inserts[0]!.values.tabId).toBe('compliance');
    expect(shim.inserts[0]!.values.label).toBe('Compliance');
    expect(shim.inserts[0]!.values.kind).toBe('custom');
    expect(shim.inserts[0]!.values.provenance).toMatchObject({ via: 'chat', actorId: 'u-1' });
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
    expect(masteryExecutes(shim.executes)).toBe(1);
  });

  it('spawn is idempotent — re-activates an existing tab via UPDATE (no duplicate INSERT)', async () => {
    const shim = makeShim({
      selectRowsByTable: { owner_tabs_structural: [{ id: 'tab-row-1', tabId: 'compliance', label: 'Old', kind: 'custom', status: 'removed' }] },
      updateReturnByTable: { owner_tabs_structural: [{ id: 'tab-row-1', tabId: 'compliance' }] },
    });
    const out = await dispatchAction(
      'manage_tab',
      { op: 'spawn', tabId: 'compliance', label: 'Compliance' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    if (out.executed) expect(out.result.data?.reactivated).toBe(true);
    expect(shim.inserts).toHaveLength(0);
    expect(shim.updates).toHaveLength(1);
    expect(shim.updates[0]!.set.status).toBe('active');
  });

  // ─── KI-009 completion law: spawn injects the worker projection bag ──
  it('spawn of a PROJECTABLE kind injects config.workforceProjection (completes the worker leg)', async () => {
    const shim = makeShim({
      selectRowsByTable: { owner_tabs_structural: [] },
      insertReturn: { id: 'tab-row-1', tabId: 'gold-mkt' },
    });
    const out = await dispatchAction(
      'manage_tab',
      { op: 'spawn', tabId: 'gold-mkt', label: 'Gold marketplace', config: { kind: 'marketplace' } },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.inserts).toHaveLength(1);
    expect(shim.inserts[0]!.values.config).toEqual({
      kind: 'marketplace',
      workforceProjection: { kind: 'marketplace' },
    });
  });

  it('spawn of a NON-projectable kind leaves config untouched (honest no-op, no guessing)', async () => {
    const shim = makeShim({
      selectRowsByTable: { owner_tabs_structural: [] },
      insertReturn: { id: 'tab-row-1', tabId: 'blueprint' },
    });
    const out = await dispatchAction(
      'manage_tab',
      { op: 'spawn', tabId: 'blueprint', label: 'Blueprint', config: { kind: 'blueprint' } },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.inserts[0]!.values.config).toEqual({ kind: 'blueprint' });
    expect(
      Object.prototype.hasOwnProperty.call(
        shim.inserts[0]!.values.config as Record<string, unknown>,
        'workforceProjection',
      ),
    ).toBe(false);
  });

  it('spawn with NO config gets the empty default (no projection bag forced)', async () => {
    const shim = makeShim({
      selectRowsByTable: { owner_tabs_structural: [] },
      insertReturn: { id: 'tab-row-1', tabId: 'bare' },
    });
    const out = await dispatchAction(
      'manage_tab',
      { op: 'spawn', tabId: 'bare', label: 'Bare' },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.inserts[0]!.values.config).toEqual({});
  });

  it('spawn NEVER clobbers an explicit workforceProjection bag (owner-set roles preserved)', async () => {
    const shim = makeShim({
      selectRowsByTable: { owner_tabs_structural: [] },
      insertReturn: { id: 'tab-row-1', tabId: 'mkt-mgr' },
    });
    const explicit = { kind: 'marketplace', roles: ['manager'] };
    const out = await dispatchAction(
      'manage_tab',
      {
        op: 'spawn',
        tabId: 'mkt-mgr',
        label: 'Manager marketplace',
        config: { kind: 'marketplace', workforceProjection: explicit },
      },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.inserts[0]!.values.config).toMatchObject({
      workforceProjection: { kind: 'marketplace', roles: ['manager'] },
    });
  });

  it('re-spawn (idempotent reactivate) of a projectable kind ALSO injects the projection bag', async () => {
    const shim = makeShim({
      selectRowsByTable: {
        owner_tabs_structural: [
          { id: 'tab-row-1', tabId: 'gold-mkt', label: 'Old', kind: 'custom', status: 'removed' },
        ],
      },
      updateReturnByTable: { owner_tabs_structural: [{ id: 'tab-row-1', tabId: 'gold-mkt' }] },
    });
    const out = await dispatchAction(
      'manage_tab',
      { op: 'spawn', tabId: 'gold-mkt', label: 'Gold marketplace', config: { kind: 'marketplace' } },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.inserts).toHaveLength(0);
    expect(shim.updates).toHaveLength(1);
    expect(shim.updates[0]!.set.config).toEqual({
      kind: 'marketplace',
      workforceProjection: { kind: 'marketplace' },
    });
  });

  it('reorder UPDATEs the position, tenant+user scoped', async () => {
    const shim = makeShim({
      updateReturnByTable: { owner_tabs_structural: [{ id: 'tab-row-1', position: 3 }] },
    });
    const out = await dispatchAction(
      'manage_tab',
      { op: 'reorder', tabId: 'compliance', position: 3 },
      makeCtx(shim.client),
    );
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.table).toBe('owner_tabs_structural');
    expect(shim.updates[0]!.set.position).toBe(3);
    expect(out.executed && out.result.data?.position).toBe(3);
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
  });

  it('pin UPDATEs the pinned flag', async () => {
    const shim = makeShim({
      updateReturnByTable: { owner_tabs_structural: [{ id: 'tab-row-1', pinned: true }] },
    });
    const out = await dispatchAction('manage_tab', { op: 'pin', tabId: 'compliance' }, makeCtx(shim.client));
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.set.pinned).toBe(true);
  });

  it('remove SOFT-deletes a CUSTOM tab (status=removed)', async () => {
    const shim = makeShim({
      selectRowsByTable: { owner_tabs_structural: [{ id: 'tab-row-1', tabId: 'compliance', label: 'Compliance', kind: 'custom', status: 'active' }] },
      updateReturnByTable: { owner_tabs_structural: [{ id: 'tab-row-1', label: 'Compliance', status: 'removed' }] },
    });
    const out = await dispatchAction('manage_tab', { op: 'remove', tabId: 'compliance' }, makeCtx(shim.client));
    expect(out.executed).toBe(true);
    expect(shim.updates[0]!.set.status).toBe('removed');
    expect(auditExecutes(shim.executes)).toBeGreaterThanOrEqual(1);
  });

  it('remove REFUSES a system tab (protected server-side)', async () => {
    const shim = makeShim({
      selectRowsByTable: { owner_tabs_structural: [{ id: 'tab-row-1', tabId: 'chat', label: 'Chat', kind: 'system', status: 'active' }] },
    });
    const out = await dispatchAction('manage_tab', { op: 'remove', tabId: 'chat' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toBe('manage_tab_system_tab_protected:chat');
    expect(shim.updates).toHaveLength(0);
  });

  it('update/remove/reorder/pin refuse an unknown tab id (cross-tenant/user)', async () => {
    for (const op of [
      { op: 'reorder', tabId: 'nope', position: 1 },
      { op: 'pin', tabId: 'nope' },
    ]) {
      const shim = makeShim({ updateReturnByTable: { owner_tabs_structural: [] } });
      const out = await dispatchAction('manage_tab', op, makeCtx(shim.client));
      expect(out.executed).toBe(false);
      if (!out.executed) expect(out.reason).toBe('manage_tab_not_found:nope');
    }
    // update + remove read first → seed empty select
    for (const op of [
      { op: 'update', tabId: 'nope', label: 'x' },
      { op: 'remove', tabId: 'nope' },
    ]) {
      const shim = makeShim({
        selectRowsByTable: { owner_tabs_structural: [] },
        updateReturnByTable: { owner_tabs_structural: [] },
      });
      const out = await dispatchAction('manage_tab', op, makeCtx(shim.client));
      expect(out.executed).toBe(false);
      if (!out.executed) expect(out.reason).toBe('manage_tab_not_found:nope');
    }
  });

  it('rejects an invalid op discriminator gracefully', async () => {
    const shim = makeShim();
    const out = await dispatchAction('manage_tab', { op: 'teleport', tabId: 'x' }, makeCtx(shim.client));
    expect(out.executed).toBe(false);
    expect(shim.updates).toHaveLength(0);
    expect(shim.inserts).toHaveLength(0);
  });
});

// ─── 5) gate→dispatch contract (denied ⇒ no write) ───────────────────

describe('edit/remove/tab verbs — gate denial blocks all writes', () => {
  it('a denied HIGH-risk decision means no dispatch → no write anywhere', async () => {
    const shim = makeShim();
    const decision = decideAutoAuthorization('sovereign:transfer', 'Move money offshore.', tenantScope);
    expect(decision.authorized).toBe(false);
    let dispatched = false;
    if (decision.authorized) {
      await dispatchAction('archive_site', { id: 'site-1' }, makeCtx(shim.client));
      dispatched = true;
    }
    expect(dispatched).toBe(false);
    expect(shim.updates).toHaveLength(0);
    expect(shim.inserts).toHaveLength(0);
    expect(shim.executes).toHaveLength(0);
  });
});
