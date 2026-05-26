/**
 * @borjie/data-protection — core type lattice.
 *
 * SEC-3 (Mr. Mwikila). See Docs/COMPLIANCE/SOTA_DATA_PROTECTION_2026.md.
 *
 * Universal invariant: no framework / jurisdiction / country code is named
 * inside this package. The package consumes a `ComplianceFrameworkPort`
 * supplied by the caller — typically from @borjie/jurisdiction-profiles
 * or @borjie/compliance-plugins. Adding a new jurisdiction = adding a new
 * framework row, not editing this code. See
 * Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md.
 */

/** The eight-rung data-classification lattice. */
export const CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'restricted',
  'critical',
  'pii',
  'phi',
  'financial',
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

/** RTBF cascade actions per target table. */
export const RTBF_ACTIONS = [
  'redacted',
  'deleted',
  'crypto-shredded',
  'retained-legal-hold',
] as const;

export type RtbfAction = (typeof RTBF_ACTIONS)[number];

/** RTBF request lifecycle states. */
export const RTBF_STATUSES = [
  'open',
  'in-progress',
  'completed',
  'denied',
  'expired',
] as const;

export type RtbfStatus = (typeof RTBF_STATUSES)[number];

/** Breach severity ladder. */
export const BREACH_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type BreachSeverity = (typeof BREACH_SEVERITIES)[number];

/** KEK residency mode per tenant. */
export const KEY_KINDS = [
  'platform-managed',
  'customer-managed-byok',
  'customer-managed-hyok',
] as const;
export type KeyKind = (typeof KEY_KINDS)[number];

/**
 * Strict precedence used to collapse a multi-label set into ONE canonical
 * label for the UNIQUE(tenant, entity_kind, entity_id) DB constraint.
 *
 *     critical > phi > pii > financial > restricted > confidential > internal > public
 *
 * The runtime materialises overlapping controls (e.g., a row tagged both
 * `phi` and `pii` gets the union of the per-class controls); the DB stores
 * the leftmost wins.
 */
export const CLASSIFICATION_PRECEDENCE: readonly Classification[] = Object.freeze([
  'critical',
  'phi',
  'pii',
  'financial',
  'restricted',
  'confidential',
  'internal',
  'public',
]);

/**
 * Compliance framework port — the caller-supplied shape.
 *
 * Each framework instance binds a regulator's parameters to Borjie's
 * controls. The package consumes the shape via dependency injection;
 * NEVER names a framework directly.
 */
export interface ComplianceFrameworkPort {
  /** Stable framework ID e.g. `'gdpr'`, `'ccpa'`, `'lgpd'`, `'pipl'`. */
  readonly id: string;
  /** Human label. */
  readonly label: string;
  /** Hours from detection within which the supervisory authority MUST be notified. */
  readonly breachAuthorityNotificationHours: number;
  /** Hours from detection within which affected subjects MUST be notified for high-risk breaches. */
  readonly breachSubjectNotificationHours: number;
  /** Days within which an RTBF request must be fulfilled or denied. */
  readonly rtbfFulfilmentDays: number;
  /** Per-class statutory minimum retention windows (days), if any. */
  readonly minRetentionDaysByClass: Readonly<Partial<Record<Classification, number>>>;
  /** Per-class statutory ceiling retention windows (days), if any. */
  readonly maxRetentionDaysByClass: Readonly<Partial<Record<Classification, number>>>;
  /** Provenance — URL + title + date — required so a regulator can audit the source rule. */
  readonly provenance: ReadonlyArray<{
    readonly url: string;
    readonly title: string;
    readonly date: string;
  }>;
}

/**
 * Custom error class — thrown when the caller violates an invariant
 * documented in the spec (e.g., tries to crypto-shred a row under
 * legal hold).
 */
export class DataProtectionInvariantError extends Error {
  public override readonly name = 'DataProtectionInvariantError';
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
