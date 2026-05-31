/**
 * /api/v1/orgs/signup — Owner / Admin self-signup endpoint.
 *
 * Implements the public discriminated-union signup flow for INDIVIDUAL
 * (artisanal owner) vs BUSINESS (registered company) tenants. One
 * endpoint produces:
 *
 *   1. A Supabase auth user (admin-API created, OTP-verified later).
 *   2. A `tenants` row with the new `account_kind` discriminator and
 *      the locale beachhead (`country`, `default_language`,
 *      `primary_currency`) + KYC atoms.
 *   3. A `users` row (mining_role='owner', is_owner=true) linked to the
 *      Supabase user via `supabase_user_id` in `app_metadata`.
 *   4. A persona binding to `T1_owner_strategist` (HIGH-risk policy —
 *      hits literal policy rules per CLAUDE.md).
 *   5. A hash-chained audit-trail entry per signup.
 *
 * The endpoint runs WITHOUT a tenant context — it is the act of
 * creating one. The DI surface (`SignupDeps`) lets tests inject a
 * stub Supabase admin, a stub DB writer, a stub persona binder, and a
 * stub audit-chain so we never need a live Supabase / Postgres to
 * exercise the contract.
 *
 * Errors:
 *   - 400 invalid_body            zod parse failure (per-issue messages)
 *   - 409 email_already_registered duplicate normalized email
 *   - 409 phone_already_registered duplicate normalized phone
 *   - 503 auth_provider_unavailable Supabase admin call failed
 *
 * Mounted under `/api/v1/orgs` via the barrel `./index.ts`.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'crypto';

import {
  buildSessionCookieHeader,
  encodeSessionCookie,
} from '../../auth/public/session-cookie.js';

// ─── Wire-level constants ────────────────────────────────────────────

const COUNTRY_CODES = ['TZ', 'KE', 'UG', 'NG', 'OTHER'] as const;
const CURRENCY_CODES = ['TZS', 'USD', 'KES', 'UGX', 'NGN'] as const;
const LANGUAGE_CODES = ['sw', 'en'] as const;

const OWNER_PERSONA_SLUG = 'T1_owner_strategist';

// ─── Zod — discriminated union ──────────────────────────────────────

const PhoneE164 = z
  .string()
  .min(8)
  .max(20)
  .regex(/^\+?[1-9][0-9]{6,19}$/u, 'phone must be E.164');

const Email = z.string().email().max(254);

const IndividualSignup = z.object({
  kind: z.literal('individual'),
  country: z.enum(COUNTRY_CODES),
  fullName: z.string().min(2).max(120),
  phoneE164: PhoneE164,
  email: Email,
  miningLicenceNumber: z.string().min(1).max(64).optional(),
  nationalIdNumber: z.string().min(1).max(64).optional(),
  defaultLanguage: z.enum(LANGUAGE_CODES),
  primaryCurrency: z.enum(CURRENCY_CODES),
});

const BusinessSignup = z.object({
  kind: z.literal('business'),
  country: z.enum(COUNTRY_CODES),
  orgName: z.string().min(2).max(160),
  businessRegistrationNumber: z.string().min(1).max(64),
  taxId: z.string().min(1).max(64),
  ownerEmail: Email,
  ownerFullName: z.string().min(2).max(120),
  ownerPhoneE164: PhoneE164,
  miningLicenceNumber: z.string().min(1).max(64).optional(),
  vatNumber: z.string().min(1).max(64).optional(),
  defaultLanguage: z.enum(LANGUAGE_CODES),
  primaryCurrency: z.enum(CURRENCY_CODES),
});

export const SignupRequestSchema = z.discriminatedUnion('kind', [
  IndividualSignup,
  BusinessSignup,
]);
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

/**
 * Marketing-form schema — the shape the public sign-up page POSTs.
 * Discriminated-union-free; password is required so we can immediately
 * issue a Supabase password-grant session and set the `borjie-session`
 * cookie at the same time as creating the tenant. Adapter at runtime
 * lifts this onto the canonical discriminated union before calling the
 * shared writer pipeline.
 */
export const MarketingSignupRequestSchema = z.object({
  orgName: z.string().min(2).max(160),
  ownerEmail: z.string().email().max(254),
  ownerPassword: z.string().min(8).max(200),
  country: z.enum(COUNTRY_CODES).default('TZ'),
  ownerFullName: z.string().min(2).max(120).optional(),
  phoneNumber: z.string().min(8).max(20).optional(),
  marketingConsent: z.boolean().optional(),
  defaultLanguage: z.enum(LANGUAGE_CODES).optional(),
  primaryCurrency: z.enum(CURRENCY_CODES).optional(),
});
export type MarketingSignupRequest = z.infer<typeof MarketingSignupRequestSchema>;

// ─── DI surface ──────────────────────────────────────────────────────

export interface SupabaseAdminUser {
  readonly id: string;
  readonly email: string;
  readonly phone: string;
}

export interface SupabaseAdmin {
  /**
   * Creates a Supabase auth user. Returns 409-equivalent if the email
   * or phone is already registered.
   *
   * The optional `password` field is set by the marketing-form flow so
   * the user can immediately receive a session cookie rather than going
   * through the phone-OTP detour. When unset (the discriminated-union
   * flow) Supabase generates a random temporary password and the user
   * must complete OTP / magic-link to obtain credentials.
   *
   * `emailConfirm: true` is set only when called from the password-grant
   * path so a subsequent sign-in succeeds without manual email
   * verification — the marketing form is the user proving control of
   * the email (Supabase emails them anyway for receipt + recovery).
   */
  createUser(input: {
    readonly email: string;
    readonly phone: string;
    readonly password?: string;
    readonly emailConfirm?: boolean;
    readonly appMetadata: Readonly<Record<string, unknown>>;
    readonly userMetadata: Readonly<Record<string, unknown>>;
  }): Promise<
    | { readonly ok: true; readonly user: SupabaseAdminUser }
    | { readonly ok: false; readonly reason: 'duplicate_email' | 'duplicate_phone' | 'provider_unavailable' }
  >;
  /**
   * Triggers the phone-OTP delivery for a freshly-created user.
   * Fail-soft — signup still succeeds if OTP can't be sent (the
   * caller surfaces `otpRequired` so the wizard can retry).
   */
  sendPhoneOtp(input: { readonly phone: string }): Promise<{ readonly delivered: boolean }>;
  /**
   * Marketing-form flow only — exchanges email+password for a Supabase
   * session immediately after createUser succeeds. Optional so the
   * canonical OTP flow can leave this null and the marketing branch
   * gracefully degrades to "tenant created but not signed in" when
   * the deps don't bind it.
   */
  signInWithPassword?(input: { readonly email: string; readonly password: string }): Promise<
    | {
        readonly ok: true;
        readonly accessToken: string;
        readonly refreshToken: string;
        readonly expiresAt: number;
      }
    | { readonly ok: false; readonly reason: 'invalid_credentials' | 'provider_unavailable' }
  >;
}

export interface CreatedTenant {
  readonly tenantId: string;
  readonly ownerUserId: string;
}

export interface TenantWriter {
  /**
   * Atomically inserts the tenants row + owner user row. The writer
   * runs OUTSIDE a tenant context (RLS bound to the signup-mode
   * session that elevates only this exact insert). Implementations
   * must enforce that.
   */
  createTenantAndOwner(input: {
    readonly tenantId: string;
    readonly ownerUserId: string;
    readonly supabaseUserId: string;
    readonly accountKind: 'individual' | 'business';
    readonly country: (typeof COUNTRY_CODES)[number];
    readonly defaultLanguage: (typeof LANGUAGE_CODES)[number];
    readonly primaryCurrency: (typeof CURRENCY_CODES)[number];
    readonly orgName: string;
    readonly slug: string;
    readonly ownerEmail: string;
    readonly ownerPhone: string;
    readonly ownerFirstName: string;
    readonly ownerLastName: string;
    readonly miningLicenceNumber: string | null;
    readonly businessRegistrationNumber: string | null;
    readonly taxId: string | null;
    readonly vatNumber: string | null;
    readonly nationalIdNumber: string | null;
  }): Promise<CreatedTenant>;
}

export interface PersonaBinder {
  /**
   * Binds the canonical T1_owner_strategist persona for a new owner.
   * HIGH-risk policy prefix per CLAUDE.md — the implementation MUST
   * hit literal policy rules (no reason-resolver generalisation).
   */
  bindOwnerPersona(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly personaSlug: typeof OWNER_PERSONA_SLUG;
  }): Promise<void>;
}

export interface AuditChainWriter {
  /**
   * Appends a hash-chained entry recording the signup. Append-only,
   * never mutated.
   */
  appendSignupEntry(input: {
    readonly tenantId: string;
    readonly ownerUserId: string;
    readonly accountKind: 'individual' | 'business';
    readonly country: (typeof COUNTRY_CODES)[number];
    readonly kycAtomsInitialized: ReadonlyArray<string>;
  }): Promise<void>;
}

export interface SignupLogger {
  info(message: string, meta?: Readonly<Record<string, unknown>>): void;
  warn(message: string, meta?: Readonly<Record<string, unknown>>): void;
  error(message: string, meta?: Readonly<Record<string, unknown>>): void;
}

export interface SignupDeps {
  readonly supabaseAdmin: SupabaseAdmin;
  readonly tenantWriter: TenantWriter;
  readonly personaBinder: PersonaBinder;
  readonly auditChain: AuditChainWriter;
  readonly logger: SignupLogger;
  /** ID + slug factories — pluggable so tests are deterministic. */
  readonly newTenantId: () => string;
  readonly newUserId: () => string;
  readonly newSlug: (seed: string) => string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function splitFullName(fullName: string): {
  readonly firstName: string;
  readonly lastName: string;
} {
  const parts = fullName.trim().split(/\s+/u);
  if (parts.length === 1) {
    return { firstName: parts[0] ?? '', lastName: '' };
  }
  const first = parts.slice(0, -1).join(' ');
  const last = parts.at(-1) ?? '';
  return { firstName: first, lastName: last };
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/gu, '');
}

function defaultSlug(seed: string): string {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  if (base.length === 0) return `t-${Date.now()}`;
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

function kycAtomsInitializedFor(kind: 'individual' | 'business'): ReadonlyArray<string> {
  if (kind === 'individual') {
    return ['national_id_pending', 'address_pending'] as const;
  }
  return ['brela_pending', 'tin_pending', 'beneficial_owner_pending'] as const;
}

// ─── Router factory ──────────────────────────────────────────────────

/**
 * Detect whether the incoming JSON looks like the marketing-form shape
 * (orgName + ownerEmail + ownerPassword) vs the canonical discriminated
 * union shape (`kind: 'individual' | 'business'`). The marketing form
 * does not set `kind` — its presence is the distinguishing signal.
 */
function looksLikeMarketingShape(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.kind === 'string') return false;
  return (
    typeof o.orgName === 'string' &&
    typeof o.ownerEmail === 'string' &&
    typeof o.ownerPassword === 'string'
  );
}

/**
 * Lift a marketing-form body onto the canonical SignupRequest shape so
 * the existing writer pipeline runs unchanged. The marketing form
 * collects fewer fields — we synthesise sensible defaults rather than
 * forcing every form to ship every field.
 */
function liftMarketingToCanonical(
  body: MarketingSignupRequest,
): { canonical: SignupRequest; password: string; phoneE164: string } {
  const fullName = body.ownerFullName ?? body.ownerEmail.split('@')[0] ?? 'Owner';
  // Marketing form may pass a free-form phone — strip non-digits and
  // require leading + via the canonical E.164 regex. When the field is
  // omitted we synthesise a placeholder the operator can replace later
  // (Supabase phone is optional on createUser).
  const phoneE164 = body.phoneNumber
    ? body.phoneNumber.replace(/[^\d+]/g, '')
    : '+10000000000';
  const country = body.country;
  // English default per CLAUDE.md "English default · bilingual sw/en"
  // (flipped 2026-05). Tanzanian operators can toggle to `sw` from
  // the settings panel after signup; toggle is absolute. We no longer
  // seed `sw` based on the country code.
  const defaultLanguage = body.defaultLanguage ?? 'en';
  const primaryCurrency =
    body.primaryCurrency ??
    (country === 'TZ'
      ? 'TZS'
      : country === 'KE'
        ? 'KES'
        : country === 'UG'
          ? 'UGX'
          : country === 'NG'
            ? 'NGN'
            : 'USD');
  const canonical: SignupRequest = {
    kind: 'business',
    country,
    orgName: body.orgName,
    businessRegistrationNumber: 'PENDING',
    taxId: 'PENDING',
    ownerEmail: body.ownerEmail,
    ownerFullName: fullName,
    ownerPhoneE164: phoneE164,
    defaultLanguage,
    primaryCurrency,
  };
  return { canonical, password: body.ownerPassword, phoneE164 };
}

export function createSignupRouter(deps: SignupDeps): Hono {
  const app = new Hono();

  app.post('/signup', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'invalid_body', message: 'request body must be valid JSON' },
        400,
      );
    }

    // Branch: marketing-form shape (orgName + ownerEmail + ownerPassword)
    // vs canonical discriminated union (kind: individual|business).
    let body: SignupRequest;
    let marketingPassword: string | null = null;
    if (looksLikeMarketingShape(raw)) {
      const parsedMarketing = MarketingSignupRequestSchema.safeParse(raw);
      if (!parsedMarketing.success) {
        return c.json(
          {
            error: 'invalid_body',
            issues: parsedMarketing.error.issues.map((i) => ({
              path: i.path.join('.'),
              code: i.code,
              message: i.message,
            })),
          },
          400,
        );
      }
      const lifted = liftMarketingToCanonical(parsedMarketing.data);
      body = lifted.canonical;
      marketingPassword = lifted.password;
    } else {
      const parsed = SignupRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          {
            error: 'invalid_body',
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join('.'),
              code: i.code,
              message: i.message,
            })),
          },
          400,
        );
      }
      body = parsed.data;
    }

    // ── Derived facts ────────────────────────────────────────────────
    const tenantId = deps.newTenantId();
    const ownerUserId = deps.newUserId();
    const accountKind = body.kind;
    const country = body.country;
    const defaultLanguage = body.defaultLanguage;
    const primaryCurrency = body.primaryCurrency;

    const ownerEmail =
      body.kind === 'individual'
        ? normalizeEmail(body.email)
        : normalizeEmail(body.ownerEmail);
    const ownerPhone =
      body.kind === 'individual'
        ? normalizePhone(body.phoneE164)
        : normalizePhone(body.ownerPhoneE164);
    const ownerFullName =
      body.kind === 'individual' ? body.fullName : body.ownerFullName;
    const { firstName, lastName } = splitFullName(ownerFullName);

    const orgName =
      body.kind === 'individual' ? body.fullName : body.orgName;
    const slug = deps.newSlug(orgName);

    const miningLicenceNumber = body.miningLicenceNumber ?? null;
    const businessRegistrationNumber =
      body.kind === 'business' ? body.businessRegistrationNumber : null;
    const taxId = body.kind === 'business' ? body.taxId : null;
    const vatNumber = body.kind === 'business' ? body.vatNumber ?? null : null;
    const nationalIdNumber =
      body.kind === 'individual' ? body.nationalIdNumber ?? null : null;

    // ── 1. Supabase auth user ────────────────────────────────────────
    // Marketing flow passes the user-chosen password through so we can
    // immediately mint a session cookie after the tenant lands. Email
    // is auto-confirmed in that path because the form IS the proof of
    // email control; the canonical OTP flow leaves both unset.
    // `exactOptionalPropertyTypes` requires the password field be
    // omitted entirely when undefined — spread the optional in.
    const created = await deps.supabaseAdmin.createUser({
      email: ownerEmail,
      phone: ownerPhone,
      ...(marketingPassword !== null
        ? { password: marketingPassword, emailConfirm: true }
        : {}),
      appMetadata: {
        tenant_id: tenantId,
        mining_role: 'owner',
        account_kind: accountKind,
      },
      userMetadata: {
        full_name: ownerFullName,
        default_language: defaultLanguage,
        country,
      },
    });
    if (!created.ok) {
      if (created.reason === 'duplicate_email') {
        return c.json(
          {
            error: 'email_already_registered',
            message: 'an account with this email already exists',
          },
          409,
        );
      }
      if (created.reason === 'duplicate_phone') {
        return c.json(
          {
            error: 'phone_already_registered',
            message: 'an account with this phone already exists',
          },
          409,
        );
      }
      deps.logger.error('signup.supabase_admin_unavailable', {
        tenantId,
        accountKind,
      });
      return c.json(
        {
          error: 'auth_provider_unavailable',
          message: 'auth provider temporarily unavailable',
        },
        503,
      );
    }

    // ── 2. tenants + users rows (atomic) ─────────────────────────────
    try {
      await deps.tenantWriter.createTenantAndOwner({
        tenantId,
        ownerUserId,
        supabaseUserId: created.user.id,
        accountKind,
        country,
        defaultLanguage,
        primaryCurrency,
        orgName,
        slug,
        ownerEmail,
        ownerPhone,
        ownerFirstName: firstName,
        ownerLastName: lastName,
        miningLicenceNumber,
        businessRegistrationNumber,
        taxId,
        vatNumber,
        nationalIdNumber,
      });
    } catch (err) {
      deps.logger.error('signup.tenant_write_failed', {
        tenantId,
        accountKind,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          error: 'tenant_write_failed',
          message: 'failed to persist tenant during signup',
        },
        503,
      );
    }

    // ── 3. Persona binding (HIGH-risk literal policy) ────────────────
    try {
      await deps.personaBinder.bindOwnerPersona({
        tenantId,
        userId: ownerUserId,
        personaSlug: OWNER_PERSONA_SLUG,
      });
    } catch (err) {
      // Persona binding failure must NOT silently succeed — the owner
      // would land in a session without the strategist tools. Fail
      // closed.
      deps.logger.error('signup.persona_bind_failed', {
        tenantId,
        ownerUserId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          error: 'persona_bind_failed',
          message: 'failed to bind owner persona',
        },
        503,
      );
    }

    // ── 4. Hash-chain audit ──────────────────────────────────────────
    const kycAtomsInitialized = kycAtomsInitializedFor(accountKind);
    try {
      await deps.auditChain.appendSignupEntry({
        tenantId,
        ownerUserId,
        accountKind,
        country,
        kycAtomsInitialized,
      });
    } catch (err) {
      // Audit failures are observable but non-fatal at signup — the
      // alternative is to roll back a real user and the tenant they
      // just paid for. Log loud and continue.
      deps.logger.warn('signup.audit_append_failed', {
        tenantId,
        ownerUserId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── 5. OTP / session establishment ───────────────────────────────
    // Marketing flow: exchange the just-set password for a Supabase
    // session and ship the encrypted cookie back so the user lands
    // already signed-in. We skip the phone-OTP delivery because the
    // marketing form doesn't collect a verified phone.
    if (marketingPassword !== null) {
      const signIn = await deps.supabaseAdmin
        .signInWithPassword?.({
          email: ownerEmail,
          password: marketingPassword,
        })
        .catch((err) => {
          deps.logger.warn('signup.password_grant_failed', {
            tenantId,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        });

      let cookieIssued = false;
      let sessionPayload: {
        access_token: string;
        refresh_token: string;
        expires_at: number;
      } | null = null;

      if (signIn?.ok) {
        sessionPayload = {
          access_token: signIn.accessToken,
          refresh_token: signIn.refreshToken,
          expires_at: signIn.expiresAt,
        };
        try {
          const cookieValue = encodeSessionCookie({
            accessToken: signIn.accessToken,
            refreshToken: signIn.refreshToken,
            expiresAt: signIn.expiresAt,
            userId: created.user.id,
            email: ownerEmail,
            tenantId,
          });
          c.header(
            'Set-Cookie',
            buildSessionCookieHeader(cookieValue, {
              maxAgeSeconds: Math.max(
                60,
                signIn.expiresAt - Math.floor(Date.now() / 1000),
              ),
            }),
          );
          cookieIssued = true;
        } catch (err) {
          deps.logger.warn('signup.cookie_emit_failed', {
            tenantId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      deps.logger.info('signup.complete_marketing', {
        tenantId,
        accountKind,
        country,
        cookieIssued,
        sessionEstablished: Boolean(sessionPayload),
      });

      return c.json(
        {
          success: true,
          tenantId,
          ownerId: ownerUserId,
          kind: accountKind,
          signupStatus: sessionPayload ? 'active' : 'pending_sign_in',
          kycAtomsInitialized,
          session: sessionPayload,
        },
        201,
      );
    }

    // Canonical (discriminated-union) flow: best-effort phone OTP +
    // pending_otp_verification status, unchanged.
    const otp = await deps.supabaseAdmin.sendPhoneOtp({ phone: ownerPhone });
    if (!otp.delivered) {
      deps.logger.warn('signup.otp_not_delivered', { tenantId });
    }

    deps.logger.info('signup.complete', {
      tenantId,
      accountKind,
      country,
    });

    return c.json(
      {
        tenantId,
        ownerUserId,
        kind: accountKind,
        signupStatus: 'pending_otp_verification',
        otpRequired: true,
        kycAtomsInitialized,
      },
      201,
    );
  });

  return app;
}

// ─── Default factories ───────────────────────────────────────────────

/**
 * Default tenant-id factory. Format `tn_<uuidv4>` so existing callers
 * that match `/^tn_/` (see onboarding-flow tests) continue to pass.
 */
export function newTenantIdDefault(): string {
  return `tn_${randomUUID()}`;
}

/**
 * Default user-id factory. Format `usr_<uuidv4>` to match the existing
 * onboarding-flow convention.
 */
export function newUserIdDefault(): string {
  return `usr_${randomUUID()}`;
}

export const defaultSlugFactory = defaultSlug;
