/**
 * Payment-inspector unit tests — Mr. Mwikila root-causes a payment error.
 *
 * Covers the wave-required contracts:
 *   1. A FAILED payment_intent (insufficient-balance) is root-caused WITH
 *      evidence → the intent id is in evidenceIds, suggestedResolution is
 *      guide_user. (The support-cases test then proves a case is opened from it.)
 *   2. A diagnosis is NEVER returned with an empty evidence chain
 *      (evidence-required) — assertEvidence throws on an empty chain, and the
 *      inspector returns `null` when there is no payment activity / no proof.
 *   3. The other common cases classify correctly: webhook-retry-pending →
 *      auto_safe_fix; gateway-degraded → guide_user; ledger-post-failed →
 *      escalate; dead-letter → escalate.
 *   4. EN AND SW explanations are both present on every diagnosis (absolute
 *      toggle — the surface renders one, but both are stored).
 *
 * The inspector runs unmocked against a hand-rolled `db.execute(sql\`…\`)` shim
 * that returns seeded rows per matching SQL fragment, so we assert the exact
 * root cause + evidence the real SELECTs would produce.
 */

import { describe, it, expect } from 'vitest';

import {
  runDiagnosis,
  assertEvidence,
  type InspectorDb,
} from '../payment-inspector.js';

// ─── db.execute shim ─────────────────────────────────────────────────
//
// Each rule's `match` substring is tested against the serialized SQL text
// (Drizzle's `sql` template stringifies its literal fragments); the FIRST
// matching rule's rows are returned. Non-matching executes return `{ rows: [] }`.

function makeDb(
  rules: Array<{ match: string; rows: Array<Record<string, unknown>> }>,
): InspectorDb {
  return {
    execute(q: unknown): Promise<unknown> {
      let sqlText = '';
      try {
        sqlText = JSON.stringify(q);
      } catch {
        sqlText = String(q);
      }
      for (const rule of rules) {
        if (sqlText.includes(rule.match)) return Promise.resolve({ rows: rule.rows });
      }
      return Promise.resolve({ rows: [] });
    },
  };
}

const TENANT = 't-1';
const USER = 'u-1';

function inspect(db: InspectorDb, gatewayStatus?: 'healthy' | 'degraded' | 'down') {
  return runDiagnosis({
    db,
    tenantId: TENANT,
    userId: USER,
    sinceMs: 7 * 24 * 60 * 60 * 1000,
    ...(gatewayStatus ? { gatewayStatus } : {}),
  });
}

// ─── 1) FAILED intent (insufficient balance) → root-caused with evidence ─

describe('runDiagnosis — FAILED intent root-caused WITH evidence', () => {
  it('insufficient-balance → guide_user, intent id in evidence, EN+SW present', async () => {
    const db = makeDb([
      {
        match: 'FROM payment_intents',
        rows: [
          { id: 'pi-failed-1', status: 'FAILED', failure_reason: 'insufficient-balance' },
        ],
      },
    ]);

    const diag = await inspect(db);
    expect(diag).not.toBeNull();
    if (!diag) return;

    expect(diag.rootCause).toBe('insufficient_balance');
    expect(diag.suggestedResolution).toBe('guide_user');
    expect(diag.severity).toBe('low');
    // EVIDENCE-REQUIRED: the failed intent id proves the diagnosis.
    expect(diag.evidenceIds).toContain('pi-failed-1');
    expect(diag.evidenceIds.length).toBeGreaterThanOrEqual(1);
    // Absolute toggle: BOTH languages are stored (the surface renders one).
    expect(diag.humanExplanationEn.length).toBeGreaterThan(0);
    expect(diag.humanExplanationSw.length).toBeGreaterThan(0);
    expect(diag.humanExplanationEn).not.toBe(diag.humanExplanationSw);
    // assertEvidence accepts it (non-empty chain).
    expect(() => assertEvidence(diag)).not.toThrow();
  });

  it('cancelled-by-user → guide_user (user-side)', async () => {
    const db = makeDb([
      {
        match: 'FROM payment_intents',
        rows: [{ id: 'pi-cancel', status: 'CANCELLED', failure_reason: 'cancelled-by-user' }],
      },
    ]);
    const diag = await inspect(db);
    expect(diag?.rootCause).toBe('user_cancelled');
    expect(diag?.suggestedResolution).toBe('guide_user');
    expect(diag?.evidenceIds).toContain('pi-cancel');
  });

  it('merges a PAYMENT audit_event id into the evidence chain when present', async () => {
    const db = makeDb([
      {
        match: 'FROM payment_intents',
        rows: [{ id: 'pi-x', status: 'FAILED', failure_reason: 'insufficient-balance' }],
      },
      { match: 'FROM audit_events', rows: [{ id: 'audit-9' }] },
    ]);
    const diag = await inspect(db);
    expect(diag?.evidenceIds).toContain('pi-x');
    expect(diag?.evidenceIds).toContain('audit-9');
  });
});

// ─── 2) Evidence-required: no proof → null; empty chain → throws ─────

describe('runDiagnosis — evidence-required invariant', () => {
  it('returns null when there is NO payment activity and no audit failure', async () => {
    const db = makeDb([]); // every SELECT returns []
    const diag = await inspect(db);
    expect(diag).toBeNull();
  });

  it('assertEvidence throws on a hand-built empty-evidence diagnosis', () => {
    const empty = {
      rootCause: 'unclassified_failure' as const,
      title: 'x',
      humanExplanationEn: 'x',
      humanExplanationSw: 'x',
      evidenceIds: [] as string[],
      severity: 'medium' as const,
      suggestedResolution: 'escalate' as const,
    };
    expect(() => assertEvidence(empty)).toThrow(/evidence/i);
  });

  it('an audit-only failure (no intent) still yields evidence (the audit id)', async () => {
    const db = makeDb([{ match: 'FROM audit_events', rows: [{ id: 'audit-only-1' }] }]);
    const diag = await inspect(db);
    expect(diag).not.toBeNull();
    expect(diag?.rootCause).toBe('unclassified_failure');
    expect(diag?.evidenceIds).toEqual(['audit-only-1']);
  });
});

// ─── 3) The other common cases classify correctly ───────────────────

describe('runDiagnosis — classifies the common payment cases', () => {
  it('PENDING intent, confirmation still arriving → webhook_retry_pending / auto_safe_fix', async () => {
    const db = makeDb([
      {
        match: 'FROM payment_intents',
        rows: [{ id: 'pi-pending', status: 'PENDING', failure_reason: null }],
      },
    ]);
    const diag = await inspect(db);
    expect(diag?.rootCause).toBe('webhook_retry_pending');
    expect(diag?.suggestedResolution).toBe('auto_safe_fix');
    expect(diag?.evidenceIds).toContain('pi-pending');
  });

  it('PENDING intent + gateway degraded → gateway_degraded / guide_user', async () => {
    const db = makeDb([
      {
        match: 'FROM payment_intents',
        rows: [{ id: 'pi-pending-2', status: 'PROCESSING', failure_reason: null }],
      },
    ]);
    const diag = await inspect(db, 'degraded');
    expect(diag?.rootCause).toBe('gateway_degraded');
    expect(diag?.suggestedResolution).toBe('guide_user');
  });

  it('SUCCEEDED intent but ledger did NOT post → ledger_post_failed / escalate (critical)', async () => {
    const db = makeDb([
      {
        match: 'FROM payment_intents',
        rows: [{ id: 'pi-succ', status: 'SUCCEEDED', failure_reason: null }],
      },
      // journal_idempotency SELECT returns [] → ledger NOT posted.
    ]);
    const diag = await inspect(db);
    expect(diag?.rootCause).toBe('ledger_post_failed');
    expect(diag?.suggestedResolution).toBe('escalate');
    expect(diag?.severity).toBe('critical');
    expect(diag?.evidenceIds).toContain('pi-succ');
  });

  it('SUCCEEDED intent AND ledger posted → payment_succeeded / reassure', async () => {
    const db = makeDb([
      {
        match: 'FROM payment_intents',
        rows: [{ id: 'pi-ok', status: 'SUCCEEDED', failure_reason: null }],
      },
      { match: 'FROM journal_idempotency', rows: [{ '?column?': 1 }] },
    ]);
    const diag = await inspect(db);
    expect(diag?.rootCause).toBe('payment_succeeded');
    expect(diag?.evidenceIds).toEqual(['pi-ok']);
  });

  it('FAILED intent with no user reason + a dead-lettered webhook → escalate', async () => {
    const db = makeDb([
      {
        match: 'FROM payment_intents',
        rows: [{ id: 'pi-dl', status: 'FAILED', failure_reason: 'system-error-push' }],
      },
      { match: 'FROM webhook_dead_letters', rows: [{ id: 'dlq-7' }] },
    ]);
    const diag = await inspect(db);
    expect(diag?.rootCause).toBe('webhook_dead_lettered');
    expect(diag?.suggestedResolution).toBe('escalate');
    expect(diag?.evidenceIds).toContain('pi-dl');
    expect(diag?.evidenceIds).toContain('dlq-7');
  });
});
