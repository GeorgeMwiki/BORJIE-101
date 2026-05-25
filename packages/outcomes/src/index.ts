/**
 * @borjie/outcomes — public surface.
 *
 * Outcome catalog + metering primitives for the outcome-as-a-service
 * pricing model. Three first-monetizable outcomes:
 *
 *   1. ticket_resolved_within_sla — per-event, $10/ticket, capped
 *      at 95% of the $40 human-cost baseline. 14-day clawback.
 *   2. rent_collected — 2% of the lift above prior-12mo baseline +
 *      10% of recovered delinquency. $200/mo floor retainer.
 *      90-day clawback.
 *   3. vacancy_filled — half a month's rent per executed lease +
 *      move-in. 30-day clawback.
 *
 * This package ships PURE primitives only: types, the catalog, three
 * deterministic scorers, and the counterfactual-baseline math. No
 * I/O, no clocks, no IDs — those are the billing engine's job.
 *
 * Consumers:
 *   - `apps/billing-engine` turns MeteringRecords into invoice lines.
 *   - `apps/outcome-ledger` persists OutcomeEvents and MeteringRecords.
 *   - `apps/orchestrator` (Temporal) emits OutcomeEvents when its
 *     agents close work.
 */
export * from './types.js';
export {
  getOutcome,
  listOutcomes,
  catalogIsConsistent,
} from './catalog.js';
export {
  scoreTicketResolved,
  type TicketResolvedScorerOptions,
} from './ticket-resolved-metric.js';
export {
  scoreRentCollected,
  type RentCollectedScorerOptions,
} from './rent-collected-metric.js';
export {
  scoreVacancyFilled,
  type VacancyFilledScorerOptions,
} from './vacancy-filled-metric.js';
export {
  computeBaseline,
  deltaAboveBaseline,
  type BaselineOptions,
} from './counterfactual-baseline.js';
