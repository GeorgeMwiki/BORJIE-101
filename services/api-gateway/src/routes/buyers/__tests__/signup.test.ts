/**
 * /api/v1/buyers/signup tests — buyer self-signup, discriminated-union
 * body, Supabase-admin stubs, buyer writer + persona binder + audit
 * chain stubs.
 *
 * Covers (15+ tests):
 *   - happy path INDIVIDUAL (201 + canonical envelope + atoms)
 *   - happy path BUSINESS (201 + canonical envelope + atoms)
 *   - persists individual fields (national_id, no org_name/brn/tax)
 *   - persists business fields (org_name, business_kind, brn, tax)
 *   - 400 invalid JSON
 *   - 400 missing kind discriminator
 *   - 400 INDIVIDUAL missing fullName
 *   - 400 BUSINESS missing businessRegistrationNumber
 *   - 400 BUSINESS missing businessKind
 *   - 400 language not sw|en
 *   - 400 currency not in allowed set
 *   - 409 duplicate phone
 *   - 409 duplicate email
 *   - 503 supabase provider unavailable
 *   - 503 buyer write failed
 *   - 503 persona bind failed (fail-closed)
 *   - persona binder invoked with T5_customer_concierge
 *   - audit chain receives per-kind atoms
 *   - Supabase app_metadata carries tenant_id + mining_role + account_kind
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import {
  createBuyersRouter,
  type BuyerSignupDeps,
  type SupabaseBuyerAdmin,
  type BuyerWriter,
  type BuyerPersonaBinder,
  type BuyerAuditChainWriter,
  type BuyerSignupLogger,
} from '../index';

// ─── Stub builders ───────────────────────────────────────────────────

interface RecordedBuyerWrite {
  readonly buyerOrgId: string;
  readonly tenantId: string;
  readonly accountKind: 'individual' | 'business';
  readonly businessKind: string | null;
  readonly orgName: string | null;
  readonly fullName: string;
  readonly displayName: string;
  readonly nationalIdNumber: string | null;
  readonly taxId: string | null;
  readonly businessRegistrationNumber: string | null;
  readonly preferredCurrency: string;
  readonly preferredLanguage: string;
  readonly country: string;
  readonly kycAtomsInitialized: ReadonlyArray<string>;
}

interface RecordedPersonaBind {
  readonly tenantId: string;
  readonly userId: string;
  readonly personaSlug: string;
  readonly accountKind: 'individual' | 'business';
}

interface RecordedAuditEntry {
  readonly tenantId: string;
  readonly buyerOrgId: string;
  readonly accountKind: 'individual' | 'business';
  readonly kycAtomsInitialized: ReadonlyArray<string>;
}

interface RecordedSupabaseCreate {
  readonly email: string;
  readonly phone: string;
  readonly appMetadata: Readonly<Record<string, unknown>>;
}

interface Stubs {
  readonly deps: BuyerSignupDeps;
  readonly buyerWrites: RecordedBuyerWrite[];
  readonly personaBinds: RecordedPersonaBind[];
  readonly auditEntries: RecordedAuditEntry[];
  readonly supabaseCreates: RecordedSupabaseCreate[];
}

function buildStubs(
  overrides: {
    supabaseCreate?: SupabaseBuyerAdmin['createUser'];
    supabaseOtp?: SupabaseBuyerAdmin['sendPhoneOtp'];
    writerFailure?: boolean;
    personaFailure?: boolean;
    auditFailure?: boolean;
  } = {},
): Stubs {
  const buyerWrites: RecordedBuyerWrite[] = [];
  const personaBinds: RecordedPersonaBind[] = [];
  const auditEntries: RecordedAuditEntry[] = [];
  const supabaseCreates: RecordedSupabaseCreate[] = [];

  const supabaseAdmin: SupabaseBuyerAdmin = {
    createUser:
      overrides.supabaseCreate ??
      (async ({ email, phone, appMetadata }) => {
        supabaseCreates.push({ email, phone, appMetadata });
        return {
          ok: true,
          user: { id: `sb_${email}`, email, phone },
        };
      }),
    sendPhoneOtp:
      overrides.supabaseOtp ?? (async () => ({ delivered: true })),
  };

  const buyerWriter: BuyerWriter = {
    async createBuyerOrg(input) {
      if (overrides.writerFailure) {
        throw new Error('writer-down');
      }
      buyerWrites.push({
        buyerOrgId: input.buyerOrgId,
        tenantId: input.tenantId,
        accountKind: input.accountKind,
        businessKind: input.businessKind,
        orgName: input.orgName,
        fullName: input.fullName,
        displayName: input.displayName,
        nationalIdNumber: input.nationalIdNumber,
        taxId: input.taxId,
        businessRegistrationNumber: input.businessRegistrationNumber,
        preferredCurrency: input.preferredCurrency,
        preferredLanguage: input.preferredLanguage,
        country: input.country,
        kycAtomsInitialized: input.kycAtomsInitialized,
      });
      return { buyerOrgId: input.buyerOrgId, tenantId: input.tenantId };
    },
  };

  const personaBinder: BuyerPersonaBinder = {
    async bindBuyerPersona(input) {
      if (overrides.personaFailure) {
        throw new Error('persona-down');
      }
      personaBinds.push({
        tenantId: input.tenantId,
        userId: input.userId,
        personaSlug: input.personaSlug,
        accountKind: input.accountKind,
      });
    },
  };

  const auditChain: BuyerAuditChainWriter = {
    async appendSignupEntry(input) {
      if (overrides.auditFailure) {
        throw new Error('audit-down');
      }
      auditEntries.push({
        tenantId: input.tenantId,
        buyerOrgId: input.buyerOrgId,
        accountKind: input.accountKind,
        kycAtomsInitialized: input.kycAtomsInitialized,
      });
    },
  };

  const logger: BuyerSignupLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  let tenantCounter = 0;
  let orgCounter = 0;
  const deps: BuyerSignupDeps = {
    supabaseAdmin,
    buyerWriter,
    personaBinder,
    auditChain,
    logger,
    newTenantId: () => {
      tenantCounter += 1;
      return `bt_test_${tenantCounter}`;
    },
    newBuyerOrgId: () => {
      orgCounter += 1;
      return `buyer_test_${orgCounter}`;
    },
  };

  return { deps, buyerWrites, personaBinds, auditEntries, supabaseCreates };
}

function mountApp(deps: BuyerSignupDeps): Hono {
  const app = new Hono();
  app.route('/api/v1/buyers', createBuyersRouter(deps));
  return app;
}

async function post(
  app: Hono,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await app.request('/api/v1/buyers/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const VALID_INDIVIDUAL = {
  kind: 'individual' as const,
  country: 'TZ' as const,
  fullName: 'Asha Mwanaidi',
  phoneE164: '+255712345678',
  email: 'asha@example.com',
  preferredCurrency: 'TZS' as const,
  preferredLanguage: 'sw' as const,
};

const VALID_BUSINESS = {
  kind: 'business' as const,
  country: 'AE' as const,
  orgName: 'Dubai Gold Refinery LLC',
  businessKind: 'refiner' as const,
  businessRegistrationNumber: 'AE-BRN-9988',
  taxId: 'AE-TIN-7766',
  contactFullName: 'Khalid Al Maktoum',
  contactPhoneE164: '+971501234567',
  contactEmail: 'khalid@dgr.example.com',
  preferredCurrency: 'USD' as const,
  preferredLanguage: 'en' as const,
};

// ─── Happy path · INDIVIDUAL ─────────────────────────────────────────

describe('POST /api/v1/buyers/signup · INDIVIDUAL', () => {
  it('returns 201 with canonical envelope on a valid individual signup', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      ...VALID_INDIVIDUAL,
      nationalIdNumber: '19880101-12345-67890-12',
    });
    expect(r.status).toBe(201);
    expect(r.body.tenantId).toBe('bt_test_1');
    expect(r.body.buyerOrgId).toBe('buyer_test_1');
    expect(r.body.kind).toBe('individual');
    expect(r.body.otpRequired).toBe(true);
    expect(r.body.signupStatus).toBe('pending_otp_verification');
    expect(r.body.kycAtoms).toEqual([
      'identity',
      'address',
      'bank_account',
      'source_of_funds',
    ]);
  });

  it('persists national_id, leaves org/brn/tax/businessKind null', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    await post(app, {
      ...VALID_INDIVIDUAL,
      nationalIdNumber: '19880101-12345-67890-12',
    });
    expect(stubs.buyerWrites).toHaveLength(1);
    const w = stubs.buyerWrites[0]!;
    expect(w.accountKind).toBe('individual');
    expect(w.businessKind).toBeNull();
    expect(w.orgName).toBeNull();
    expect(w.businessRegistrationNumber).toBeNull();
    expect(w.taxId).toBeNull();
    expect(w.nationalIdNumber).toBe('19880101-12345-67890-12');
    expect(w.fullName).toBe('Asha Mwanaidi');
    expect(w.displayName).toBe('Asha Mwanaidi');
    expect(w.preferredCurrency).toBe('TZS');
    expect(w.preferredLanguage).toBe('sw');
  });
});

// ─── Happy path · BUSINESS ───────────────────────────────────────────

describe('POST /api/v1/buyers/signup · BUSINESS', () => {
  it('returns 201 with kind=business and the deeper atom list', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, VALID_BUSINESS);
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe('business');
    expect(r.body.kycAtoms).toEqual([
      'identity',
      'address',
      'company_docs',
      'tax_compliance',
      'bank_account',
      'beneficial_owners',
      'aml_screening',
    ]);
  });

  it('persists org_name, business_kind, BRN, tax_id; leaves national_id null', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    await post(app, VALID_BUSINESS);
    expect(stubs.buyerWrites).toHaveLength(1);
    const w = stubs.buyerWrites[0]!;
    expect(w.accountKind).toBe('business');
    expect(w.businessKind).toBe('refiner');
    expect(w.orgName).toBe('Dubai Gold Refinery LLC');
    expect(w.businessRegistrationNumber).toBe('AE-BRN-9988');
    expect(w.taxId).toBe('AE-TIN-7766');
    expect(w.nationalIdNumber).toBeNull();
    expect(w.fullName).toBe('Khalid Al Maktoum');
    expect(w.displayName).toBe('Dubai Gold Refinery LLC');
  });
});

// ─── 400 invalid_body ───────────────────────────────────────────────

describe('POST /api/v1/buyers/signup · 400 validation', () => {
  it('returns 400 when JSON parsing fails', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, 'not-json');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_body');
  });

  it('returns 400 when kind discriminator is missing', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      country: 'TZ',
      fullName: 'Asha',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      preferredCurrency: 'TZS',
      preferredLanguage: 'sw',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_body');
    expect(r.body.issues).toBeInstanceOf(Array);
  });

  it('returns 400 when INDIVIDUAL fullName is missing', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const { fullName: _omit, ...partial } = VALID_INDIVIDUAL;
    void _omit;
    const r = await post(app, partial);
    expect(r.status).toBe(400);
    expect(
      r.body.issues.some((i: { path: string }) => i.path === 'fullName'),
    ).toBe(true);
  });

  it('returns 400 when BUSINESS businessRegistrationNumber is missing', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const { businessRegistrationNumber: _omit, ...partial } = VALID_BUSINESS;
    void _omit;
    const r = await post(app, partial);
    expect(r.status).toBe(400);
    expect(
      r.body.issues.some(
        (i: { path: string }) => i.path === 'businessRegistrationNumber',
      ),
    ).toBe(true);
  });

  it('returns 400 when BUSINESS businessKind is missing', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const { businessKind: _omit, ...partial } = VALID_BUSINESS;
    void _omit;
    const r = await post(app, partial);
    expect(r.status).toBe(400);
    expect(
      r.body.issues.some((i: { path: string }) => i.path === 'businessKind'),
    ).toBe(true);
  });

  it('returns 400 when preferred_language is not sw|en', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      ...VALID_INDIVIDUAL,
      preferredLanguage: 'fr',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_body');
  });

  it('returns 400 when preferred_currency is not in the allowed set', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      ...VALID_INDIVIDUAL,
      preferredCurrency: 'GBP',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_body');
  });
});

// ─── 409 conflict — duplicate Supabase user ─────────────────────────

describe('POST /api/v1/buyers/signup · 409 duplicates', () => {
  it('returns 409 phone_already_registered when Supabase reports duplicate phone', async () => {
    const stubs = buildStubs({
      supabaseCreate: async () => ({
        ok: false,
        reason: 'duplicate_phone',
      }),
    });
    const app = mountApp(stubs.deps);
    const r = await post(app, VALID_INDIVIDUAL);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('phone_already_registered');
    expect(stubs.buyerWrites).toHaveLength(0);
  });

  it('returns 409 email_already_registered when Supabase reports duplicate email', async () => {
    const stubs = buildStubs({
      supabaseCreate: async () => ({
        ok: false,
        reason: 'duplicate_email',
      }),
    });
    const app = mountApp(stubs.deps);
    const r = await post(app, VALID_BUSINESS);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('email_already_registered');
    expect(stubs.buyerWrites).toHaveLength(0);
  });
});

// ─── 503 provider / writer / persona ─────────────────────────────────

describe('POST /api/v1/buyers/signup · 503 outages', () => {
  it('returns 503 auth_provider_unavailable when Supabase reports provider down', async () => {
    const stubs = buildStubs({
      supabaseCreate: async () => ({
        ok: false,
        reason: 'provider_unavailable',
      }),
    });
    const app = mountApp(stubs.deps);
    const r = await post(app, VALID_INDIVIDUAL);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('auth_provider_unavailable');
  });

  it('returns 503 buyer_write_failed when the writer throws', async () => {
    const stubs = buildStubs({ writerFailure: true });
    const app = mountApp(stubs.deps);
    const r = await post(app, VALID_INDIVIDUAL);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('buyer_write_failed');
  });

  it('returns 503 persona_bind_failed (fail-closed) when persona binder throws', async () => {
    const stubs = buildStubs({ personaFailure: true });
    const app = mountApp(stubs.deps);
    const r = await post(app, VALID_INDIVIDUAL);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('persona_bind_failed');
  });
});

// ─── Persona + audit + Supabase metadata invariants ─────────────────

describe('POST /api/v1/buyers/signup · invariants', () => {
  it('binds the T5_customer_concierge persona with the buyer kind', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    await post(app, VALID_BUSINESS);
    expect(stubs.personaBinds).toHaveLength(1);
    expect(stubs.personaBinds[0]!.personaSlug).toBe('T5_customer_concierge');
    expect(stubs.personaBinds[0]!.accountKind).toBe('business');
  });

  it('appends an audit-chain entry carrying the per-kind atoms', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    await post(app, VALID_INDIVIDUAL);
    expect(stubs.auditEntries).toHaveLength(1);
    expect(stubs.auditEntries[0]!.accountKind).toBe('individual');
    expect(stubs.auditEntries[0]!.kycAtomsInitialized).toEqual([
      'identity',
      'address',
      'bank_account',
      'source_of_funds',
    ]);
  });

  it('still returns 201 even when audit append fails (best-effort)', async () => {
    const stubs = buildStubs({ auditFailure: true });
    const app = mountApp(stubs.deps);
    const r = await post(app, VALID_INDIVIDUAL);
    expect(r.status).toBe(201);
  });

  it('passes tenant_id + buyer_org_admin + account_kind to Supabase app_metadata', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    await post(app, VALID_BUSINESS);
    expect(stubs.supabaseCreates).toHaveLength(1);
    const meta = stubs.supabaseCreates[0]!.appMetadata as Record<
      string,
      unknown
    >;
    expect(meta.tenant_id).toBe('bt_test_1');
    expect(meta.mining_role).toBe('buyer_org_admin');
    expect(meta.account_kind).toBe('business');
  });

  it('mints a fresh buyer-tenant id (bt_ prefix) separate from any miner tenant', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, VALID_INDIVIDUAL);
    expect(r.body.tenantId).toMatch(/^bt_/);
  });
});
