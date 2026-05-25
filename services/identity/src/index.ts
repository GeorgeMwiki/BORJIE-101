/**
 * @borjie/identity — services + Postgres repositories for Conflict 2
 * (Universal Tenant Identity + Multi-Org).
 *
 * Services accept injected repositories. Constructing a service without
 * deps leaves its methods rejecting with NOT_IMPLEMENTED so the existing
 * stub-era tests continue to pass until they're updated in step with the
 * real integration.
 */

export {
  TenantIdentityService,
  NotImplementedError as TenantIdentityNotImplementedError,
} from './tenant-identity.service.js';
export type {
  VerifyOtpResult,
  TenantIdentityServiceDeps,
} from './tenant-identity.service.js';

export {
  InviteCodeService,
  NotImplementedError as InviteCodeNotImplementedError,
} from './invite-code.service.js';
export type {
  GenerateInviteOptions,
  RedeemResult,
  InviteCodeServiceDeps,
} from './invite-code.service.js';

export {
  OrgMembershipService,
  NotImplementedError as OrgMembershipNotImplementedError,
} from './org-membership.service.js';
export type { OrgMembershipServiceDeps } from './org-membership.service.js';

// Postgres repositories
export {
  PostgresTenantIdentityRepository,
} from './postgres-tenant-identity-repository.js';
export type {
  CreateTenantIdentityInput,
  UpdateTenantIdentityInput,
  TenantIdentityRepositoryClient,
} from './postgres-tenant-identity-repository.js';

export {
  PostgresOrgMembershipRepository,
  DefaultUserShadowWriter,
} from './postgres-org-membership-repository.js';
export type {
  CreateMembershipInput,
  OrgMembershipRepositoryClient,
  ShadowUserInput,
  UserShadowWriter,
} from './postgres-org-membership-repository.js';

export {
  PostgresInviteCodeRepository,
} from './postgres-invite-code-repository.js';
export type {
  GenerateOptions,
  InviteCodeRepositoryClient,
  RedeemerProfile,
  RedeemResult as InviteCodeRedeemResult,
} from './postgres-invite-code-repository.js';

// OTP
export {
  OtpService,
  InMemoryOtpStore,
  NoopSmsDispatcher,
  OtpResendThrottledError,
  OTP_LENGTH,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_RESEND_MAX_PER_WINDOW,
  OTP_RESEND_WINDOW_MS,
} from './otp/otp-service.js';
export type {
  OtpRecord,
  OtpStore,
  OtpVerifyResult,
  SmsDispatcher,
} from './otp/otp-service.js';

// Phone normalization helper
export { normalizePhoneForCountry } from './phone-normalize.js';

// Notifications-backed SMS dispatcher (for production wiring)
export { NotificationsSmsDispatcher } from './otp/notifications-sms-dispatcher.js';
