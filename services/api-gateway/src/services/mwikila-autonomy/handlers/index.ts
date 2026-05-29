/**
 * Mr. Mwikila autonomous handlers — public surface.
 *
 * Each handler is a pure-logic module: ports are injected so vitest
 * drives every branch without a real Postgres. Composition root wires
 * the Drizzle-backed ports.
 */

export {
  buildShiftScheduleProposal,
  createShiftSchedulerHandler,
  type WorkforceMember,
  type SiteCapacity,
  type ShiftSchedulerPorts,
  type ShiftSchedulerOptions,
} from './shift-scheduler.js';

export {
  computeRoyaltyDueTzs,
  buildRoyaltyFilingProposal,
  createRoyaltyFilingHandler,
  type RoyaltyFilingPorts,
  type RoyaltyFilingOptions,
} from './royalty-filing-prep.js';

export {
  pickClosestWindow,
  buildLicenseRenewalProposal,
  createLicenseRenewalHandler,
  type LicenseRow,
  type LicenseRenewalPorts,
} from './license-renewal.js';

export {
  computePayrollRow,
  buildPayrollProposal,
  createPayrollHandler,
  type PayrollWorkerRow,
  type PayrollPorts,
  type PayrollComputed,
} from './payroll-prep.js';

export {
  computeCounterPriceTzs,
  buildMarketplaceCounterProposal,
  createMarketplaceCounterHandler,
  type OpenOfferRow,
  type SellerTargets,
  type MarketplaceCounterPorts,
} from './marketplace-counter.js';
