/**
 * Port contracts — the five jurisdiction-pluggable surfaces every country
 * plugin is expected to implement. Each port ships with a DEFAULT
 * implementation so hot paths never crash on an unconfigured country.
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
  TenantProfileForFiling,
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
  DEFAULT_TENANT_SCREENING,
  buildStubBureauResult,
} from './tenant-screening.port.js';
export type {
  BureauLookupResult,
  IdentityDocument,
  TenantScreeningPort,
} from './tenant-screening.port.js';

export { DEFAULT_LEASE_LAW } from './lease-law.port.js';
export type {
  ClauseSpec,
  DepositCap,
  DepositCapRegime,
  LeaseKind,
  LeaseLawPort,
  NoticeReason,
  RentIncreaseCap,
} from './lease-law.port.js';
