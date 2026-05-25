/**
 * Public types for @borjie/security-hardening.
 *
 * Kept in one file so consumers can import every shape from a single
 * deep path (`@borjie/security-hardening/types` later, or just from
 * the package root). All shapes are `readonly` so callers can compose
 * them through `{ ...prev, override }` without accidental mutation —
 * matches the project-wide immutability rule.
 */

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

/** RFC 4122 UUID or any opaque identifier. */
export type IdentifierString = string;

/** ISO-3166-1 alpha-2 country code, e.g. `'KE'`, `'TZ'`. */
export type CountryCode = string;

/** Multi-tenant scope — every credential / score / decision is tagged. */
export type TenantId = IdentifierString;

/** User id within a tenant. */
export type UserId = IdentifierString;

/** Risk score in [0, 1] inclusive. 0 = trusted, 1 = block. */
export type RiskScore = number;

/* -------------------------------------------------------------------------- */
/* WebAuthn / passkeys                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A persisted WebAuthn / passkey credential. Each credential is bound
 * to a specific `tenantId` so that cross-tenant credential reuse is
 * structurally impossible — the registration verifier enforces it and
 * the authentication verifier double-checks at use time.
 */
export interface WebAuthnCredential {
  readonly credentialId: string;
  readonly publicKey: string; // base64url
  readonly counter: number;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly transports?: ReadonlyArray<string>;
  readonly deviceType?: 'singleDevice' | 'multiDevice';
  readonly backedUp?: boolean;
  readonly aaguid?: string;
  readonly createdAt: number; // epoch ms
  readonly lastUsedAt?: number; // epoch ms
}

/* -------------------------------------------------------------------------- */
/* MFA / step-up                                                              */
/* -------------------------------------------------------------------------- */

export type MFAChannel = 'totp' | 'push' | 'sms' | 'webauthn';

export interface MFAChallenge {
  readonly id: IdentifierString;
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly channel: MFAChannel;
  readonly issuedAt: number; // epoch ms
  readonly expiresAt: number; // epoch ms
  readonly satisfiedAt?: number; // epoch ms
  /** Hash of the value the user must present back (TOTP code, push ack, …) */
  readonly expectedHash?: string;
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

export type RateLimitAlgorithm =
  | 'tokenBucket'
  | 'slidingWindow'
  | 'fixedWindow';

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly limit: number;
  readonly resetAt: number; // epoch ms
  readonly retryAfterMs?: number;
}

/* -------------------------------------------------------------------------- */
/* Anomaly / bot scoring                                                      */
/* -------------------------------------------------------------------------- */

export type AnomalyRecommendation = 'allow' | 'step_up' | 'block';

export interface AnomalyScore {
  readonly score: RiskScore;
  readonly factors: ReadonlyArray<string>;
  readonly recommendation: AnomalyRecommendation;
}

export interface BotScore {
  readonly score: RiskScore;
  readonly verdict: 'human' | 'suspicious' | 'bot';
  readonly signals: ReadonlyArray<string>;
}

/* -------------------------------------------------------------------------- */
/* Credential breach + session                                                */
/* -------------------------------------------------------------------------- */

export interface BreachedCredCheck {
  readonly breached: boolean;
  readonly count?: number;
  readonly source: 'hibp' | 'local' | 'unknown';
}

export interface SessionFingerprint {
  readonly sessionId: IdentifierString;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly ip: string;
  readonly userAgent: string;
  readonly deviceHash: string;
  readonly tlsFingerprint?: string;
  readonly createdAt: number; // epoch ms
  readonly lastSeenAt: number; // epoch ms
}

/* -------------------------------------------------------------------------- */
/* Browser-headers config                                                     */
/* -------------------------------------------------------------------------- */

export type SecurityHeaderEnv = 'production' | 'staging' | 'development';

export interface SecurityHeadersConfig {
  readonly env: SecurityHeaderEnv;
  /** Custom CSP — when omitted, a strict preset for `env` is used. */
  readonly csp?: string;
  /** Optional Permissions-Policy override (full header value). */
  readonly permissionsPolicy?: string;
  /** Disable HSTS — only safe in dev. */
  readonly disableHsts?: boolean;
  /** Disable COEP — needed when embedding cross-origin iframes that lack CORP. */
  readonly disableCoep?: boolean;
  /** Extra headers merged on top of the preset. */
  readonly extra?: Readonly<Record<string, string>>;
}

/* -------------------------------------------------------------------------- */
/* Geo / device inputs used by anomaly detector                               */
/* -------------------------------------------------------------------------- */

export interface GeoLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly country?: CountryCode;
  readonly timezone?: string; // IANA tz, e.g. `'Africa/Nairobi'`
}

export interface LoginAttempt {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly at: number; // epoch ms
  readonly location: GeoLocation;
  readonly deviceFingerprint: string;
}
