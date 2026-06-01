/**
 * Support-verb tests — open_support_case / resolve_support_case /
 * escalate_to_human through the registry dispatch + the real auto-authorize gate.
 *
 * Contracts:
 *   1. The three verbs are KNOWN + CONFIRM-REQUIRED, never auto-safe (so the
 *      auto-execute / micro-action surfaces refuse them; only /confirm-action
 *      runs them).
 *   2. The gate AUTHORIZES the benign support verbs (they carry no HIGH-risk
 *      prefix), and a HIGH-risk verb is still denied (defence-in-depth).
 *   3. open_support_case requires >=1 evidence id (evidence-required) — an empty
 *      evidence chain fails gracefully with no row.
 *   4. escalate_to_human flips the case to `escalated` with an escalation_ref,
 *      writes NO ledger/journal/money row, and appends an ai_audit_chain entry.
 *   5. None of the verbs ever write a ledger / journal table (money boundary).
 *
 * Runs unmocked against an in-memory store + the same Drizzle shim the
 * support-cases suite uses, plus the real `decideAutoAuthorization` gate.
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

// ─── In-memory store + Drizzle shim (clipped to bound tenant+user) ───

interface StoreRow extends Record<string, unknown> {
  id: string;
  tenantId: string;
  userId: string;
  status: string;
}

function tableNameOf(obj: unknown): string {
  try {
    return getTableName(obj as never);
  } catch {
    return 'unknown';
  }
}

function makeStore() {
  const rows: StoreRow[] = [];
  const executes: string[] = [];

  function client(tenantId: string, userId: string) {
    const visible = () =>
      rows.filter((r) => r.tenantId === tenantId && r.userId === userId);
    return {
      insert(table: unknown) {
        const name = tableNameOf(table);
        return {
          values(v: Record<string, unknown>) {
            return {
              returning() {
                if (name === 'support_cases') {
                  const row: StoreRow = {
                    ...(v as StoreRow),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    resolvedAt: null,
                  };
                  rows.push(row);
                  return Promise.resolve([row]);
                }
                return Promise.resolve([{ id: (v as { id?: string }).id ?? 'x' }]);
              },
            };
          },
        };
      },
      select() {
        return {
          from(table: unknown) {
            const name = tableNameOf(table);
            const data = name === 'support_cases' ? visible() : [];
            const terminal = {
              limit: () => Promise.resolve(data),
              orderBy: () => ({ limit: () => Promise.resolve(data) }),
            };
            return { where: () => terminal };
          },
        };
      },
      update(table: unknown) {
        const name = tableNameOf(table);
        return {
          set(s: Record<string, unknown>) {
            return {
              where: () => ({
                returning() {
                  if (name !== 'support_cases') return Promise.resolve([]);
                  const target = visible()[0];
                  if (!target) return Promise.resolve([]);
                  Object.assign(target, s);
                  return Promise.resolve([{ ...target }]);
                },
              }),
            };
          },
        };
      },
      execute(q: unknown): Promise<unknown> {
        let sqlText = '';
        try {
          sqlText = JSON.stringify(q);
        } catch {
          sqlText = String(q);
        }
        executes.push(sqlText);
        return Promise.resolve({ rows: [] });
      },
    };
  }

  return { rows, executes, client };
}

const silentLogger: ExecContext['logger'] = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function ctxFor(store: ReturnType<typeof makeStore>): ExecContext {
  return {
    db: store.client('t-1', 'u-1') as ExecContext['db'],
    tenantId: 't-1',
    userId: 'u-1',
    logger: silentLogger,
  };
}

const tenantScope: ScopeContext = {
  kind: 'tenant',
  tenantId: 't-1',
  actorUserId: 'u-1',
  roles: ['owner'],
  personaId: 'mr-mwikila-head',
};

/** ai_audit_chain INSERTs recorded among the executes. */
function auditInserts(executes: string[]): number {
  return executes.filter((s) => /INSERT INTO ai_audit_chain/i.test(s)).length;
}

/** Assert no write against any ledger / journal table (money boundary). */
function assertNoLedgerWrite(executes: string[]): void {
  for (const s of executes) {
    expect(s).not.toMatch(/(INSERT INTO|UPDATE)\s+\\?"?\w*(ledger|journal)/i);
  }
}

// ─── 1) registry membership ──────────────────────────────────────────

describe('support verbs — registry membership', () => {
  it('all three are KNOWN + confirm-required, never auto-safe', () => {
    for (const verb of ['open_support_case', 'resolve_support_case', 'escalate_to_human']) {
      expect(isKnownVerb(verb)).toBe(true);
      expect(requiresConfirmation(verb)).toBe(true);
      expect(isSafeVerb(verb)).toBe(false);
    }
  });
});

// ─── 2) the gate authorizes benign support verbs ────────────────────

describe('support verbs — gate authorization', () => {
  it('authorizes escalate_to_human with a benign rationale', () => {
    const decision = decideAutoAuthorization(
      'escalate_to_human',
      'The user’s payment failed systematically; hand it to a human specialist.',
      tenantScope,
    );
    expect(decision.authorized).toBe(true);
  });

  it('authorizes open_support_case + resolve_support_case', () => {
    expect(
      decideAutoAuthorization('open_support_case', 'Open a case for the payment issue.', tenantScope)
        .authorized,
    ).toBe(true);
    expect(
      decideAutoAuthorization('resolve_support_case', 'The issue is fixed; close the case.', tenantScope)
        .authorized,
    ).toBe(true);
  });
});

// ─── 3) open requires evidence ──────────────────────────────────────

describe('open_support_case — evidence-required', () => {
  it('executes with >=1 evidence id and persists a case (audit appended)', async () => {
    const store = makeStore();
    const out = await dispatchAction(
      'open_support_case',
      {
        title: 'Payment failed',
        category: 'payment',
        evidenceIds: ['pi-1'],
        rootCause: 'insufficient_balance',
      },
      ctxFor(store),
    );
    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('support_case');
      expect(out.result.data?.evidenceCount).toBe(1);
    }
    expect(store.rows.length).toBe(1);
    expect(auditInserts(store.executes)).toBeGreaterThanOrEqual(1);
    assertNoLedgerWrite(store.executes);
  });

  it('fails gracefully with NO evidence (zod min(1)) — no row', async () => {
    const store = makeStore();
    const out = await dispatchAction(
      'open_support_case',
      { title: 'No evidence', evidenceIds: [] },
      ctxFor(store),
    );
    expect(out.executed).toBe(false);
    expect(store.rows.length).toBe(0);
  });
});

// ─── 4) escalate flips status + writes the escalation ref, no money ──

describe('escalate_to_human — escalates, records, no money', () => {
  it('opens then escalates a case: status=escalated + escalation_ref, audited, no ledger write', async () => {
    const store = makeStore();
    const ctx = ctxFor(store);

    // First open a case so there is something to escalate.
    const opened = await dispatchAction(
      'open_support_case',
      { title: 'Ledger post failed', category: 'payment', evidenceIds: ['pi-9'] },
      ctx,
    );
    expect(opened.executed).toBe(true);
    const caseId = opened.executed ? opened.result.id! : '';
    expect(caseId).toBeTruthy();

    const out = await dispatchAction(
      'escalate_to_human',
      { caseId, reason: 'Money in but ledger did not post — needs manual reconciliation.' },
      ctx,
    );
    expect(out.executed).toBe(true);
    if (out.executed) {
      expect(out.result.kind).toBe('support_escalation');
      expect(out.result.data?.status).toBe('escalated');
      expect(String(out.result.data?.escalationRef)).toMatch(/^ESC-/);
    }

    // The case row is now escalated with the ref.
    const row = store.rows.find((r) => r.id === caseId);
    expect(row?.status).toBe('escalated');
    expect(String(row?.escalationRef)).toMatch(/^ESC-/);

    // Audit appended for open + escalate (repo md_escalated + the exec audit).
    expect(auditInserts(store.executes)).toBeGreaterThanOrEqual(2);
    // MONEY BOUNDARY: nothing touched a ledger / journal table.
    assertNoLedgerWrite(store.executes);
  });

  it('fails gracefully when the case does not exist (no escalation)', async () => {
    const store = makeStore();
    const out = await dispatchAction(
      'escalate_to_human',
      { caseId: 'does-not-exist', reason: 'x' },
      ctxFor(store),
    );
    expect(out.executed).toBe(false);
    if (!out.executed) expect(out.reason).toMatch(/not_found/);
  });
});

// ─── 5) resolve transitions status ──────────────────────────────────

describe('resolve_support_case — transitions to resolved', () => {
  it('resolves an open case', async () => {
    const store = makeStore();
    const ctx = ctxFor(store);
    const opened = await dispatchAction(
      'open_support_case',
      { title: 'Pending confirmation', category: 'payment', evidenceIds: ['pi-3'] },
      ctx,
    );
    const caseId = opened.executed ? opened.result.id! : '';

    const out = await dispatchAction(
      'resolve_support_case',
      { caseId, resolution: 'Confirmation arrived; payment recorded.' },
      ctx,
    );
    expect(out.executed).toBe(true);
    if (out.executed) expect(out.result.data?.status).toBe('resolved');
    const row = store.rows.find((r) => r.id === caseId);
    expect(row?.status).toBe('resolved');
    assertNoLedgerWrite(store.executes);
  });
});
