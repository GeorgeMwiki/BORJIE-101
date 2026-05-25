/**
 * Centralized application constants.
 *
 * Every magic number / threshold the codebase used to inline has a named
 * home here. If a value is country-specific it belongs in
 * `@borjie/domain-models`'s `region-config.ts`, not here. This file is
 * ONLY for cross-country, region-agnostic operational knobs.
 *
 * Consumers import named constants; NEVER re-export bundled "all" objects
 * from here because that defeats tree-shaking and obscures call-sites.
 */

// ---------------------------------------------------------------------------
// Approval thresholds (amounts are in MAJOR currency units — the caller
// must convert to tenant's currency before comparing; see
// `region-config.ts` for the tenant currency).
// ---------------------------------------------------------------------------

/** Expenses above this MAJOR-unit amount require manager approval. */
export const EXPENSE_MANAGER_APPROVAL_THRESHOLD_MAJOR = 50_000;

/** Expenses above this MAJOR-unit amount require director approval. */
export const EXPENSE_DIRECTOR_APPROVAL_THRESHOLD_MAJOR = 500_000;

// ---------------------------------------------------------------------------
// Disbursement thresholds (minor units).
// ---------------------------------------------------------------------------

/** Minimum owner balance (MAJOR units) to appear in disbursement summary. */
export const DISBURSEMENT_MIN_BALANCE_MAJOR = 1_000;

// ---------------------------------------------------------------------------
// File-size thresholds (bytes).
// ---------------------------------------------------------------------------

/** Documents smaller than this are considered suspicious (likely truncated). */
export const DOCUMENT_MIN_SIZE_BYTES = 50_000;

// ---------------------------------------------------------------------------
// HTTP / network.
// ---------------------------------------------------------------------------

/** Default API request timeout in ms. */
export const DEFAULT_API_TIMEOUT_MS = 15_000;

/** Default retry count for transient failures. */
export const DEFAULT_RETRY_COUNT = 3;

/** Default CORS preflight cache age in seconds (24h). */
export const CORS_MAX_AGE_SECONDS = 86_400;

// ---------------------------------------------------------------------------
// Reminder ladder (days relative to due date). Positive = before due.
// ---------------------------------------------------------------------------

export const REMINDER_LADDER_DAYS = {
  /** Friendly upcoming reminder. */
  earlyNotice: 5,
  /** Final notice the day before due. */
  dayBefore: 1,
  /** Grace-period overdue reminder. */
  firstOverdue: -3,
  /** Final overdue notice. */
  finalOverdue: -7,
} as const;

// ---------------------------------------------------------------------------
// Pagination.
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// Session / auth.
// ---------------------------------------------------------------------------

/** Idle session minutes before forced re-auth. */
export const SESSION_IDLE_TIMEOUT_MINUTES = 30;

// ---------------------------------------------------------------------------
// Dev server defaults — ONLY used when NODE_ENV !== 'production'.
// Production code MUST NEVER fall through to these; throw instead.
// ---------------------------------------------------------------------------

export const DEV_DEFAULT_PORTS = {
  apiGateway: 4000,
  ownerPortal: 3000,
  adminPortal: 3001,
  customerApp: 3002,
  estateManagerApp: 3003,
} as const;

export const DEV_DEFAULT_URLS = {
  apiGateway: `http://localhost:${DEV_DEFAULT_PORTS.apiGateway}`,
  ownerPortal: `http://localhost:${DEV_DEFAULT_PORTS.ownerPortal}`,
  adminPortal: `http://localhost:${DEV_DEFAULT_PORTS.adminPortal}`,
  customerApp: `http://localhost:${DEV_DEFAULT_PORTS.customerApp}`,
  estateManagerApp: `http://localhost:${DEV_DEFAULT_PORTS.estateManagerApp}`,
} as const;

// ---------------------------------------------------------------------------
// Platform-wide *last-resort* fallback defaults.
//
// BORJIE is a global platform. Country, currency, locale and timezone
// should always be resolved from `tenant.countryCode` via
// `@borjie/domain-models`'s `getRegionConfig()`. These constants exist
// ONLY as the neutral fallback used when:
//   - the tenant record is missing or not yet loaded
//   - a tool / migration / test harness has no tenant context
//
// They must stay country-neutral. Do NOT swap these for `TZS`, `KES`,
// or any other country-specific value even as a "sensible default" —
// pass the tenant field through instead.
// ---------------------------------------------------------------------------

/** Last-resort currency when tenant.defaultCurrency is unknown. ISO 4217. */
export const DEFAULT_FALLBACK_CURRENCY = 'USD';

/** Last-resort country when tenant.countryCode is unknown. ISO 3166-1 alpha-2. */
export const DEFAULT_FALLBACK_COUNTRY_CODE = '';

/** Last-resort BCP-47 locale when tenant.defaultLocale is unknown. */
export const DEFAULT_FALLBACK_LOCALE = 'en';

/** Last-resort IANA timezone when tenant.defaultTimezone is unknown. */
export const DEFAULT_FALLBACK_TIMEZONE = 'UTC';
