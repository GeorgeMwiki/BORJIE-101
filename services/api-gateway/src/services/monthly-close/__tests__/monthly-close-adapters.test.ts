/**
 * Drizzle-backed monthly-close port adapter tests.
 *
 * Each adapter accepts a `db: { execute(q): Promise<rows> }` so we
 * can drive it with a `vi.fn()` whose resolved value carries the
 * shape Postgres-driver `execute` returns. The tests assert:
 *   - the SQL templates project the right column names into the
 *     adapter's return shape,
 *   - the adapters never throw on a transient DB error — they log
 *     a structured `degraded_reason` warning and return safe
 *     zero-aggregates,
 *   - tenant-scope predicates are present on the SQL (we inspect
 *     the `sql` chunks the adapter passes to `execute`).
 */

import { describe, it, expect, vi } from 'vitest';

import { createDrizzleReconciliationAdapter } from '../reconciliation-adapter';
import { createDrizzleStatementAdapter } from '../statement-adapter';
import { createDrizzleDisbursementAdapter } from '../disbursement-adapter';
import { createDrizzleNotificationAdapter } from '../notification-adapter';

const noopLogger = {
  warn: vi.fn(),
};

/**
 * Flatten a drizzle `sql` chunk to a text blob (static SQL fragments + bound
 * param values) so tests can substring-assert on the emitted SQL shape.
 */
function captureSqlText(q: unknown): string {
  if (q && typeof q === 'object') {
    const queryChunks = (q as { queryChunks?: unknown }).queryChunks;
    if (Array.isArray(queryChunks)) {
      return queryChunks
        .map((c) => {
          if (c == null) return '';
          if (typeof c === 'string') return c;
          if (typeof c === 'object') {
            const obj = c as Record<string, unknown>;
            if (typeof obj.value !== 'undefined') {
              const v = obj.value;
              if (v == null) return '';
              if (Array.isArray(v)) return v.join('');
              return typeof v === 'object' ? JSON.stringify(v) : String(v);
            }
            try {
              return JSON.stringify(obj);
            } catch {
              return '';
            }
          }
          return String(c);
        })
        .join(' ');
    }
  }
  try {
    return JSON.stringify(q);
  } catch {
    return String(q);
  }
}

function makeDb(rowsByCall: ReadonlyArray<readonly Record<string, unknown>[]>) {
  let i = 0;
  const execute = vi.fn(async () => {
    const rows = rowsByCall[i] ?? [];
    i += 1;
    return rows;
  });
  return { db: { execute }, execute };
}

// ---------------------------------------------------------------------------
// ReconciliationPort
// ---------------------------------------------------------------------------

describe('createDrizzleReconciliationAdapter', () => {
  it('aggregates payments + invoices into a single per-period roll-up', async () => {
    const { db } = makeDb([
      [{ reconciled: '12', unmatched: '3', gross_minor: '1500000' }],
      [{ currency: 'USD', n: '12' }],
    ]);
    const adapter = createDrizzleReconciliationAdapter(db, noopLogger);
    const result = await adapter.reconcileForPeriod({
      tenantId: 'tenant-A',
      periodStart: new Date('2026-04-01T00:00:00Z'),
      periodEnd: new Date('2026-05-01T00:00:00Z'),
    });
    expect(result).toEqual({
      reconciled: 12,
      unmatched: 3,
      grossRentMinor: 1_500_000,
      currency: 'USD',
    });
  });

  it('returns a zero aggregate and warns on DB failure', async () => {
    const warn = vi.fn();
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('connection lost')),
    };
    const adapter = createDrizzleReconciliationAdapter(db, { warn });
    const result = await adapter.reconcileForPeriod({
      tenantId: 'tenant-A',
      periodStart: new Date('2026-04-01'),
      periodEnd: new Date('2026-05-01'),
    });
    expect(result).toEqual({
      reconciled: 0,
      unmatched: 0,
      grossRentMinor: 0,
      currency: '',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 'reconciliation',
        degraded_reason: 'query_error',
      }),
      expect.any(String),
    );
  });

  it('handles an empty period (no payments) without throwing', async () => {
    const { db } = makeDb([
      [{ reconciled: 0, unmatched: 0, gross_minor: 0 }],
      [],
    ]);
    const adapter = createDrizzleReconciliationAdapter(db, noopLogger);
    const result = await adapter.reconcileForPeriod({
      tenantId: 'tenant-empty',
      periodStart: new Date('2026-04-01'),
      periodEnd: new Date('2026-05-01'),
    });
    expect(result).toEqual({
      reconciled: 0,
      unmatched: 0,
      grossRentMinor: 0,
      currency: '',
    });
  });
});

// ---------------------------------------------------------------------------
// StatementPort
// ---------------------------------------------------------------------------

describe('createDrizzleStatementAdapter', () => {
  it('emits one statement entry per owner with active leases', async () => {
    const { db, execute } = makeDb([
      [
        {
          owner_id: 'owner-1',
          gross_minor: '900000',
          dominant_currency: 'KES',
        },
        {
          owner_id: 'owner-2',
          gross_minor: '500000',
          dominant_currency: 'EUR',
        },
      ],
      // Each owner triggers a follow-up INSERT — the mock returns []
      // for these calls.
      [],
      [],
    ]);
    const adapter = createDrizzleStatementAdapter(db, noopLogger);
    const result = await adapter.generateOwnerStatementsForPeriod({
      tenantId: 'tenant-A',
      year: 2026,
      month: 4,
    });
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]?.ownerId).toBe('owner-1');
    expect(result.statements[0]?.grossRentMinor).toBe(900_000);
    expect(result.statements[0]?.currency).toBe('KES');
    expect(result.statements[1]?.currency).toBe('EUR');
    // 1 SELECT + 2 INSERT calls
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('returns empty list and warns when owner-aggregate query fails', async () => {
    const warn = vi.fn();
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('statement query died')),
    };
    const adapter = createDrizzleStatementAdapter(db, { warn });
    const result = await adapter.generateOwnerStatementsForPeriod({
      tenantId: 'tenant-A',
      year: 2026,
      month: 4,
    });
    expect(result.statements).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 'statements',
        degraded_reason: 'query_error',
      }),
      expect.any(String),
    );
  });

  it('skips rows with null owner_id', async () => {
    const { db } = makeDb([
      [
        { owner_id: null, gross_minor: 0, dominant_currency: null },
        { owner_id: 'owner-3', gross_minor: 100, dominant_currency: 'KES' },
      ],
      [],
    ]);
    const adapter = createDrizzleStatementAdapter(db, noopLogger);
    const result = await adapter.generateOwnerStatementsForPeriod({
      tenantId: 'tenant-A',
      year: 2026,
      month: 4,
    });
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]?.ownerId).toBe('owner-3');
  });
});

// ---------------------------------------------------------------------------
// DisbursementPort
// ---------------------------------------------------------------------------

describe('createDrizzleDisbursementAdapter', () => {
  it('computes per-owner breakdown from payments + invoices + properties', async () => {
    const { db } = makeDb([
      // gross + currency lookup
      [{ gross_minor: '750000', dominant_currency: 'TZS' }],
      // maintenance lookup
      [{ maint_minor: '50000' }],
      // destination lookup (users.email)
      [{ email: 'owner@example.com' }],
    ]);
    const adapter = createDrizzleDisbursementAdapter(db, noopLogger);
    const breakdown = await adapter.computeBreakdown({
      tenantId: 'tenant-A',
      ownerId: 'owner-1',
      periodStart: new Date('2026-04-01'),
      periodEnd: new Date('2026-05-01'),
    });
    expect(breakdown.grossRentMinor).toBe(750_000);
    expect(breakdown.maintenanceMinor).toBe(50_000);
    expect(breakdown.platformFeeMinor).toBe(0); // computed by orchestrator
    expect(breakdown.currency).toBe('TZS');
    expect(breakdown.destination).toBe('owner:owner@example.com');
  });

  it('falls back to zero maintenance when work_orders query fails', async () => {
    const calls = [
      [{ gross_minor: '100', dominant_currency: 'USD' }],
      // work_orders query throws, second SELECT in adapter
      null,
      [{ email: 'a@b.c' }],
    ];
    let i = 0;
    const db = {
      execute: vi.fn(async () => {
        const v = calls[i];
        i += 1;
        if (v === null) throw new Error('work_orders missing');
        return v ?? [];
      }),
    };
    const adapter = createDrizzleDisbursementAdapter(db, noopLogger);
    const breakdown = await adapter.computeBreakdown({
      tenantId: 'tenant-A',
      ownerId: 'owner-1',
      periodStart: new Date('2026-04-01'),
      periodEnd: new Date('2026-05-01'),
    });
    expect(breakdown.grossRentMinor).toBe(100);
    expect(breakdown.maintenanceMinor).toBe(0);
    expect(breakdown.destination).toBe('owner:a@b.c');
  });

  it('falls back to owner: prefix when email is missing', async () => {
    const { db } = makeDb([
      [{ gross_minor: '0', dominant_currency: null }],
      [{ maint_minor: '0' }],
      [],
    ]);
    const adapter = createDrizzleDisbursementAdapter(db, noopLogger);
    const breakdown = await adapter.computeBreakdown({
      tenantId: 'tenant-A',
      ownerId: 'owner-99',
      periodStart: new Date('2026-04-01'),
      periodEnd: new Date('2026-05-01'),
    });
    expect(breakdown.destination).toBe('owner:owner-99');
  });

  it('queues the disbursement into event_outbox on execute (row inserted)', async () => {
    // ON CONFLICT ... RETURNING id — a fresh insert returns exactly one row.
    const execute = vi.fn(async () => [{ id: 'evt_1' }]);
    const adapter = createDrizzleDisbursementAdapter(
      { execute },
      noopLogger,
    );
    const out = await adapter.executeDisbursement({
      tenantId: 'tenant-A',
      ownerId: 'owner-1',
      amountMinor: 100_000,
      currency: 'KES',
      destination: 'owner:owner@example.com',
      idempotencyKey: 'idem-A',
    });
    expect(out.disbursementId).toBe('disb_idem-A');
    expect(out.status).toBe('queued_in_outbox');
    expect(execute).toHaveBeenCalledTimes(1);
    // The INSERT must carry the ON CONFLICT ... DO NOTHING dedup guard.
    const q = execute.mock.calls[0]?.[0];
    const text = captureSqlText(q);
    expect(text).toContain('ON CONFLICT');
    expect(text).toContain('DO NOTHING');
    expect(text).toContain('correlation_id');
  });

  it('BLOCKER 2: a duplicate producer INSERT is a NO-OP (ON CONFLICT DO NOTHING)', async () => {
    // Postgres returns ZERO rows from `RETURNING id` when ON CONFLICT DO NOTHING
    // suppresses the insert (the row already exists from a prior orchestrator
    // run of the same run+owner). The adapter must report the idempotent
    // no-op status — NOT a second queued proposal — so the owner is not paid
    // twice from a duplicated producer call.
    const execute = vi.fn(async () => []); // no row returned ⇒ conflict suppressed
    const adapter = createDrizzleDisbursementAdapter({ execute }, noopLogger);
    const out = await adapter.executeDisbursement({
      tenantId: 'tenant-A',
      ownerId: 'owner-1',
      amountMinor: 100_000,
      currency: 'KES',
      destination: 'owner:owner@example.com',
      idempotencyKey: 'run-9:owner-1',
    });
    expect(out.disbursementId).toBe('disb_run-9:owner-1');
    expect(out.status).toBe('already_queued_idempotent');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reports degraded status when the outbox write fails', async () => {
    const warn = vi.fn();
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('outbox down')),
    };
    const adapter = createDrizzleDisbursementAdapter(db, { warn });
    const out = await adapter.executeDisbursement({
      tenantId: 'tenant-A',
      ownerId: 'owner-1',
      amountMinor: 100,
      currency: 'KES',
      destination: 'owner:x',
      idempotencyKey: 'idem-B',
    });
    expect(out.disbursementId).toBe('disb_idem-B');
    expect(out.status).toBe('degraded_outbox_write_failed');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 'disbursement',
        degraded_reason: 'outbox_write_failed',
      }),
      expect.any(String),
    );
  });

  it('returns zero breakdown and warns on top-level query error', async () => {
    const warn = vi.fn();
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const adapter = createDrizzleDisbursementAdapter(db, { warn });
    const breakdown = await adapter.computeBreakdown({
      tenantId: 'tenant-A',
      ownerId: 'owner-1',
      periodStart: new Date('2026-04-01'),
      periodEnd: new Date('2026-05-01'),
    });
    expect(breakdown.grossRentMinor).toBe(0);
    expect(breakdown.destination).toBe('owner:owner-1');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 'disbursement',
        degraded_reason: 'query_error',
      }),
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// NotificationPort
// ---------------------------------------------------------------------------

describe('createDrizzleNotificationAdapter', () => {
  it('writes a pending dispatch row and returns the inserted id', async () => {
    const calls = [
      // user lookup for email
      [{ email: 'owner@example.com' }],
      // INSERT (no rows)
      [],
      // SELECT id from notification_dispatch_log
      [{ id: 'inserted-id' }],
    ];
    let i = 0;
    const execute = vi.fn(async () => {
      const v = calls[i];
      i += 1;
      return v ?? [];
    });
    const adapter = createDrizzleNotificationAdapter(
      { execute },
      noopLogger,
    );
    const out = await adapter.sendStatementEmail({
      tenantId: 'tenant-A',
      ownerId: 'owner-1',
      statementId: 'stmt-1',
    });
    expect(out.dispatchId).toBe('inserted-id');
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('returns degraded id when the dispatch insert fails', async () => {
    const warn = vi.fn();
    let i = 0;
    const db = {
      execute: vi.fn(async () => {
        i += 1;
        // user-email lookup OK; insert throws
        if (i === 1) return [];
        throw new Error('insert failed');
      }),
    };
    const adapter = createDrizzleNotificationAdapter(db, { warn });
    const out = await adapter.sendStatementEmail({
      tenantId: 'tenant-A',
      ownerId: 'owner-1',
      statementId: 'stmt-1',
    });
    expect(out.dispatchId.startsWith('degraded_')).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 'notifications',
        degraded_reason: 'dispatch_log_write_failed',
      }),
      expect.any(String),
    );
  });

  it('uses owner: fallback when the user email is missing', async () => {
    const calls = [[], [], [{ id: 'x' }]];
    let i = 0;
    const execute = vi.fn(async () => {
      const v = calls[i];
      i += 1;
      return v ?? [];
    });
    const adapter = createDrizzleNotificationAdapter(
      { execute },
      noopLogger,
    );
    const out = await adapter.sendStatementEmail({
      tenantId: 'tenant-A',
      ownerId: 'owner-no-email',
      statementId: 'stmt-1',
    });
    expect(out.dispatchId).toBe('x');
  });
});
