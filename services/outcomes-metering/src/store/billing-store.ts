/**
 * Outcomes billing store — port + in-memory implementation.
 *
 * Two storage concerns, kept on one port for atomicity:
 *
 *   1. `recordEvent(input)` — append-only write to `outcome_events`.
 *      Returns `{ inserted: false }` when the (tenantId, eventId)
 *      pair already exists so the brain-event-bus consumer can
 *      re-deliver the same event safely (idempotency anchor).
 *
 *   2. `recordBillingLine(record)` — append-only write to
 *      `outcome_billing_lines`. Idempotent on (tenantId, recordId).
 *      The Drizzle adapter uses `ON CONFLICT DO NOTHING`; the
 *      in-memory implementation mirrors the same semantics.
 *
 *   3. `getMonthlyBilling(tenantId, billingMonth)` — read path for
 *      `GET /outcomes/billing/:tenantId/:month`. Aggregates per
 *      outcome kind and totals.
 *
 * The Drizzle adapter is intentionally NOT shipped in this PR — the
 * in-memory store backs the unit tests and the dev/staging path. The
 * api-gateway composition root binds a real Postgres adapter built
 * against the `outcome_events` + `outcome_billing_lines` tables
 * (migration `0169_outcomes_metering.sql`) in a follow-up.
 */

import type {
  MeteringRecord,
  OutcomeEvent,
  OutcomeKind,
} from '@borjie/outcomes';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RecordEventInput {
  readonly tenantId: string;
  readonly eventId: string;
  readonly outcomeKind: OutcomeKind;
  readonly propertyId: string;
  readonly agentId: string;
  readonly occurredAtIso: string;
  readonly payload: OutcomeEvent;
  /** Source brain-event-bus type for audit (`lease.signed` etc.). */
  readonly sourceEventType: string;
}

export interface RecordEventResult {
  /** False when the (tenantId, eventId) pair already exists. */
  readonly inserted: boolean;
}

export interface MonthlyBillingAggregate {
  readonly tenantId: string;
  readonly billingMonth: string;
  /** Per-outcome breakdown — kind → { qualifiedCount, totalBillableMinor, currency }. */
  readonly byOutcome: Readonly<
    Record<
      OutcomeKind,
      {
        readonly qualifiedCount: number;
        readonly totalBillableMinor: number;
        /** Currencies seen — usually 1; could be >1 for multi-tenant operators. */
        readonly currencies: ReadonlyArray<string>;
      }
    >
  >;
  /** Sum across all outcomes, in the dominant currency for the tenant. */
  readonly totalBillableMinor: number;
  /** Dominant currency by line count. 'USD' fallback if no qualified lines. */
  readonly dominantCurrency: string;
  /** Number of qualified billing lines included. */
  readonly qualifiedLineCount: number;
}

export interface BillingStore {
  recordEvent(input: RecordEventInput): Promise<RecordEventResult>;
  recordBillingLine(record: MeteringRecord): Promise<RecordEventResult>;
  getMonthlyBilling(
    tenantId: string,
    billingMonth: string,
  ): Promise<MonthlyBillingAggregate>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

interface InternalEventRow {
  readonly tenantId: string;
  readonly eventId: string;
  readonly payload: OutcomeEvent;
  readonly receivedAt: Date;
}

interface InternalBillingRow extends MeteringRecord {
  readonly billingMonth: string;
}

function toBillingMonth(scoredAtIso: string): string {
  // Defensive — scoredAt is an ISO-8601 timestamp; take the first 7
  // chars (YYYY-MM). Fail-safe to current month if parse fails so the
  // aggregator never crashes on a bad input.
  if (typeof scoredAtIso === 'string' && /^\d{4}-\d{2}/.test(scoredAtIso)) {
    return scoredAtIso.slice(0, 7);
  }
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

const ZERO_PER_KIND: MonthlyBillingAggregate['byOutcome'] = {
  ticket_resolved_within_sla: { qualifiedCount: 0, totalBillableMinor: 0, currencies: [] },
  rent_collected: { qualifiedCount: 0, totalBillableMinor: 0, currencies: [] },
  vacancy_filled: { qualifiedCount: 0, totalBillableMinor: 0, currencies: [] },
};

export function createInMemoryBillingStore(): BillingStore {
  // Maps keyed on the canonical idempotency tuple.
  const events = new Map<string, InternalEventRow>();
  const lines = new Map<string, InternalBillingRow>();

  const eventKey = (tenantId: string, eventId: string): string =>
    `${tenantId}::${eventId}`;
  const lineKey = (tenantId: string, recordId: string): string =>
    `${tenantId}::${recordId}`;

  return {
    async recordEvent(input: RecordEventInput): Promise<RecordEventResult> {
      const key = eventKey(input.tenantId, input.eventId);
      if (events.has(key)) {
        return { inserted: false };
      }
      events.set(key, {
        tenantId: input.tenantId,
        eventId: input.eventId,
        payload: input.payload,
        receivedAt: new Date(),
      });
      return { inserted: true };
    },

    async recordBillingLine(record: MeteringRecord): Promise<RecordEventResult> {
      const key = lineKey(record.tenantId, record.recordId);
      if (lines.has(key)) {
        return { inserted: false };
      }
      lines.set(key, {
        ...record,
        billingMonth: toBillingMonth(record.scoredAt),
      });
      return { inserted: true };
    },

    async getMonthlyBilling(
      tenantId: string,
      billingMonth: string,
    ): Promise<MonthlyBillingAggregate> {
      // Defensive accumulator — start from a fresh per-kind shape so
      // mutation later does not leak across `getMonthlyBilling` calls
      // (the constant is frozen-by-reference).
      const byOutcome: Record<
        OutcomeKind,
        { qualifiedCount: number; totalBillableMinor: number; currencies: string[] }
      > = {
        ticket_resolved_within_sla: { qualifiedCount: 0, totalBillableMinor: 0, currencies: [] },
        rent_collected: { qualifiedCount: 0, totalBillableMinor: 0, currencies: [] },
        vacancy_filled: { qualifiedCount: 0, totalBillableMinor: 0, currencies: [] },
      };
      const currencyCounts = new Map<string, number>();
      let totalBillableMinor = 0;
      let qualifiedLineCount = 0;

      for (const row of lines.values()) {
        if (row.tenantId !== tenantId) continue;
        if (row.billingMonth !== billingMonth) continue;
        if (!row.qualified) continue;

        const bucket = byOutcome[row.outcomeKind];
        bucket.qualifiedCount += 1;
        bucket.totalBillableMinor += row.billableAmountMinor;
        if (!bucket.currencies.includes(row.currency)) {
          bucket.currencies.push(row.currency);
        }
        totalBillableMinor += row.billableAmountMinor;
        qualifiedLineCount += 1;
        currencyCounts.set(
          row.currency,
          (currencyCounts.get(row.currency) ?? 0) + 1,
        );
      }

      let dominantCurrency = 'USD';
      let bestCount = -1;
      for (const [currency, count] of currencyCounts) {
        if (count > bestCount) {
          bestCount = count;
          dominantCurrency = currency;
        }
      }

      // Freeze the per-outcome slices on the way out so callers don't
      // accidentally mutate the in-memory aggregator state.
      const byOutcomeFrozen: MonthlyBillingAggregate['byOutcome'] = {
        ticket_resolved_within_sla: {
          qualifiedCount: byOutcome.ticket_resolved_within_sla.qualifiedCount,
          totalBillableMinor: byOutcome.ticket_resolved_within_sla.totalBillableMinor,
          currencies: [...byOutcome.ticket_resolved_within_sla.currencies],
        },
        rent_collected: {
          qualifiedCount: byOutcome.rent_collected.qualifiedCount,
          totalBillableMinor: byOutcome.rent_collected.totalBillableMinor,
          currencies: [...byOutcome.rent_collected.currencies],
        },
        vacancy_filled: {
          qualifiedCount: byOutcome.vacancy_filled.qualifiedCount,
          totalBillableMinor: byOutcome.vacancy_filled.totalBillableMinor,
          currencies: [...byOutcome.vacancy_filled.currencies],
        },
      };

      void ZERO_PER_KIND; // exported for future Drizzle adapter parity
      return {
        tenantId,
        billingMonth,
        byOutcome: byOutcomeFrozen,
        totalBillableMinor,
        dominantCurrency,
        qualifiedLineCount,
      };
    },
  };
}
