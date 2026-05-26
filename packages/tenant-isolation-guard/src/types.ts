/**
 * Public type surface for `@borjie/tenant-isolation-guard`.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */

/** A tenant identifier. We never accept the empty string. */
export type TenantId = string & { readonly __brand: 'TenantId' };

/**
 * Brand a raw string as a TenantId after structural validation.
 * Returns `null` if the input is empty, contains whitespace, or
 * contains the `:` character (which would corrupt key prefixes).
 */
export function asTenantId(raw: string): TenantId | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0) return null;
  if (/\s/.test(raw)) return null;
  if (raw.includes(':')) return null;
  if (raw.includes('/')) return null;
  return raw as TenantId;
}

/**
 * The per-request tenant context carried via AsyncLocalStorage.
 *
 * - `tenantId` is the canonical tenant identity.
 * - `actorTenantId` is the tenant that the *acting* JWT belongs to.
 *   In a federation-consent exchange the two differ — every layer
 *   asserts on `actorTenantId === tenantId` unless a consent row is
 *   resolved via `consentBypass`.
 */
export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actorTenantId: TenantId;
  readonly requestId: string;
  readonly consentBypass?: FederationConsentBypass;
}

/**
 * A resolved federation consent that authorises a single
 * cross-tenant exchange for the lifetime of one request.
 */
export interface FederationConsentBypass {
  readonly consentId: string;
  readonly fromTenantId: TenantId;
  readonly toTenantId: TenantId;
  readonly scope: 'tools' | 'memory' | 'templates' | 'meta-learning';
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/**
 * Structured isolation-violation event. Thrown when any layer
 * detects a leak. Always serialised to the `security_events` sink.
 */
export class IsolationViolation extends Error {
  public readonly layer: IsolationLayer;
  public readonly kind: ViolationKind;
  public readonly tenantId?: TenantId | undefined;
  public readonly observedTenantId?: TenantId | undefined;
  public readonly meta: Record<string, unknown>;

  constructor(args: {
    readonly layer: IsolationLayer;
    readonly kind: ViolationKind;
    readonly message: string;
    readonly tenantId?: TenantId | undefined;
    readonly observedTenantId?: TenantId | undefined;
    readonly meta?: Record<string, unknown>;
  }) {
    super(args.message);
    this.name = 'IsolationViolation';
    this.layer = args.layer;
    this.kind = args.kind;
    this.tenantId = args.tenantId;
    this.observedTenantId = args.observedTenantId;
    this.meta = args.meta ?? {};
  }
}

export type IsolationLayer =
  | 'rls'
  | 'drizzle'
  | 'app-middleware'
  | 'redis'
  | 'storage'
  | 'log'
  | 'audit-chain';

export type ViolationKind =
  | 'missing-tenant-context'
  | 'cross-tenant-access'
  | 'unscoped-query'
  | 'unprefixed-key'
  | 'unprefixed-path'
  | 'unscoped-log'
  | 'cross-tenant-chain-link'
  | 'invalid-tenant-claim'
  | 'consent-required'
  | 'consent-expired';

/**
 * Configuration for the guard. The DEFAULT_ISOLATION_CONFIG below
 * is the locked-down production posture; tests / dev can opt-in to
 * relaxed assertions.
 */
export interface IsolationConfig {
  /**
   * When true, every layer throws IsolationViolation on detect.
   * When false, layers emit a structured warning via the logger
   * and continue (used only for the "shadow mode" rollout phase).
   */
  readonly enforce: boolean;
  /** Permit federation-consent cross-tenant exchanges. */
  readonly allowConsentBypass: boolean;
  /** Optional set of tenant ids that are allowed to share a Redis prefix. */
  readonly globalTenants: ReadonlyArray<TenantId>;
  /**
   * When true, log entries that lack tenantId in a tenant-scoped
   * file are flagged + redacted at sink time.
   */
  readonly scrubLogs: boolean;
}

export const DEFAULT_ISOLATION_CONFIG: IsolationConfig = {
  enforce: true,
  allowConsentBypass: true,
  globalTenants: [],
  scrubLogs: true,
};
