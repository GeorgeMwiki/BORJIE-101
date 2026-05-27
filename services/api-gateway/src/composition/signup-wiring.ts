/**
 * Composition wiring for the public self-signup endpoints.
 *
 *   - /api/v1/orgs/signup    (owner / mining-tenant signup)
 *   - /api/v1/buyers/signup  (mineral-buyer signup)
 *
 * Both endpoints run OUTSIDE a tenant context — they are the act of
 * creating one. The DI surface lets the routes hit:
 *
 *   - Supabase Admin API for auth-user creation + phone OTP. The
 *     Supabase client BYPASSES RLS via the service-role key; we never
 *     expose it to the browser.
 *   - Drizzle writes against the `tenants` / `users` / `buyers` tables.
 *     The signup writer runs at the connection level without any
 *     `app.current_tenant_id` GUC bound, so the inserts succeed before
 *     RLS context exists for this tenant.
 *   - Persistent persona-binding hint via the `users.preferences`
 *     JSONB (`persona_slug`). The brain identity layer reads this on
 *     first session creation; full `persona_bindings` table is a
 *     follow-up.
 *   - Append-only entry into the hash-chained `ai_audit_chain` (via
 *     `createAuditHashChain` + `createDrizzleAiAuditChainRepo`).
 *   - Pino logger surfaces (info / warn / error) — `console.log` is
 *     forbidden in services per CLAUDE.md.
 *
 * If a required upstream is absent (no DATABASE_URL, no
 * SUPABASE_SERVICE_ROLE_KEY) every adapter degrades to a fail-soft
 * shape that returns the documented 503 reasons — the gateway stays
 * up so an operator can wire credentials without bouncing the pod.
 */

import { sql } from 'drizzle-orm';
import type { Logger as PinoLogger } from 'pino';

import { createSupabaseAdminClient } from '@borjie/supabase-client';
import { createDrizzleAiAuditChainRepo } from './ai-audit-chain-repo.js';
import {
  createAuditHashChain,
  type AuditHashChain,
} from '@borjie/ai-copilot';

import type {
  SignupDeps,
  SupabaseAdmin as OrgsSupabaseAdmin,
  TenantWriter,
  PersonaBinder,
  AuditChainWriter,
  SignupLogger,
} from '../routes/orgs/index.js';
import {
  newTenantIdDefault,
  newUserIdDefault,
  defaultSlugFactory,
} from '../routes/orgs/index.js';

import type {
  BuyerSignupDeps,
  SupabaseBuyerAdmin,
  BuyerWriter,
  BuyerPersonaBinder,
  BuyerAuditChainWriter,
  BuyerSignupLogger,
} from '../routes/buyers/index.js';
import {
  newBuyerTenantIdDefault,
  newBuyerOrgIdDefault,
} from '../routes/buyers/index.js';

// ─── Internal shapes ─────────────────────────────────────────────────

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

interface SupabaseAdminLike {
  readonly auth: {
    readonly admin: {
      createUser(args: {
        email: string;
        phone?: string;
        email_confirm?: boolean;
        phone_confirm?: boolean;
        app_metadata?: Record<string, unknown>;
        user_metadata?: Record<string, unknown>;
      }): Promise<{
        data: { user: { id: string; email?: string | null; phone?: string | null } | null };
        error: { message: string; status?: number; code?: string } | null;
      }>;
    };
    signInWithOtp(args: {
      phone: string;
    }): Promise<{ error: { message: string } | null }>;
  };
}

// ─── Logger adapter — Pino → our minimal SignupLogger contract ───────

function adaptLogger(base: PinoLogger): SignupLogger & BuyerSignupLogger {
  return {
    info: (message, meta) => base.info(meta ?? {}, message),
    warn: (message, meta) => base.warn(meta ?? {}, message),
    error: (message, meta) => base.error(meta ?? {}, message),
  };
}

// ─── Supabase admin adapter ──────────────────────────────────────────

/**
 * Map Supabase admin-API errors onto the structured signup-result
 * codes. Returns `null` when the error is unknown so the caller can
 * fall through to `provider_unavailable`.
 */
function classifySupabaseError(
  error: { message: string; status?: number; code?: string },
): 'duplicate_email' | 'duplicate_phone' | null {
  const msg = (error.message ?? '').toLowerCase();
  const code = (error.code ?? '').toLowerCase();
  if (
    error.status === 422 ||
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    msg.includes('already registered') ||
    msg.includes('already exists')
  ) {
    if (msg.includes('phone')) return 'duplicate_phone';
    return 'duplicate_email';
  }
  if (msg.includes('phone') && (msg.includes('exists') || msg.includes('taken'))) {
    return 'duplicate_phone';
  }
  return null;
}

function buildSupabaseAdminAdapter(args: {
  readonly client: SupabaseAdminLike | null;
  readonly logger: PinoLogger;
}): OrgsSupabaseAdmin & SupabaseBuyerAdmin {
  return {
    async createUser(input) {
      if (!args.client) {
        // No client — surface as provider_unavailable so the route
        // returns the documented 503.
        return { ok: false, reason: 'provider_unavailable' as const };
      }
      try {
        const res = await args.client.auth.admin.createUser({
          email: input.email,
          phone: input.phone,
          email_confirm: false,
          phone_confirm: false,
          app_metadata: { ...input.appMetadata },
          user_metadata: { ...input.userMetadata },
        });
        if (res.error) {
          const reason = classifySupabaseError(res.error);
          if (reason) {
            return { ok: false, reason };
          }
          args.logger.warn(
            { err: res.error.message, status: res.error.status },
            'signup-wiring: supabase admin createUser failed',
          );
          return { ok: false, reason: 'provider_unavailable' as const };
        }
        const user = res.data?.user;
        if (!user) {
          return { ok: false, reason: 'provider_unavailable' as const };
        }
        return {
          ok: true,
          user: {
            id: user.id,
            email: user.email ?? input.email,
            phone: user.phone ?? input.phone,
          },
        };
      } catch (err) {
        args.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'signup-wiring: supabase admin createUser threw',
        );
        return { ok: false, reason: 'provider_unavailable' as const };
      }
    },
    async sendPhoneOtp(input) {
      if (!args.client) return { delivered: false };
      try {
        const res = await args.client.auth.signInWithOtp({ phone: input.phone });
        if (res.error) {
          args.logger.warn(
            { err: res.error.message },
            'signup-wiring: supabase OTP send failed',
          );
          return { delivered: false };
        }
        return { delivered: true };
      } catch (err) {
        args.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'signup-wiring: supabase OTP send threw',
        );
        return { delivered: false };
      }
    },
  };
}

// ─── Tenant + owner writer (Drizzle, raw SQL — runs without a
//     tenant-bound RLS context because the tenant is being CREATED). ──

function buildTenantWriter(args: {
  readonly db: DrizzleLikeClient | null;
  readonly logger: PinoLogger;
}): TenantWriter {
  return {
    async createTenantAndOwner(input) {
      if (!args.db) {
        throw new Error('tenant-writer: DATABASE_URL not configured');
      }
      const kycAtoms =
        input.accountKind === 'individual'
          ? ['national_id_pending', 'address_pending']
          : ['brela_pending', 'tin_pending', 'beneficial_owner_pending'];
      try {
        await args.db.execute(
          sql`
            INSERT INTO tenants (
              id, name, slug, primary_email, primary_phone,
              status, country, account_kind, primary_currency,
              default_language, mining_licence_number,
              business_registration_number, tax_id, vat_number,
              national_id_number, kyc_status, kyc_atoms_completed,
              created_at, updated_at
            ) VALUES (
              ${input.tenantId},
              ${input.orgName},
              ${input.slug},
              ${input.ownerEmail},
              ${input.ownerPhone},
              'pending',
              ${input.country},
              ${input.accountKind},
              ${input.primaryCurrency},
              ${input.defaultLanguage},
              ${input.miningLicenceNumber},
              ${input.businessRegistrationNumber},
              ${input.taxId},
              ${input.vatNumber},
              ${input.nationalIdNumber},
              'unverified',
              ${JSON.stringify(kycAtoms)}::jsonb,
              NOW(), NOW()
            )
          `,
        );
        await args.db.execute(
          sql`
            INSERT INTO users (
              id, tenant_id, email, phone, first_name, last_name,
              display_name, status, is_owner, mining_role,
              preferred_lang, preferences, created_at, updated_at
            ) VALUES (
              ${input.ownerUserId},
              ${input.tenantId},
              ${input.ownerEmail},
              ${input.ownerPhone},
              ${input.ownerFirstName},
              ${input.ownerLastName},
              ${`${input.ownerFirstName} ${input.ownerLastName}`.trim()},
              'pending_activation',
              TRUE,
              'owner',
              ${input.defaultLanguage},
              ${JSON.stringify({ supabase_user_id: input.supabaseUserId })}::jsonb,
              NOW(), NOW()
            )
          `,
        );
        return {
          tenantId: input.tenantId,
          ownerUserId: input.ownerUserId,
        };
      } catch (err) {
        args.logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            tenantId: input.tenantId,
          },
          'signup-wiring: tenant + owner write failed',
        );
        throw err instanceof Error
          ? err
          : new Error('tenant-writer: insert failed');
      }
    },
  };
}

// ─── Persona binder (writes the slug into users.preferences) ─────────

function buildPersonaBinder(args: {
  readonly db: DrizzleLikeClient | null;
  readonly logger: PinoLogger;
}): PersonaBinder {
  return {
    async bindOwnerPersona(input) {
      if (!args.db) {
        throw new Error('persona-binder: DATABASE_URL not configured');
      }
      // HIGH-risk policy prefix per CLAUDE.md — literal slug, no
      // reason-resolver generalisation. We persist the binding hint on
      // the users row so the brain identity layer picks it up on first
      // session creation. The dedicated persona_bindings table is a
      // follow-up; until it lands, this preference is the canonical
      // signal for owner-persona attachment.
      await args.db.execute(
        sql`
          UPDATE users
             SET preferences = COALESCE(preferences, '{}'::jsonb)
                               || jsonb_build_object('persona_slug', ${input.personaSlug}::text),
                 updated_at = NOW()
           WHERE id = ${input.userId}
             AND tenant_id = ${input.tenantId}
        `,
      );
    },
  };
}

// ─── Audit-chain adapter (hash-chained append) ───────────────────────

function buildAuditChainAdapter(args: {
  readonly chain: AuditHashChain | null;
  readonly logger: PinoLogger;
}): AuditChainWriter {
  return {
    async appendSignupEntry(input) {
      if (!args.chain) {
        args.logger.warn(
          { tenantId: input.tenantId },
          'signup-wiring: audit-chain not configured — skipping append',
        );
        return;
      }
      await args.chain.append({
        tenantId: input.tenantId,
        turnId: `signup_${input.tenantId}`,
        action: 'tenant.signup',
        payload: {
          ownerUserId: input.ownerUserId,
          accountKind: input.accountKind,
          country: input.country,
          kycAtomsInitialized: [...input.kycAtomsInitialized],
        },
      });
    },
  };
}

// ─── Buyer-specific writers ──────────────────────────────────────────

function buildBuyerWriter(args: {
  readonly db: DrizzleLikeClient | null;
  readonly logger: PinoLogger;
}): BuyerWriter {
  return {
    async createBuyerOrg(input) {
      if (!args.db) {
        throw new Error('buyer-writer: DATABASE_URL not configured');
      }
      try {
        // Buyer-tenant row — every buyer is its own tenant per
        // signup.hono.ts contract.
        await args.db.execute(
          sql`
            INSERT INTO tenants (
              id, name, slug, primary_email, primary_phone,
              status, country, account_kind, primary_currency,
              default_language, business_registration_number,
              tax_id, national_id_number, kyc_status,
              kyc_atoms_completed, created_at, updated_at
            ) VALUES (
              ${input.tenantId},
              ${input.displayName},
              ${`buyer-${input.buyerOrgId.toLowerCase()}`},
              ${input.contactEmail},
              ${input.contactPhone},
              'pending',
              ${input.country},
              ${input.accountKind},
              ${input.preferredCurrency},
              ${input.preferredLanguage},
              ${input.businessRegistrationNumber},
              ${input.taxId},
              ${input.nationalIdNumber},
              'unverified',
              ${JSON.stringify(input.kycAtomsInitialized)}::jsonb,
              NOW(), NOW()
            )
          `,
        );
        // Buyer row keyed by the new tenant id.
        await args.db.execute(
          sql`
            INSERT INTO buyers (
              id, tenant_id, name, kind, country, contact_name,
              contact_email, contact_phone, kyc_status,
              account_kind, business_kind, org_name,
              preferred_currency, preferred_language, full_name,
              national_id_number, tax_id, business_registration_number,
              kyc_atoms_completed, linked_user_id,
              created_at, updated_at
            ) VALUES (
              ${input.buyerOrgId},
              ${input.tenantId},
              ${input.displayName},
              ${input.accountKind === 'individual' ? 'broker' : input.businessKind ?? 'broker'},
              ${input.country},
              ${input.fullName},
              ${input.contactEmail},
              ${input.contactPhone},
              'not_started',
              ${input.accountKind},
              ${input.businessKind},
              ${input.orgName},
              ${input.preferredCurrency},
              ${input.preferredLanguage},
              ${input.fullName},
              ${input.nationalIdNumber},
              ${input.taxId},
              ${input.businessRegistrationNumber},
              ${JSON.stringify(input.kycAtomsInitialized)}::jsonb,
              ${input.supabaseUserId},
              NOW(), NOW()
            )
          `,
        );
        return {
          buyerOrgId: input.buyerOrgId,
          tenantId: input.tenantId,
        };
      } catch (err) {
        args.logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            tenantId: input.tenantId,
            buyerOrgId: input.buyerOrgId,
          },
          'signup-wiring: buyer write failed',
        );
        throw err instanceof Error
          ? err
          : new Error('buyer-writer: insert failed');
      }
    },
  };
}

function buildBuyerPersonaBinder(args: {
  readonly db: DrizzleLikeClient | null;
  readonly logger: PinoLogger;
}): BuyerPersonaBinder {
  return {
    async bindBuyerPersona(input) {
      if (!args.db) {
        throw new Error('buyer-persona-binder: DATABASE_URL not configured');
      }
      // Buyer signup writes the supabase user id into `buyers.linked_user_id`;
      // there is no internal `users` row for buyers today, so we stash the
      // persona hint in the buyer's `attributes` jsonb under the same
      // `persona_slug` key the orgs flow uses. The brain identity layer
      // reads either source on session bootstrap.
      await args.db.execute(
        sql`
          UPDATE buyers
             SET attributes = COALESCE(attributes, '{}'::jsonb)
                               || jsonb_build_object('persona_slug', ${input.personaSlug}::text,
                                                      'persona_account_kind', ${input.accountKind}::text),
                 updated_at = NOW()
           WHERE tenant_id = ${input.tenantId}
             AND linked_user_id = ${input.userId}
        `,
      );
    },
  };
}

function buildBuyerAuditChainAdapter(args: {
  readonly chain: AuditHashChain | null;
  readonly logger: PinoLogger;
}): BuyerAuditChainWriter {
  return {
    async appendSignupEntry(input) {
      if (!args.chain) {
        args.logger.warn(
          { tenantId: input.tenantId },
          'signup-wiring: buyer audit-chain not configured — skipping append',
        );
        return;
      }
      await args.chain.append({
        tenantId: input.tenantId,
        turnId: `buyer_signup_${input.tenantId}`,
        action: 'buyer.signup',
        payload: {
          buyerOrgId: input.buyerOrgId,
          userId: input.userId,
          accountKind: input.accountKind,
          businessKind: input.businessKind,
          country: input.country,
          kycAtomsInitialized: [...input.kycAtomsInitialized],
        },
      });
    },
  };
}

// ─── Top-level factory ──────────────────────────────────────────────

export interface SignupWiringInput {
  readonly db: DrizzleLikeClient | null;
  readonly logger: PinoLogger;
  /** Optional override for tests — production reads from env. */
  readonly supabaseClient?: SupabaseAdminLike | null;
}

export interface SignupWiringBundle {
  readonly orgs: SignupDeps;
  readonly buyers: BuyerSignupDeps;
}

function resolveSupabaseClient(
  override: SupabaseAdminLike | null | undefined,
  logger: PinoLogger,
): SupabaseAdminLike | null {
  if (override !== undefined) return override;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    logger.warn(
      {
        wiring: 'signup',
        supabaseUrl: Boolean(url),
        supabaseServiceRoleKey: Boolean(key),
      },
      'signup-wiring: Supabase admin env unset — /orgs/signup + /buyers/signup will 503 on POST',
    );
    return null;
  }
  try {
    return createSupabaseAdminClient({
      url,
      serviceRoleKey: key,
    }) as unknown as SupabaseAdminLike;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'signup-wiring: Supabase admin client init failed — degrading to provider_unavailable',
    );
    return null;
  }
}

export function createSignupWiring(input: SignupWiringInput): SignupWiringBundle {
  const supabaseClient = resolveSupabaseClient(input.supabaseClient, input.logger);
  const supabaseAdmin = buildSupabaseAdminAdapter({
    client: supabaseClient,
    logger: input.logger,
  });

  const auditRepo = createDrizzleAiAuditChainRepo(input.db);
  const auditChain: AuditHashChain | null = auditRepo
    ? createAuditHashChain({ repo: auditRepo })
    : null;

  const logger = adaptLogger(input.logger);

  const orgs: SignupDeps = {
    supabaseAdmin,
    tenantWriter: buildTenantWriter({ db: input.db, logger: input.logger }),
    personaBinder: buildPersonaBinder({ db: input.db, logger: input.logger }),
    auditChain: buildAuditChainAdapter({ chain: auditChain, logger: input.logger }),
    logger,
    newTenantId: newTenantIdDefault,
    newUserId: newUserIdDefault,
    newSlug: defaultSlugFactory,
  };

  const buyers: BuyerSignupDeps = {
    supabaseAdmin,
    buyerWriter: buildBuyerWriter({ db: input.db, logger: input.logger }),
    personaBinder: buildBuyerPersonaBinder({ db: input.db, logger: input.logger }),
    auditChain: buildBuyerAuditChainAdapter({ chain: auditChain, logger: input.logger }),
    logger,
    newTenantId: newBuyerTenantIdDefault,
    newBuyerOrgId: newBuyerOrgIdDefault,
  };

  return { orgs, buyers };
}
