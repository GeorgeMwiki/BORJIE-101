/**
 * `@borjie/timezone-detection` — public types.
 *
 * SOTA timezone detection + per-user rendering. Composite priority chain:
 *   account > jwt-claim > browser > ip > jurisdiction > UTC
 *
 * No business logic hard-codes a TZ — `formatCurrency`-style discipline:
 * every render is parameterised by the tenant/user's detected TZ.
 *
 * No external runtime deps. Uses the IANA tzdata that ships with Node 20+
 * via `Intl.DateTimeFormat`.
 */

/**
 * An IANA Time Zone Database identifier (e.g. `Africa/Nairobi`,
 * `America/New_York`, `Europe/London`, `UTC`). Validated lazily via
 * `Intl.DateTimeFormat`. We accept the alias / canonical convention from
 * tzdata 2024b+.
 */
export type TimezoneId = string;

/**
 * Where the resolver got the timezone from. Higher in this enum =
 * higher priority in the composite resolver:
 *   - `account`      : explicit user/tenant setting in our DB
 *   - `jwt-claim`    : RFC 7519 `zoneinfo` claim on the access token
 *   - `browser`      : `Intl.DateTimeFormat().resolvedOptions().timeZone`
 *   - `ip`           : MaxMind GeoIP2 / ipapi.co / ipgeolocation.io lookup
 *   - `jurisdiction` : jurisdiction-code → capital-city TZ fallback
 *   - `default-utc`  : nothing was available
 */
export type DetectionSource =
  | 'account'
  | 'jwt-claim'
  | 'browser'
  | 'ip'
  | 'jurisdiction'
  | 'default-utc';

/** Confidence score for a resolved timezone (0..1). */
export type DetectionConfidence = number;

/** Result of any single-source detection or the composite resolver. */
export interface DetectionResult {
  readonly timezone: TimezoneId;
  readonly source: DetectionSource;
  /**
   * 0..1 — higher is better. Account/JWT typically 1.0, browser ~0.95,
   * IP ~0.7 (mobile carriers + VPNs cause errors), jurisdiction ~0.3,
   * default-utc 0.0.
   */
  readonly confidence: DetectionConfidence;
  /** Optional human-readable explanation, e.g. for audit logging. */
  readonly reason?: string;
}

/** Signed-minutes offset from UTC at a given instant. */
export type TimezoneOffsetMinutes = number;

/**
 * ISO-3166-1 alpha-2 jurisdiction code, e.g. `TZ`, `KE`, `UG`, `RW`, `NG`,
 * `ZA`, `US`, `GB`. Used by `detectFromJurisdiction()`.
 */
export type JurisdictionCode = string;

/**
 * Default timezone for a jurisdiction. For multi-zone countries (US, RU,
 * AU, CA, BR, MX) the entry uses the capital-city zone as a sane
 * fallback — apps SHOULD prefer browser / IP detection in those regions.
 */
export interface JurisdictionDefault {
  readonly jurisdiction: JurisdictionCode;
  readonly timezone: TimezoneId;
  /** Capital city / largest population centre for that zone. */
  readonly canonicalCity: string;
  /** True when the jurisdiction spans multiple IANA zones. */
  readonly isMultiZone: boolean;
  /** True iff the canonical zone observes DST. */
  readonly observesDST: boolean;
}

/**
 * Description of a DST rule outcome for a specific date in a zone.
 * `null` means no transition is happening at that instant.
 */
export type DSTRule =
  | { kind: 'spring-forward'; gapMinutes: number; observed: TimezoneId }
  | { kind: 'fall-back'; overlapMinutes: number; observed: TimezoneId }
  | null;

/**
 * Context handed to every render helper. Made of detected timezone +
 * locale + format defaults. Renders are pure functions of this context.
 */
export interface RenderContext {
  readonly timezone: TimezoneId;
  /** BCP-47 locale, e.g. `en-KE`, `sw-TZ`, `en-US`, `en-GB`. */
  readonly locale?: string;
  /** Hint that the consumer wants a 12-hour clock (default: locale-driven). */
  readonly hour12?: boolean;
}

/**
 * Pluggable IP→TZ adapter. Real impls: MaxMind GeoIP2 binary, ipapi.co
 * HTTP API, ipgeolocation.io HTTP API. Stubs are exported for unit tests.
 */
export interface GeoIPAdapter {
  readonly name: 'maxmind' | 'ipapi' | 'ipgeolocation' | 'stub';
  lookup(ip: string): Promise<{ timezone: TimezoneId } | null>;
}

/**
 * Decoded JWT shape — we only care about the RFC 7519 `zoneinfo` claim.
 * Caller is responsible for signature verification before passing.
 */
export interface DecodedJWT {
  readonly zoneinfo?: TimezoneId;
  readonly locale?: string;
  /** Allow downstream consumers to add their own claims. */
  readonly [k: string]: unknown;
}

/** Inputs to the composite resolver. All optional — the resolver picks the best. */
export interface CompositeDetectionInput {
  readonly account?: TimezoneId | null;
  readonly jwt?: DecodedJWT | null;
  readonly browser?: TimezoneId | null;
  readonly ip?: { ip: string; geoip: GeoIPAdapter } | null;
  readonly jurisdiction?: JurisdictionCode | null;
}
