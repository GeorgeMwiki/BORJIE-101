/**
 * @borjie/ai-copilot / orchestrators — multi-service state machines
 * that stitch existing domain services together into end-to-end flows.
 *
 * Wave 27: VacancyToLease.
 * Wave 28: MonthlyClose (end-of-month bookkeeping close).
 *
 * Each orchestrator stays self-contained in its own subtree and exports
 * its public surface via a folder barrel.
 */

export * as VacancyToLease from './vacancy-to-lease/index.js';
export * as MonthlyClose from './monthly-close/index.js';
