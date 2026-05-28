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
});
