/**
 * /api/v1/buyers/signup — Buyer self-signup endpoint.
 *
 * Implements the public discriminated-union signup flow for INDIVIDUAL
 * (personal-capacity mineral buyer) vs BUSINESS (refiner / broker /
 * fabricator / investor). One endpoint produces:
 *
 *   1. A Supabase auth user (admin-API created, phone-OTP triggered).
 *   2. A fresh buyer-tenant id — buyers are tenants in their own right,
 *      separate from miner tenants by design so a single buyer can
 *      cross-cut multiple miner counterparties without inheriting one
 *      miner's RLS scope.
 *   3. A `buyers` row carrying the new self-signup columns from
 *      migration 0087 (`account_kind`, `business_kind`, `org_name`,
 *      `preferred_currency`, `preferred_language`, `full_name`,
 *      `kyc_atoms_completed`, etc.).
 *   4. Supabase app_metadata: `{ tenant_id, mining_role: 'buyer_org_admin',
 *      account_kind }`.
 *   5. A persona binding to `T5_customer_concierge` — the canonical buyer
 *      persona.
 *   6. An initialised KYC atom chain (different list per kind — see
 *      `initialKycAtomsFor` in buyer-extensions.schema.ts).
 *   7. A hash-chained audit-trail entry recording the signup.
 *
 * The endpoint runs WITHOUT a tenant context — it is the act of creating
 * one. The DI surface (`BuyerSignupDeps`) lets the composition root inject
 * the real Supabase admin / Drizzle writer / persona binder / audit chain;
 * tests inject stubs.
 *
 * Errors:
 *   - 400 invalid_body              zod parse failure (per-issue messages)
 *   - 409 phone_already_registered  Supabase reports duplicate phone
 *   - 409 email_already_registered  Supabase reports duplicate email
 *   - 503 auth_provider_unavailable Supabase admin SDK missing / down
 *   - 503 buyer_write_failed        Drizzle insert failed
 *   - 503 persona_bind_failed       persona binder threw (fail-closed)
 *
 * Mounted under `/api/v1/buyers` via the barrel `./index.ts`.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import {
  BUYER_ACCOUNT_KINDS,
  BUYER_BUSINESS_KINDS,
  BUYER_COUNTRY_CODES,
  BUYER_CURRENCY_CODES,
  BUYER_LANGUAGE_CODES,
  initialKycAtomsFor,
} from '@borjie/database';
import type {
  BuyerAccountKind,
  BuyerCountryCode,
  BuyerCurrencyCode,
  BuyerLanguageCode,
  BuyerBusinessKind,
  BuyerKycAtom,
} from '@borjie/database/schemas';

// ─── Wire-level constants ────────────────────────────────────────────

const BUYER_PERSONA_SLUG = 'T5_customer_concierge';
const BUYER_MINING_ROLE = 'buyer_org_admin';

// ─── Zod — discriminated union ──────────────────────────────────────

const PhoneE164 = z
  .string()
  .min(8)
  .max(20)
  .regex(/^\+?[1-9][0-9]{6,19}$/u, 'phone must be E.164');

const Email = z.string().email().max(254);

const IndividualBuyerSignup = z.object({
  kind: z.literal('individual'),
  country: z.enum(BUYER_COUNTRY_CODES),
  fullName: z.string().min(2).max(120),
  phoneE164: PhoneE164,
  email: Email,
  preferredCurrency: z.enum(BUYER_CURRENCY_CODES),
  preferredLanguage: z.enum(BUYER_LANGUAGE_CODES),
  nationalIdNumber: z.string().min(1).max(64).optional(),
});

const BusinessBuyerSignup = z.object({
  kind: z.literal('business'),
  country: z.enum(BUYER_COUNTRY_CODES),
  orgName: z.string().min(2).max(160),
  businessKind: z.enum(BUYER_BUSINESS_KINDS),
  businessRegistrationNumber: z.string().min(1).max(64),
  taxId: z.string().min(1).max(64),
  contactFullName: z.string().min(2).max(120),
  contactPhoneE164: PhoneE164,
  contactEmail: Email,
  preferredCurrency: z.enum(BUYER_CURRENCY_CODES),
  preferredLanguage: z.enum(BUYER_LANGUAGE_CODES),
});

export const BuyerSignupRequestSchema = z.discriminatedUnion('kind', [
  IndividualBuyerSignup,
  BusinessBuyerSignup,
]);
export type BuyerSignupRequest = z.infer<typeof BuyerSignupRequestSchema>;

// ─── DI surface ──────────────────────────────────────────────────────

export interface SupabaseBuyerUser {
  readonly id: string;
  readonly email: string;
  readonly phone: string;
}

export type SupabaseBuyerCreateResult =
  | { readonly ok: true; readonly user: SupabaseBuyerUser }
  | {
      readonly ok: false;
      readonly reason:
        | 'duplicate_email'
        | 'duplicate_phone'
        | 'provider_unavailable';
    };

export interface SupabaseBuyerAdmin {
  /**
   * Creates a Supabase auth user. Returns a structured result so the
   * handler can distinguish duplicate-email / duplicate-phone (409) from
   * a transient provider outage (503).
   */
  createUser(input: {
    readonly email: string;
    readonly phone: string;
    readonly appMetadata: Readonly<Record<string, unknown>>;
    readonly userMetadata: Readonly<Record<string, unknown>>;
  }): Promise<SupabaseBuyerCreateResult>;

  /**
   * Triggers phone-OTP delivery. Best-effort: the signup completes even
   * if OTP can't be sent (the wizard retries from the `done` screen).
   */
  sendPhoneOtp(input: {
    readonly phone: string;
  }): Promise<{ readonly delivered: boolean }>;
}

export interface CreatedBuyer {
  readonly buyerOrgId: string;
  readonly tenantId: string;
}

export interface BuyerWriter {
  /**
   * Persists the buyers row + binds the tenant. Implementations may run
   * the insert under a fresh tenant context (the signup mode that
   * elevates only this exact write); the route delegates that concern.
   */
  createBuyerOrg(input: {
    readonly buyerOrgId: string;
    readonly tenantId: string;
    readonly supabaseUserId: string;
    readonly accountKind: BuyerAccountKind;
    readonly businessKind: BuyerBusinessKind | null;
    readonly country: BuyerCountryCode;
    readonly preferredCurrency: BuyerCurrencyCode;
    readonly preferredLanguage: BuyerLanguageCode;
    readonly orgName: string | null;
    readonly fullName: string;
    readonly displayName: string;
    readonly contactEmail: string;
    readonly contactPhone: string;
    readonly nationalIdNumber: string | null;
    readonly taxId: string | null;
    readonly businessRegistrationNumber: string | null;
    readonly kycAtomsInitialized: ReadonlyArray<BuyerKycAtom>;
  }): Promise<CreatedBuyer>;
}

export interface BuyerPersonaBinder {
  /**
   * Binds the canonical T5_customer_concierge persona for a new buyer.
   * Fail-closed — a binding failure must NOT silently succeed (the buyer
   * would land in a session without their tools).
   */
  bindBuyerPersona(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly personaSlug: typeof BUYER_PERSONA_SLUG;
    readonly accountKind: BuyerAccountKind;
  }): Promise<void>;
}

export interface BuyerAuditChainWriter {
  /**
   * Appends a hash-chained signup entry. Append-only, never mutated.
   */
  appendSignupEntry(input: {
    readonly tenantId: string;
    readonly buyerOrgId: string;
    readonly userId: string;
    readonly accountKind: BuyerAccountKind;
    readonly businessKind: BuyerBusinessKind | null;
    readonly country: BuyerCountryCode;
    readonly kycAtomsInitialized: ReadonlyArray<BuyerKycAtom>;
  }): Promise<void>;
}

export interface BuyerSignupLogger {
  info(message: string, meta?: Readonly<Record<string, unknown>>): void;
  warn(message: string, meta?: Readonly<Record<string, unknown>>): void;
  error(message: string, meta?: Readonly<Record<string, unknown>>): void;
}

export interface BuyerSignupDeps {
  readonly supabaseAdmin: SupabaseBuyerAdmin;
  readonly buyerWriter: BuyerWriter;
  readonly personaBinder: BuyerPersonaBinder;
  readonly auditChain: BuyerAuditChainWriter;
  readonly logger: BuyerSignupLogger;
  /** ID factories — pluggable for deterministic tests. */
  readonly newTenantId: () => string;
  readonly newBuyerOrgId: () => string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/gu, '');
}

// ─── Router factory ──────────────────────────────────────────────────

export function createBuyerSignupRouter(deps: BuyerSignupDeps): Hono {
  const app = new Hono();

  app.post('/signup', async (c) => {
    // 1. Parse JSON body — distinguish malformed JSON from zod failure.
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        {
          error: 'invalid_body',
          message: 'request body must be valid JSON',
        },
        400,
      );
    }

    const parsed = BuyerSignupRequestSchema.safeParse(raw);
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
    const body = parsed.data;

    // 2. Derived facts — kind-specific projections.
    const tenantId = deps.newTenantId();
    const buyerOrgId = deps.newBuyerOrgId();
    const accountKind: BuyerAccountKind = body.kind;
    const country: BuyerCountryCode = body.country;
    const preferredCurrency: BuyerCurrencyCode = body.preferredCurrency;
    const preferredLanguage: BuyerLanguageCode = body.preferredLanguage;

    const isIndividual = body.kind === 'individual';
    const fullName = isIndividual ? body.fullName : body.contactFullName;
    const contactEmail = normalizeEmail(
      isIndividual ? body.email : body.contactEmail,
    );
    const contactPhone = normalizePhone(
      isIndividual ? body.phoneE164 : body.contactPhoneE164,
    );
    const orgName = isIndividual ? null : body.orgName;
    const businessKind: BuyerBusinessKind | null = isIndividual
      ? null
      : body.businessKind;
    const businessRegistrationNumber = isIndividual
      ? null
      : body.businessRegistrationNumber;
    const taxId = isIndividual ? null : body.taxId;
    const nationalIdNumber = isIndividual
      ? body.nationalIdNumber ?? null
      : null;

    // `displayName` — what the buyer record's existing `name` column
    // shows in admin lists. Mirrors the legacy convention: org name
    // for businesses, contact full name for individuals.
    const displayName = isIndividual ? body.fullName : body.orgName;
    const kycAtomsInitialized = initialKycAtomsFor(accountKind);

    // 3. Supabase auth user — fail-fast on duplicate / provider down.
    const created = await deps.supabaseAdmin.createUser({
      email: contactEmail,
      phone: contactPhone,
      appMetadata: {
        tenant_id: tenantId,
        mining_role: BUYER_MINING_ROLE,
        account_kind: accountKind,
      },
      userMetadata: {
        full_name: fullName,
        preferred_language: preferredLanguage,
        country,
      },
    });
    if (!created.ok) {
      if (created.reason === 'duplicate_email') {
        return c.json(
          {
            error: 'email_already_registered',
            message: 'a buyer with this email already exists',
          },
          409,
        );
      }
      if (created.reason === 'duplicate_phone') {
        return c.json(
          {
            error: 'phone_already_registered',
            message: 'a buyer with this phone already exists',
          },
          409,
        );
      }
      deps.logger.error('buyer_signup.supabase_admin_unavailable', {
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

    // 4. Persist the buyers row.
    try {
      await deps.buyerWriter.createBuyerOrg({
        buyerOrgId,
        tenantId,
        supabaseUserId: created.user.id,
        accountKind,
        businessKind,
        country,
        preferredCurrency,
        preferredLanguage,
        orgName,
        fullName,
        displayName,
        contactEmail,
        contactPhone,
        nationalIdNumber,
        taxId,
        businessRegistrationNumber,
        kycAtomsInitialized,
      });
    } catch (err) {
      deps.logger.error('buyer_signup.write_failed', {
        tenantId,
        buyerOrgId,
        accountKind,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          error: 'buyer_write_failed',
          message: 'failed to persist buyer during signup',
        },
        503,
      );
    }

    // 5. Persona binding — fail-closed.
    try {
      await deps.personaBinder.bindBuyerPersona({
        tenantId,
        userId: created.user.id,
        personaSlug: BUYER_PERSONA_SLUG,
        accountKind,
      });
    } catch (err) {
      deps.logger.error('buyer_signup.persona_bind_failed', {
        tenantId,
        buyerOrgId,
        userId: created.user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          error: 'persona_bind_failed',
          message: 'failed to bind buyer persona',
        },
        503,
      );
    }

    // 6. Hash-chain audit (best-effort — never roll back a real user).
    try {
      await deps.auditChain.appendSignupEntry({
        tenantId,
        buyerOrgId,
        userId: created.user.id,
        accountKind,
        businessKind,
        country,
        kycAtomsInitialized,
      });
    } catch (err) {
      deps.logger.warn('buyer_signup.audit_append_failed', {
        tenantId,
        buyerOrgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 7. OTP delivery (best-effort).
    const otp = await deps.supabaseAdmin.sendPhoneOtp({
      phone: contactPhone,
    });
    if (!otp.delivered) {
      deps.logger.warn('buyer_signup.otp_not_delivered', { tenantId });
    }

    deps.logger.info('buyer_signup.complete', {
      tenantId,
      buyerOrgId,
      accountKind,
      country,
    });

    return c.json(
      {
        buyerOrgId,
        tenantId,
        userId: created.user.id,
        kind: accountKind,
        kycAtoms: kycAtomsInitialized,
        otpRequired: true,
        signupStatus: 'pending_otp_verification' as const,
      },
      201,
    );
  });

  return app;
}

// ─── Default factories ───────────────────────────────────────────────

/**
 * Default tenant-id factory for buyer signups. Format `bt_<uuidv4>` so
 * buyer tenants are visually distinguishable from miner tenants (`tn_`).
 */
export function newBuyerTenantIdDefault(): string {
  return `bt_${randomUUID()}`;
}

/**
 * Default buyer-org-id factory. Format `buyer_<uuidv4>`.
 */
export function newBuyerOrgIdDefault(): string {
  return `buyer_${randomUUID()}`;
}
