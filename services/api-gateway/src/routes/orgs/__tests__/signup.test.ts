/**
 * /api/v1/orgs/signup endpoint tests — discriminated-union body,
 * Supabase-admin stubs, tenant writer + persona binder + audit chain
 * stubs.
 *
 * Covers:
 *   - happy path INDIVIDUAL (returns 201 + tenantId/ownerUserId/kind)
 *   - happy path BUSINESS (returns 201 + same envelope)
 *   - 400 invalid_body when `kind` discriminator is missing
 *   - 400 invalid_body when an INDIVIDUAL required field is missing
 *   - 400 invalid_body when a BUSINESS required field is missing
 *   - 409 email_already_registered when Supabase reports duplicate email
 *   - 409 phone_already_registered when Supabase reports duplicate phone
 *   - 503 auth_provider_unavailable when Supabase admin throws
 *   - Persona binder is invoked with the T1_owner_strategist slug
 *   - Audit chain receives the per-kind KYC atoms initialized
 *   - Tenant writer receives the correctly-derived owner first/last name
 *   - 400 when JSON body is invalid (string body)
 *   - 400 when language is not 'sw' or 'en'
 *   - 400 when currency is not in the allowed set
 *   - signupStatus is 'pending_otp_verification' + otpRequired=true
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import {
  createOrgsRouter,
  type SignupDeps,
  type SupabaseAdmin,
  type TenantWriter,
  type PersonaBinder,
  type AuditChainWriter,
  type SignupLogger,
} from '../index';

// ─── Stub builders ───────────────────────────────────────────────────

interface RecordedTenantWrite {
  readonly tenantId: string;
  readonly accountKind: 'individual' | 'business';
  readonly ownerFirstName: string;
  readonly ownerLastName: string;
  readonly orgName: string;
  readonly businessRegistrationNumber: string | null;
  readonly taxId: string | null;
  readonly nationalIdNumber: string | null;
}

interface RecordedPersonaBind {
  readonly tenantId: string;
  readonly userId: string;
  readonly personaSlug: string;
}

interface RecordedAuditEntry {
  readonly tenantId: string;
  readonly accountKind: 'individual' | 'business';
  readonly kycAtomsInitialized: ReadonlyArray<string>;
}

interface Stubs {
  readonly deps: SignupDeps;
  readonly tenantWrites: RecordedTenantWrite[];
  readonly personaBinds: RecordedPersonaBind[];
  readonly auditEntries: RecordedAuditEntry[];
}

function buildStubs(
  overrides: {
    supabaseCreate?: SupabaseAdmin['createUser'];
    supabaseOtp?: SupabaseAdmin['sendPhoneOtp'];
    tenantWriterFailure?: boolean;
    personaBinderFailure?: boolean;
  } = {},
): Stubs {
  const tenantWrites: RecordedTenantWrite[] = [];
  const personaBinds: RecordedPersonaBind[] = [];
  const auditEntries: RecordedAuditEntry[] = [];

  const supabaseAdmin: SupabaseAdmin = {
    createUser:
      overrides.supabaseCreate ??
      (async ({ email, phone }) => ({
        ok: true,
        user: { id: `sb_${email}`, email, phone },
      })),
    sendPhoneOtp:
      overrides.supabaseOtp ?? (async () => ({ delivered: true })),
  };

  const tenantWriter: TenantWriter = {
    async createTenantAndOwner(input) {
      if (overrides.tenantWriterFailure) {
        throw new Error('writer-down');
      }
      tenantWrites.push({
        tenantId: input.tenantId,
        accountKind: input.accountKind,
        ownerFirstName: input.ownerFirstName,
        ownerLastName: input.ownerLastName,
        orgName: input.orgName,
        businessRegistrationNumber: input.businessRegistrationNumber,
        taxId: input.taxId,
        nationalIdNumber: input.nationalIdNumber,
      });
      return { tenantId: input.tenantId, ownerUserId: input.ownerUserId };
    },
  };

  const personaBinder: PersonaBinder = {
    async bindOwnerPersona(input) {
      if (overrides.personaBinderFailure) {
        throw new Error('persona-down');
      }
      personaBinds.push({
        tenantId: input.tenantId,
        userId: input.userId,
        personaSlug: input.personaSlug,
      });
    },
  };

  const auditChain: AuditChainWriter = {
    async appendSignupEntry(input) {
      auditEntries.push({
        tenantId: input.tenantId,
        accountKind: input.accountKind,
        kycAtomsInitialized: input.kycAtomsInitialized,
      });
    },
  };

  const logger: SignupLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  let tenantCounter = 0;
  let userCounter = 0;
  const deps: SignupDeps = {
    supabaseAdmin,
    tenantWriter,
    personaBinder,
    auditChain,
    logger,
    newTenantId: () => {
      tenantCounter += 1;
      return `tn_test_${tenantCounter}`;
    },
    newUserId: () => {
      userCounter += 1;
      return `usr_test_${userCounter}`;
    },
    newSlug: (seed) =>
      `${seed.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')}-slug`,
  };

  return { deps, tenantWrites, personaBinds, auditEntries };
}

function mountApp(deps: SignupDeps): Hono {
  const app = new Hono();
  app.route('/api/v1/orgs', createOrgsRouter(deps));
  return app;
}

async function post(
  app: Hono,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await app.request('/api/v1/orgs/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ─── Happy path · INDIVIDUAL ─────────────────────────────────────────

describe('POST /api/v1/orgs/signup · INDIVIDUAL kind', () => {
  it('returns 201 with the canonical envelope on a valid individual signup', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'individual',
      country: 'TZ',
      fullName: 'Asha Mwanaidi',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      miningLicenceNumber: 'PML-TZ-12345',
      nationalIdNumber: '19880101-12345-67890-12',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(201);
    expect(r.body.tenantId).toBe('tn_test_1');
    expect(r.body.ownerUserId).toBe('usr_test_1');
    expect(r.body.kind).toBe('individual');
    expect(r.body.signupStatus).toBe('pending_otp_verification');
    expect(r.body.otpRequired).toBe(true);
    expect(r.body.kycAtomsInitialized).toEqual([
      'national_id_pending',
      'address_pending',
    ]);
  });

  it('persists the tenant with the split first/last name', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    await post(app, {
      kind: 'individual',
      country: 'TZ',
      fullName: 'Asha Mwanaidi Kazimoto',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(stubs.tenantWrites).toHaveLength(1);
    const w = stubs.tenantWrites[0]!;
    expect(w.accountKind).toBe('individual');
    expect(w.ownerFirstName).toBe('Asha Mwanaidi');
    expect(w.ownerLastName).toBe('Kazimoto');
    expect(w.businessRegistrationNumber).toBeNull();
    expect(w.taxId).toBeNull();
  });
});

// ─── Happy path · BUSINESS ───────────────────────────────────────────

describe('POST /api/v1/orgs/signup · BUSINESS kind', () => {
  it('returns 201 with kind=business and BRELA + TIN persisted', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'business',
      country: 'TZ',
      orgName: 'Mawe Bora Ltd',
      businessRegistrationNumber: 'BRELA-12345',
      taxId: 'TIN-98765',
      ownerEmail: 'ceo@mawebora.example.com',
      ownerFullName: 'Yusuf Mwanaidi',
      ownerPhoneE164: '+255700123456',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe('business');
    expect(r.body.kycAtomsInitialized).toEqual([
      'brela_pending',
      'tin_pending',
      'beneficial_owner_pending',
    ]);
    expect(stubs.tenantWrites).toHaveLength(1);
    const w = stubs.tenantWrites[0]!;
    expect(w.orgName).toBe('Mawe Bora Ltd');
    expect(w.businessRegistrationNumber).toBe('BRELA-12345');
    expect(w.taxId).toBe('TIN-98765');
    expect(w.nationalIdNumber).toBeNull();
  });

  it('records the persona binding with T1_owner_strategist', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    await post(app, {
      kind: 'business',
      country: 'TZ',
      orgName: 'Mawe Bora Ltd',
      businessRegistrationNumber: 'BRELA-12345',
      taxId: 'TIN-98765',
      ownerEmail: 'ceo@mawebora.example.com',
      ownerFullName: 'Yusuf Mwanaidi',
      ownerPhoneE164: '+255700123456',
      defaultLanguage: 'en',
      primaryCurrency: 'USD',
    });
    expect(stubs.personaBinds).toHaveLength(1);
    expect(stubs.personaBinds[0]!.personaSlug).toBe('T1_owner_strategist');
  });
});

// ─── 400 — invalid body ──────────────────────────────────────────────

describe('POST /api/v1/orgs/signup · 400 invalid_body', () => {
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
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_body');
    expect(r.body.issues).toBeInstanceOf(Array);
  });

  it('returns 400 when an INDIVIDUAL required field is missing (fullName)', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'individual',
      country: 'TZ',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(400);
    expect(r.body.issues.some((i: { path: string }) => i.path === 'fullName')).toBe(true);
  });

  it('returns 400 when a BUSINESS required field is missing (businessRegistrationNumber)', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'business',
      country: 'TZ',
      orgName: 'Mawe Bora Ltd',
      taxId: 'TIN-98765',
      ownerEmail: 'ceo@mawebora.example.com',
      ownerFullName: 'Yusuf Mwanaidi',
      ownerPhoneE164: '+255700123456',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(400);
    expect(
      r.body.issues.some(
        (i: { path: string }) => i.path === 'businessRegistrationNumber',
      ),
    ).toBe(true);
  });

  it('returns 400 when language is not sw|en', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'individual',
      country: 'TZ',
      fullName: 'Asha Mwanaidi',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      defaultLanguage: 'fr',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(400);
  });

  it('returns 400 when currency is outside the allowed set', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'individual',
      country: 'TZ',
      fullName: 'Asha Mwanaidi',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      defaultLanguage: 'sw',
      primaryCurrency: 'GBP',
    });
    expect(r.status).toBe(400);
  });
});

// ─── 409 — duplicate ─────────────────────────────────────────────────

describe('POST /api/v1/orgs/signup · 409 duplicates', () => {
  it('returns 409 email_already_registered when Supabase reports duplicate email', async () => {
    const stubs = buildStubs({
      supabaseCreate: async () => ({ ok: false, reason: 'duplicate_email' }),
    });
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'individual',
      country: 'TZ',
      fullName: 'Asha Mwanaidi',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('email_already_registered');
  });

  it('returns 409 phone_already_registered when Supabase reports duplicate phone', async () => {
    const stubs = buildStubs({
      supabaseCreate: async () => ({ ok: false, reason: 'duplicate_phone' }),
    });
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'business',
      country: 'TZ',
      orgName: 'Mawe Bora Ltd',
      businessRegistrationNumber: 'BRELA-12345',
      taxId: 'TIN-98765',
      ownerEmail: 'ceo@mawebora.example.com',
      ownerFullName: 'Yusuf Mwanaidi',
      ownerPhoneE164: '+255700123456',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('phone_already_registered');
  });
});

// ─── 503 — provider unavailable / writer failure ────────────────────

describe('POST /api/v1/orgs/signup · 503 provider failures', () => {
  it('returns 503 when Supabase admin is unavailable', async () => {
    const stubs = buildStubs({
      supabaseCreate: async () => ({ ok: false, reason: 'provider_unavailable' }),
    });
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'individual',
      country: 'TZ',
      fullName: 'Asha Mwanaidi',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('auth_provider_unavailable');
  });

  it('returns 503 when persona binding fails (fail-closed)', async () => {
    const stubs = buildStubs({ personaBinderFailure: true });
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'individual',
      country: 'TZ',
      fullName: 'Asha Mwanaidi',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('persona_bind_failed');
  });

  it('returns 503 when tenant writer fails', async () => {
    const stubs = buildStubs({ tenantWriterFailure: true });
    const app = mountApp(stubs.deps);
    const r = await post(app, {
      kind: 'individual',
      country: 'TZ',
      fullName: 'Asha Mwanaidi',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('tenant_write_failed');
  });
});

// ─── Audit chain receives the correct atoms ─────────────────────────

describe('POST /api/v1/orgs/signup · audit chain', () => {
  it('appends an entry per signup with kind-specific KYC atoms', async () => {
    const stubs = buildStubs();
    const app = mountApp(stubs.deps);
    await post(app, {
      kind: 'individual',
      country: 'TZ',
      fullName: 'Asha Mwanaidi',
      phoneE164: '+255712345678',
      email: 'asha@example.com',
      defaultLanguage: 'sw',
      primaryCurrency: 'TZS',
    });
    await post(app, {
      kind: 'business',
      country: 'KE',
      orgName: 'Mawe Bora Ltd',
      businessRegistrationNumber: 'BRELA-12345',
      taxId: 'TIN-98765',
      ownerEmail: 'ceo@mawebora.example.com',
      ownerFullName: 'Yusuf Mwanaidi',
      ownerPhoneE164: '+254700123456',
      defaultLanguage: 'en',
      primaryCurrency: 'KES',
    });
    expect(stubs.auditEntries).toHaveLength(2);
    expect(stubs.auditEntries[0]!.kycAtomsInitialized).toEqual([
      'national_id_pending',
      'address_pending',
    ]);
    expect(stubs.auditEntries[1]!.kycAtomsInitialized).toEqual([
      'brela_pending',
      'tin_pending',
      'beneficial_owner_pending',
    ]);
  });
});
