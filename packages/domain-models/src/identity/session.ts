/**
 * Session Domain Model
 * 
 * Sessions represent authenticated user sessions with token management,
 * device tracking, and activity monitoring.
 */

import type {
  TenantId,
  UserId,
  SessionId,
  TenantScoped,
  ISOTimestamp,
} from '../common/types.js';

/** Session status */
export const SessionStatus = {
  /** Session is active */
  ACTIVE: 'ACTIVE',
  /** Session has expired */
  EXPIRED: 'EXPIRED',
  /** Session was explicitly revoked */
  REVOKED: 'REVOKED',
  /** Session is pending MFA verification */
  PENDING_MFA: 'PENDING_MFA',
} as const;

export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/** Authentication method used to create the session */
export const AuthMethod = {
  /** Standard email/password */
  PASSWORD: 'PASSWORD',
  /** Single sign-on */
  SSO: 'SSO',
  /** API key authentication */
  API_KEY: 'API_KEY',
  /** OAuth provider */
  OAUTH: 'OAUTH',
  /** Magic link */
  MAGIC_LINK: 'MAGIC_LINK',
  /** Impersonation (admin acting as user) */
  IMPERSONATION: 'IMPERSONATION',
} as const;

export type AuthMethod = (typeof AuthMethod)[keyof typeof AuthMethod];

/** Device information */
export interface DeviceInfo {
  readonly userAgent: string;
  readonly browser: string | null;
  readonly browserVersion: string | null;
  readonly os: string | null;
  readonly osVersion: string | null;
  readonly deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  readonly deviceName: string | null;
}

/** Geolocation information */
export interface GeoLocation {
  readonly ip: string;
  readonly country: string | null;
  readonly countryCode: string | null;
  readonly region: string | null;
  readonly city: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly timezone: string | null;
}

/** Core Session entity */
export interface Session extends TenantScoped {
  readonly id: SessionId;
  readonly userId: UserId;
  /** Current status */
  readonly status: SessionStatus;
  /** Authentication method used */
  readonly authMethod: AuthMethod;
  /** JWT token ID (jti claim) */
  readonly tokenId: string;
  /** Refresh token hash */
  readonly refreshTokenHash: string;
  /** Session creation timestamp */
  readonly createdAt: ISOTimestamp;
  /** Session expiration timestamp */
  readonly expiresAt: ISOTimestamp;
  /** Last activity timestamp */
  readonly lastActivityAt: ISOTimestamp;
  /** Last activity IP address */
  readonly lastActivityIp: string;
  /** MFA verification status */
  readonly mfaVerified: boolean;
  /** MFA verification timestamp */
  readonly mfaVerifiedAt: ISOTimestamp | null;
  /** Device information */
  readonly device: DeviceInfo;
  /** Geolocation at session creation */
  readonly location: GeoLocation | null;
  /** Impersonator user ID (if impersonating) */
  readonly impersonatorId: UserId | null;
  /** Revocation reason (if revoked) */
  readonly revocationReason: string | null;
  /** Revoked by user ID (if revoked) */
  readonly revokedBy: UserId | null;
  /** Revocation timestamp */
  readonly revokedAt: ISOTimestamp | null;
}

/** Input for creating a session */
export interface CreateSessionInput {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly authMethod: AuthMethod;
  readonly device: DeviceInfo;
  readonly location?: GeoLocation;
  readonly expiresInMs: number;
  readonly impersonatorId?: UserId;
}

/** Session with user details */
export interface SessionWithUser extends Session {
  readonly user: {
    readonly email: string;
    readonly displayName: string;
    readonly type: string;
  };
}

/** Token pair returned after authentication */
export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: ISOTimestamp;
  readonly refreshTokenExpiresAt: ISOTimestamp;
  readonly tokenType: 'Bearer';
}

/** JWT claims for access token */
export interface AccessTokenClaims {
  /** Subject (user ID) */
  readonly sub: string;
  /** Tenant ID */
  readonly tid: string;
  /** Session ID */
  readonly sid: string;
  /** Token ID (unique per token) */
  readonly jti: string;
  /** Issued at */
  readonly iat: number;
  /** Expiration */
  readonly exp: number;
  /** Issuer */
  readonly iss: string;
  /** Audience */
  readonly aud: string | string[];
  /** User type */
  readonly utype: string;
  /** MFA verified */
  readonly mfa: boolean;
  /** Impersonator ID (if impersonating) */
  readonly imp?: string;
}

/** Refresh token claims */
export interface RefreshTokenClaims {
  readonly sub: string;
  readonly tid: string;
  readonly sid: string;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
  readonly type: 'refresh';
}

/** Check if session is valid for use */
export function isSessionValid(session: Session): boolean {
  if (session.status !== SessionStatus.ACTIVE) {
    return false;
  }
  return new Date(session.expiresAt) > new Date();
}

/** Check if session requires MFA verification */
export function sessionRequiresMfa(session: Session): boolean {
  return session.status === SessionStatus.PENDING_MFA && !session.mfaVerified;
}

/** Check if session is impersonated */
export function isImpersonatedSession(session: Session): boolean {
  return session.impersonatorId !== null;
}

/** Session constants */
export const SESSION_CONSTANTS = {
  /** Default access token lifetime (15 minutes) */
  ACCESS_TOKEN_LIFETIME_MS: 15 * 60 * 1000,
  /** Default refresh token lifetime (7 days) */
  REFRESH_TOKEN_LIFETIME_MS: 7 * 24 * 60 * 60 * 1000,
  /** Maximum concurrent sessions per user */
  MAX_CONCURRENT_SESSIONS: 10,
  /** Session activity timeout for auto-logout (30 minutes) */
  ACTIVITY_TIMEOUT_MS: 30 * 60 * 1000,
  /** Refresh token rotation: new token issued if old one is more than X old */
  REFRESH_TOKEN_ROTATION_THRESHOLD_MS: 24 * 60 * 60 * 1000,
} as const;

/** Parse device info from user agent string */
export function parseUserAgent(userAgent: string): DeviceInfo {
  // Basic parsing - in production use a proper UA parser library
  const isMobile = /mobile/i.test(userAgent);
  const isTablet = /tablet|ipad/i.test(userAgent);
  
  let deviceType: DeviceInfo['deviceType'] = 'unknown';
  if (isTablet) deviceType = 'tablet';
  else if (isMobile) deviceType = 'mobile';
  else if (userAgent) deviceType = 'desktop';
  
  return {
    userAgent,
    browser: null,
    browserVersion: null,
    os: null,
    osVersion: null,
    deviceType,
    deviceName: null,
  };
}
