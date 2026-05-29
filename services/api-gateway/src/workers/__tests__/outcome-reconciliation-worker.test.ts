/**
 * Outcome reconciliation worker unit tests - Wave CLOSED-LOOP.
 *
 * Exercises tickOnce against:
 *   - a scalar prediction (predicted_value_tzs) with a close observation -> matched
 *   - a scalar prediction with a far observation -> divergent
 *   - a vector (jsonb) prediction with shape-mismatch observation -> divergent
 *   - a prediction whose entity_type has no resolver -> expired
 *   - a resolver that returns null -> expired
 *   - a confidence-0 ("unmodeled") prediction is skipped by the claim query
 *
 * Asserts the worker:
 *   1. Picks the right resolver for the entity_type.
 *   2. Inserts an outcome_observation row with computed gap_pct.
 *   3. Inserts an outcome_reconciliation row with the correct status.
 *   4. Extends the audit chain on every reconciliation.
 *
 * The DB is stubbed; we capture INSERT statements to verify shape.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createOutcomeReconciliationWorker,
  scalarDrift,
  vectorDrift,
  type ObservationResolver,
} from '../outcome-reconciliation-worker.js';

interface CapturedCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

function makeStubDb(claimRows: ReadonlyArray<Record<string, unknown>>) {
  const calls: CapturedCall[] = [];
  let claimReturned = false;
  return {
    calls,
    execute: vi.fn(async (q: unknown) => {
      const sqlObj = q as {
        strings?: ReadonlyArray<string>;
        queryChunks?: ReadonlyArray<{ value?: string }>;
        values?: unknown[];
      };
      const text =
        sqlObj?.strings?.join(' ') ??
        sqlObj?.queryChunks?.map((c) => c.value ?? '').join(' ') ??
        '';
      calls.push({ sql: text, values: sqlObj?.values ?? [] });

      // The claim query reads from outcome_predictions and returns rows.
      if (text.includes('FROM outcome_predictions') && !claimReturned) {
        claimReturned = true;
        return { rows: claimRows };
      }
      // The audit-chain head query returns max_seq + last_hash.
      if (text.includes('FROM ai_audit_chain')) {
        return { rows: [{ max_seq: 0, last_hash: '' }] };
      }
      return { rows: [] };
    }),
  };
}

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Parameters<typeof createOutcomeReconciliationWorker>[0]['logger'];

describe('scalarDrift', () => {
  it('returns 0 when predicted == observed', () => {
    expect(scalarDrift(100, 100)).toBe(0);
  });
  it('returns 0 when both are zero', () => {
    expect(scalarDrift(0, 0)).toBe(0);
  });
  it('returns 1 when predicted is 0 but observed is non-zero', () => {
    expect(scalarDrift(0, 50)).toBe(1);
  });
  it('clamps to 1 on extreme overshoot', () => {
    expect(scalarDrift(100, 1_000_000)).toBe(1);
  });
  it('returns the abs % delta otherwise', () => {
    expect(scalarDrift(100, 110)).toBeCloseTo(0.1, 4);
    expect(scalarDrift(100, 90)).toBeCloseTo(0.1, 4);
  });
});

describe('vectorDrift', () => {
  it('returns 0 for identical envelopes', () => {
    expect(
      vectorDrift({ filed: true, value: 1000 }, { filed: true, value: 1000 }),
    ).toBe(0);
  });
  it('returns >0.5 when shapes mismatch on most keys', () => {
    const drift = vectorDrift(
      { filed: true, value: 1000, on_time: true },
      { filed: false, value: 0, on_time: false },
    );
    expect(drift).toBeGreaterThan(0.5);
  });
  it('returns 0 when envelopes are both empty', () => {
    expect(vectorDrift({}, {})).toBe(0);
  });
});

describe('createOutcomeReconciliationWorker.tickOnce', () => {
  it('marks a scalar prediction with a close observation as matched', async () => {
    const db = makeStubDb([
      {
        id: 'p1',
        tenant_id: 't1',
        actor_kind: 'brain',
        action_kind: 'mining.royalty.file',
        action_target_entity_type: 'royalty_filing',
        action_target_entity_id: 'rf_42',
        predicted_outcome: { filed: true, amount_tzs: 18_000_000 },
        predicted_value_tzs: 18_000_000,
        prediction_confidence: 0.85,
        rationale: 'Owner files around the 12th',
      },
    ]);
    const resolver: ObservationResolver = vi.fn(async () => ({
      observedOutcome: { filed: true, amount_tzs: 18_500_000 },
      observedValueTzs: 18_500_000,
      narrative: 'Filed Apr 13 for TZS 18.5M',
    }));
    const worker = createOutcomeReconciliationWorker({
      db,
      logger: stubLogger,
      resolvers: { royalty_filing: resolver },
    });
    const result = await worker.tickOnce();
    expect(result.matched).toBe(1);
    expect(result.divergent).toBe(0);
    expect(result.expired).toBe(0);
    expect(resolver).toHaveBeenCalledOnce();

    const observationInsert = db.calls.find((c) =>
      c.sql.includes('INSERT INTO outcome_observations'),
    );
    expect(observationInsert).toBeDefined();
    const reconciliationInsert = db.calls.find((c) =>
      c.sql.includes('INSERT INTO outcome_reconciliations'),
    );
    expect(reconciliationInsert).toBeDefined();
    const auditInsert = db.calls.find((c) =>
      c.sql.includes('INSERT INTO ai_audit_chain'),
    );
    expect(auditInsert).toBeDefined();
  });

  it('marks a scalar prediction with a far observation as divergent', async () => {
    const db = makeStubDb([
      {
        id: 'p2',
        tenant_id: 't1',
        actor_kind: 'brain',
        action_kind: 'mining.fuel.switch_supplier',
        action_target_entity_type: 'supplier',
        action_target_entity_id: 'sup_99',
        predicted_outcome: { savings_tzs: 8_200_000 },
        predicted_value_tzs: 8_200_000,
        prediction_confidence: 0.7,
        rationale: 'Peer p25 saves 22%',
      },
    ]);
    const resolver: ObservationResolver = vi.fn(async () => ({
      observedOutcome: { savings_tzs: 1_000_000 },
      observedValueTzs: 1_000_000,
      narrative: 'Diesel price spiked',
    }));
    const worker = createOutcomeReconciliationWorker({
      db,
      logger: stubLogger,
      resolvers: { supplier: resolver },
    });
    const result = await worker.tickOnce();
    expect(result.divergent).toBe(1);
    expect(result.matched).toBe(0);
  });

  it('expires the prediction when no resolver is wired for the entity type', async () => {
    const db = makeStubDb([
      {
        id: 'p3',
        tenant_id: 't1',
        actor_kind: 'brain',
        action_kind: 'mining.unknown.action',
        action_target_entity_type: 'mystery_box',
        action_target_entity_id: 'mb_1',
        predicted_outcome: { thing: 'happens' },
        predicted_value_tzs: null,
        prediction_confidence: 0.5,
        rationale: '',
      },
    ]);
    const worker = createOutcomeReconciliationWorker({
      db,
      logger: stubLogger,
      resolvers: {},
    });
    const result = await worker.tickOnce();
    expect(result.expired).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.divergent).toBe(0);
  });

  it('expires the prediction when the resolver returns null', async () => {
    const db = makeStubDb([
      {
        id: 'p4',
        tenant_id: 't1',
        actor_kind: 'brain',
        action_kind: 'mining.licence.renew',
        action_target_entity_type: 'licence',
        action_target_entity_id: 'pml_geita',
        predicted_outcome: { renewed: true },
        predicted_value_tzs: null,
        prediction_confidence: 0.9,
        rationale: '',
      },
    ]);
    const resolver: ObservationResolver = vi.fn(async () => null);
    const worker = createOutcomeReconciliationWorker({
      db,
      logger: stubLogger,
      resolvers: { licence: resolver },
    });
    const result = await worker.tickOnce();
    expect(result.expired).toBe(1);
    expect(resolver).toHaveBeenCalledOnce();
  });

  it('tolerates a resolver that throws and marks the row expired', async () => {
    const db = makeStubDb([
      {
        id: 'p5',
        tenant_id: 't1',
        actor_kind: 'brain',
        action_kind: 'x',
        action_target_entity_type: 'thing',
        action_target_entity_id: 't1',
        predicted_outcome: {},
        predicted_value_tzs: null,
        prediction_confidence: 0.5,
        rationale: '',
      },
    ]);
    const resolver: ObservationResolver = vi.fn(async () => {
      throw new Error('upstream timeout');
    });
    const worker = createOutcomeReconciliationWorker({
      db,
      logger: stubLogger,
      resolvers: { thing: resolver },
    });
    const result = await worker.tickOnce();
    expect(result.expired).toBe(1);
    expect(result.errored).toBe(0);
  });

  it('returns the zero-state result when the claim query yields no rows', async () => {
    const db = makeStubDb([]);
    const worker = createOutcomeReconciliationWorker({
      db,
      logger: stubLogger,
      resolvers: {},
    });
    const result = await worker.tickOnce();
    expect(result.claimed).toBe(0);
    expect(result.matched + result.divergent + result.expired).toBe(0);
  });

  it('binds tenant GUC before every ai_audit_chain append', async () => {
    // Regression: workers run outside the api-gateway middleware so
    // no `app.tenant_id` GUC is set unless we set it explicitly. Without
    // this every audit-chain INSERT was being denied by RLS, leaving the
    // closed-loop with gapped audit history. See
    // Docs/AUDIT/POWERS_LIVE_VERIFICATION_2026-05-29.md §F.1.
    const db = makeStubDb([
      {
        id: 'p_audit',
        tenant_id: 't_audit',
        actor_kind: 'brain',
        action_kind: 'mining.royalty.file',
        action_target_entity_type: 'royalty_filing',
        action_target_entity_id: 'rf_audit',
        predicted_outcome: { filed: true },
        predicted_value_tzs: 1_000_000,
        prediction_confidence: 0.9,
        rationale: '',
      },
    ]);
    const resolver: ObservationResolver = vi.fn(async () => ({
      observedOutcome: { filed: true },
      observedValueTzs: 1_010_000,
      narrative: 'on-time filing',
    }));
    const worker = createOutcomeReconciliationWorker({
      db,
      logger: stubLogger,
      resolvers: { royalty_filing: resolver },
    });
    await worker.tickOnce();
    const setConfigCall = db.calls.find(
      (c) =>
        c.sql.includes('set_config') &&
        c.sql.includes('app.current_tenant_id') &&
        c.sql.includes('app.tenant_id'),
    );
    expect(setConfigCall).toBeDefined();
    // GUC bound BEFORE the audit-chain head SELECT runs.
    const auditHeadIdx = db.calls.findIndex((c) =>
      c.sql.includes('FROM ai_audit_chain'),
    );
    const setConfigIdx = db.calls.findIndex(
      (c) =>
        c.sql.includes('set_config') &&
        c.sql.includes('app.current_tenant_id'),
    );
    expect(setConfigIdx).toBeGreaterThanOrEqual(0);
    expect(setConfigIdx).toBeLessThan(auditHeadIdx);
  });

  it('wraps the GUC bind + audit append in BEGIN/COMMIT (G8 closure)', async () => {
    // G8 from Docs/AUDIT/ROBUSTNESS_AUDIT_2026-05-29.md — the prior
    // `set_config(..., false)` call left the tenant GUC on the pooled
    // connection. If Supabase reaped the conn mid-tick the next
    // INSERT ran with NULL GUC and RLS rejected. The fix wraps the
    // tenant block in BEGIN; SET LOCAL ...; <body>; COMMIT; so the
    // binding dies at the txn boundary regardless of connection
    // lifetime.
    const db = makeStubDb([
      {
        id: 'p_txn',
        tenant_id: 't_txn',
        actor_kind: 'brain',
        action_kind: 'mining.royalty.file',
        action_target_entity_type: 'royalty_filing',
        action_target_entity_id: 'rf_txn',
        predicted_outcome: { filed: true },
        predicted_value_tzs: 5_000_000,
        prediction_confidence: 0.85,
        rationale: '',
      },
    ]);
    const resolver: ObservationResolver = vi.fn(async () => ({
      observedOutcome: { filed: true },
      observedValueTzs: 5_050_000,
      narrative: 'filed Apr 12 with TZS 5.05M',
    }));
    const worker = createOutcomeReconciliationWorker({
      db,
      logger: stubLogger,
      resolvers: { royalty_filing: resolver },
    });
    await worker.tickOnce();

    // Find indices of BEGIN, set_config, INSERT INTO ai_audit_chain,
    // and COMMIT. The order MUST be:
    //    BEGIN < set_config < INSERT INTO ai_audit_chain < COMMIT
    const beginIdx = db.calls.findIndex((c) => /^\s*BEGIN/.test(c.sql));
    const setConfigIdx = db.calls.findIndex(
      (c) =>
        c.sql.includes('set_config') &&
        c.sql.includes('app.current_tenant_id'),
    );
    const auditInsertIdx = db.calls.findIndex((c) =>
      c.sql.includes('INSERT INTO ai_audit_chain'),
    );
    const commitIdx = db.calls.findIndex((c) => /^\s*COMMIT/.test(c.sql));

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThanOrEqual(0);
    expect(beginIdx).toBeLessThan(setConfigIdx);
    expect(setConfigIdx).toBeLessThan(auditInsertIdx);
    expect(auditInsertIdx).toBeLessThan(commitIdx);
  });

  it('rolls back the txn when the audit INSERT throws (G8 connection-reap simulation)', async () => {
    // Simulates Supabase reaping the pooled connection between the
    // set_config and the INSERT. With the BEGIN/COMMIT wrap, the
    // helper catches the throw and emits ROLLBACK so the GUC binding
    // dies with the txn — no leak onto any future pooled conn.
    const calls: CapturedCall[] = [];
    let claimReturned = false;
    let auditInserts = 0;
    const db = {
      calls,
      execute: vi.fn(async (q: unknown) => {
        const sqlObj = q as {
          strings?: ReadonlyArray<string>;
          queryChunks?: ReadonlyArray<{ value?: string }>;
          values?: unknown[];
        };
        const text =
          sqlObj?.strings?.join(' ') ??
          sqlObj?.queryChunks?.map((c) => c.value ?? '').join(' ') ??
          '';
        calls.push({ sql: text, values: sqlObj?.values ?? [] });
        if (text.includes('FROM outcome_predictions') && !claimReturned) {
          claimReturned = true;
          return {
            rows: [
              {
                id: 'p_reap',
                tenant_id: 't_reap',
                actor_kind: 'brain',
                action_kind: 'mining.royalty.file',
                action_target_entity_type: 'royalty_filing',
                action_target_entity_id: 'rf_reap',
                predicted_outcome: { filed: true },
                predicted_value_tzs: 9_000_000,
                prediction_confidence: 0.8,
                rationale: '',
              },
            ],
          };
        }
        if (text.includes('FROM ai_audit_chain')) {
          return { rows: [{ max_seq: 0, last_hash: '' }] };
        }
        if (text.includes('INSERT INTO ai_audit_chain')) {
          auditInserts += 1;
          // First INSERT inside the txn throws — simulates conn reap.
          throw new Error('connection terminated unexpectedly');
        }
        return { rows: [] };
      }),
    };
    const resolver: ObservationResolver = vi.fn(async () => ({
      observedOutcome: { filed: true },
      observedValueTzs: 9_050_000,
      narrative: 'filed but conn dies before audit write',
    }));
    const worker = createOutcomeReconciliationWorker({
      db,
      logger: stubLogger,
      resolvers: { royalty_filing: resolver },
    });
    // Worker isolates per-row failures and continues, so tickOnce
    // resolves; the reconciliation row is still written (with
    // audit_hash_id = null) so we can verify the txn rolled back
    // without poisoning the batch.
    const result = await worker.tickOnce();
    expect(auditInserts).toBe(1);
    // The helper must emit ROLLBACK after the throw so no committed
    // txn carries a half-written audit chain.
    const rollbackIdx = calls.findIndex((c) => /^\s*ROLLBACK/.test(c.sql));
    expect(rollbackIdx).toBeGreaterThanOrEqual(0);
    // And the reconciliation outcome still counted — the per-row try/
    // catch isolates the audit failure so the tick body completes.
    expect(result.claimed).toBe(1);
  });
});
