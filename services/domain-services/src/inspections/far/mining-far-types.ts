/**
 * Mining FAR (Field Asset Register) — service-layer types, inputs,
 * error codes, and money/cadence helpers.
 *
 * This is the MINING-domain replacement for the retired property-domain
 * FAR types. The Field Asset Register is the per-site list of physical
 * mining fixed assets — excavators, compressors, generators, pumps,
 * crushers, trucks, drill rigs, structures, vehicles — together with
 * the scheduled inspection / maintenance cadence and the chronological
 * log of inspection (condition-check) and service events against them.
 *
 * It is backed by the real mining repo `PostgresSiteFarRepository`
 * (over the `assets` + `maintenance_events` tables) — NO stubs, NO
 * fabricated values.
 *
 * Split out of `mining-far-service.ts` to keep each file under the
 * project's soft size cap. Pure types + small pure helpers only — no
 * I/O, no mutation.
 */

import { formatMoney, moneyFromDecimal } from '@borjie/domain-models';
import type { CurrencyCode } from '@borjie/domain-models';
import type {
  AssetKind,
  AssetStatus,
  MaintenanceKind,
  MaintenanceStatus,
  MaintenanceLogEntry,
  SiteAsset,
} from '../../site/site-far-types.js';

// ---------------------------------------------------------------------------
// Logger port (Pino-shaped — no console.* anywhere in this module)
// ---------------------------------------------------------------------------

/** Minimal Pino-shaped logger surface the service depends on. */
export interface FarLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** No-op logger so callers may omit one without nullable plumbing. */
export const NOOP_FAR_LOGGER: FarLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

// ---------------------------------------------------------------------------
// Inspection cadence → days. Drives the scheduled-inspection due date.
// ---------------------------------------------------------------------------

export const FAR_INSPECTION_FREQUENCIES = [
  'weekly',
  'monthly',
  'quarterly',
  'biannual',
  'annual',
  'ad_hoc',
] as const;
export type FarInspectionFrequency =
  (typeof FAR_INSPECTION_FREQUENCIES)[number];

const FREQUENCY_DAYS: Readonly<Record<FarInspectionFrequency, number | null>> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  biannual: 180,
  annual: 365,
  ad_hoc: null,
};

/** Days for a cadence, or null for one-off (`ad_hoc`). Pure. */
export function frequencyDays(freq: FarInspectionFrequency): number | null {
  return FREQUENCY_DAYS[freq];
}

/** Add whole days to an ISO instant, returning a new ISO string. Pure. */
export function addDaysIso(fromIso: string, days: number): string {
  const d = new Date(fromIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Service inputs (mining-native field names)
// ---------------------------------------------------------------------------

/** Register a new site fixed asset on the Field Asset Register. */
export interface AddAssetInput {
  readonly tenantId: string;
  readonly companyId: string;
  readonly kind: AssetKind;
  readonly currentSiteId?: string | null;
  readonly make?: string | null;
  readonly model?: string | null;
  readonly year?: number | null;
  readonly serialNumber?: string | null;
  readonly owned?: boolean;
  readonly currentOperatorUserId?: string | null;
  readonly status?: AssetStatus;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/** Schedule a recurring inspection / maintenance cadence for an asset. */
export interface ScheduleInspectionInput {
  readonly tenantId: string;
  readonly assetId: string;
  readonly frequency: FarInspectionFrequency;
  /** What the scheduled visit is — defaults to a periodic `inspection`. */
  readonly kind?: MaintenanceKind;
  readonly assignedToUserId?: string | null;
  /** Explicit first due instant; otherwise derived from `frequency`. */
  readonly firstDueAt?: string | null;
  readonly summary?: string | null;
  readonly evidenceIds?: readonly string[];
}

/** Log the outcome of an inspection / service visit against an asset. */
export interface LogInspectionInput {
  readonly tenantId: string;
  readonly assetId: string;
  readonly outcome: InspectionOutcome;
  readonly kind?: MaintenanceKind;
  readonly performedByUserId?: string | null;
  readonly summary?: string | null;
  readonly downtimeHours?: number | null;
  readonly costAmount?: number | null;
  /** ISO-4217 currency code for `costAmount`. Never defaulted in code. */
  readonly costCurrency?: string | null;
  readonly partsUsed?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly performedAt?: string | null;
  readonly evidenceIds?: readonly string[];
  /** Optional asset-status transition implied by the outcome. */
  readonly assetStatusAfter?: AssetStatus | null;
}

// ---------------------------------------------------------------------------
// Inspection outcome → maintenance-event status + (optional) asset status
// ---------------------------------------------------------------------------

export const INSPECTION_OUTCOMES = [
  'pass',
  'warning',
  'fail',
  'skipped',
] as const;
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number];

/**
 * Map an inspection outcome to the persisted maintenance-event status.
 * A logged check is a completed visit unless it was skipped. Pure.
 */
export function outcomeToEventStatus(
  outcome: InspectionOutcome,
): MaintenanceStatus {
  return outcome === 'skipped' ? 'cancelled' : 'completed';
}

// ---------------------------------------------------------------------------
// Read-model: a maintenance/inspection log entry with a rendered cost.
// The numeric `costAmount` is preserved verbatim; `costDisplay` is a
// convenience render that NEVER hardcodes a currency.
// ---------------------------------------------------------------------------

export interface FarLogEntryView {
  readonly entry: MaintenanceLogEntry;
  readonly costDisplay: string | null;
}

/** ISO-4217 shape guard — three upper-case letters. Pure. */
function isIso4217(code: string | null | undefined): code is string {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code.trim());
}

/**
 * Render a maintenance entry's `costTzs` numeric (a major-unit decimal)
 * via the domain `Money` value object with the supplied ISO-4217 code.
 * Returns null when there is no cost OR no valid currency code is
 * threaded — we never fabricate / hardcode a currency (hard rule:
 * never hardcode TZS / USD / KES / UGX / NGN).
 */
export function toLogEntryView(
  entry: MaintenanceLogEntry,
  currencyCode: string | null | undefined,
): FarLogEntryView {
  const amount = entry.costTzs;
  if (amount == null || !isIso4217(currencyCode)) {
    return { entry, costDisplay: null };
  }
  const code = currencyCode.trim().toUpperCase() as CurrencyCode;
  const display = formatMoney(moneyFromDecimal(amount, code));
  return { entry, costDisplay: display };
}

// Re-export the underlying mining shapes so route/registry callers can
// import the whole FAR surface from this one module.
export type {
  AssetKind,
  AssetStatus,
  MaintenanceKind,
  MaintenanceStatus,
  MaintenanceLogEntry,
  SiteAsset,
};

// ---------------------------------------------------------------------------
// Error envelope (codes the route's status-mapping branches on)
// ---------------------------------------------------------------------------

export const MiningFarErrorCode = {
  INVALID_INPUT: 'INVALID_INPUT',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSIGNMENT_NOT_FOUND: 'ASSIGNMENT_NOT_FOUND',
  INVALID_STATUS: 'INVALID_STATUS',
} as const;
export type MiningFarErrorCode =
  (typeof MiningFarErrorCode)[keyof typeof MiningFarErrorCode];

export interface MiningFarErrorResult {
  readonly code: MiningFarErrorCode;
  readonly message: string;
}
