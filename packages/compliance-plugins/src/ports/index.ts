/**
 * Port contracts — the five jurisdiction-pluggable surfaces every country
 * mining-compliance plugin is expected to implement. Each port ships with a
 * DEFAULT implementation so hot paths never crash on an unconfigured country.
 */

export {
  DEFAULT_TAX_REGIME,
  flatRateWithholding,
} from './tax-regime.port.js';
export type {
  TaxPeriod,
  TaxRegimePort,
  WithholdingResult,
} from './tax-regime.port.js';

export {
  DEFAULT_TAX_FILING,
  buildGenericCsvPayload,
  formatFilingPeriodLabel,
} from './tax-filing.port.js';
export type {
  FilingFormat,
  FilingLineItem,
  FilingResult,
  FilingRun,
  TaxFilingPort,
  OperatorProfileForFiling,
} from './tax-filing.port.js';

export {
  DEFAULT_PAYMENT_RAIL_PORT,
  DEFAULT_PAYMENT_RAILS,
} from './payment-rail.port.js';
export type {
  PaymentRail,
  PaymentRailKind,
  PaymentRailPort,
} from './payment-rail.port.js';

export {
  DEFAULT_COUNTERPARTY_SCREENING,
  buildStubBureauResult,
} from './counterparty-screening.port.js';
export type {
  BureauLookupResult,
  IdentityDocument,
  CounterpartyScreeningPort,
} from './counterparty-screening.port.js';

export { DEFAULT_MINING_LAW } from './mining-law.port.js';
export type {
  ClauseSpec,
  BondCap,
  BondCapRegime,
  OperationKind,
  MiningLawPort,
  NoticeReason,
  RoyaltyEscalationCap,
} from './mining-law.port.js';
