/**
 * Outcome catalog — the three first monetizable outcomes.
 *
 * Per `.audit/litfin-sota-2026-05-23/10-outcome-as-a-service.md` §13,
 * ranked by (ease of measurement) × (ease of attribution) × (existing
 * baseline data).
 *
 * This catalog is the contract between the billing engine and the
 * scorers: change a price unit here and every invoice changes. Treat
 * it like schema.
 *
 * All amounts in minor units (cents). Currency default USD; production
 * deployments override per-tenant via the billing engine, which is out
 * of scope for the primitives package.
 */
import type { Outcome, OutcomeKind } from './types.js';
import { OUTCOME_KINDS } from './types.js';

// Defaults for currency at the catalog level. Tenants override
// downstream — the catalog just guarantees a sane shipping default
// so smoke tests and pilots can run.
const DEFAULT_CURRENCY = 'USD';

// ─────────────────────────────────────────────────────────────────────
// #1 — Ticket resolved within SLA
//
// $10/ticket, capped at 95% of the $40 human cost baseline (industry
// average per Maven AGI / Decagon 2026 surveys). Pure per-event price.
// 14-day clawback so re-opened tickets don't bill.
// ─────────────────────────────────────────────────────────────────────

const TICKET_RESOLVED: Outcome = {
  kind: 'ticket_resolved_within_sla',
  displayName: 'Ticket resolved within SLA',
  description:
    'AI-managed work order closed within its committed SLA window, ' +
    'confirmed by the tenant, and not re-opened within 14 days.',
  pricing: [
    {
      kind: 'per_event',
      currency: DEFAULT_CURRENCY,
      amountMinor: 1_000, // $10.00
      capFractionOfHumanCost: 0.95,
    },
  ],
  attributionRule: 'per_closed_unit_of_work',
  groundTruthSource: 'work_order_system_plus_tenant_confirmation',
  clawbackWindowDays: 14,
};

// ─────────────────────────────────────────────────────────────────────
// #2 — Rent collected
//
// 2% of total collected ABOVE the prior-12mo baseline (counterfactual
// delta), plus 10% of recovered delinquency. Min retainer $200/mo so
// the floor is predictable on quiet months. 90-day clawback covers
// chargebacks / disputes.
// ─────────────────────────────────────────────────────────────────────

const RENT_COLLECTED: Outcome = {
  kind: 'rent_collected',
  displayName: 'Rent collected',
  description:
    'Bank-reconciled rent above the prior-12-month baseline plus ' +
    'recovered delinquency. Min retainer $200/property/month; 90-day ' +
    'clawback window covers chargebacks and disputes.',
  pricing: [
    {
      kind: 'percentage_of',
      basisPoints: 200, // 2.00%
      appliesTo: 'collected_minor',
      minRetainerMinor: 20_000, // $200.00
      currency: DEFAULT_CURRENCY,
    },
    {
      kind: 'percentage_of',
      basisPoints: 1_000, // 10.00%
      appliesTo: 'recovered_delinquency_minor',
      currency: DEFAULT_CURRENCY,
    },
  ],
  attributionRule: 'counterfactual_delta_vs_prior_12mo',
  groundTruthSource: 'bank_reconciliation',
  clawbackWindowDays: 90,
};

// ─────────────────────────────────────────────────────────────────────
// #3 — Vacancy filled
//
// Half a month's rent per executed lease + move-in. 30-day clawback
// covers cancellations and no-shows. Mirrors the traditional letting-
// agent commission model so landlord contracts feel familiar.
// ─────────────────────────────────────────────────────────────────────

const VACANCY_FILLED: Outcome = {
  kind: 'vacancy_filled',
  displayName: 'Vacancy filled',
  description:
    'Lease executed and tenant moved into a previously vacant unit. ' +
    '30-day clawback window covers cancellations and no-shows.',
  pricing: [
    {
      kind: 'fraction_of_monthly_rent',
      fraction: 0.5, // half a month's rent
      currency: DEFAULT_CURRENCY,
    },
  ],
  attributionRule: 'agent_executed_end_to_end',
  groundTruthSource: 'signed_lease_plus_move_in',
  clawbackWindowDays: 30,
};

// ─────────────────────────────────────────────────────────────────────
// Registry — frozen so consumers cannot mutate it at runtime.
// ─────────────────────────────────────────────────────────────────────

const REGISTRY: Readonly<Record<OutcomeKind, Outcome>> = Object.freeze({
  ticket_resolved_within_sla: TICKET_RESOLVED,
  rent_collected: RENT_COLLECTED,
  vacancy_filled: VACANCY_FILLED,
});

/** Look up the catalog entry for an outcome kind. */
export function getOutcome(kind: OutcomeKind): Outcome {
  return REGISTRY[kind];
}

/** List every outcome in the catalog. Stable order: see OUTCOME_KINDS. */
export function listOutcomes(): ReadonlyArray<Outcome> {
  return OUTCOME_KINDS.map((kind) => REGISTRY[kind]);
}

/** True iff every catalog entry's `kind` matches its registry key.
 *  Used by tests to catch copy-paste mistakes early. */
export function catalogIsConsistent(): boolean {
  return OUTCOME_KINDS.every((kind) => REGISTRY[kind].kind === kind);
}
