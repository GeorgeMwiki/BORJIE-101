/**
 * JC-5 — signup jurisdiction-lock tests (4 cases).
 *
 *   1. happy path INDIVIDUAL: tenant writer receives the country code
 *      AND the route audit-chain entry records the lock.
 *   2. happy path BUSINESS: same lock semantics for a registered org.
 *   3. lock metadata is non-null: the writer receives a non-null
 *      ownerUserId so the FK in migration 0149 can attach.
 *   4. audit chain carries the lock signal: JC-7 admin override walks
 *      the chain looking for this signal as the canonical first lock.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createOrgsRouter,
  type SignupDeps,
  type SupabaseAdmin,
  type TenantWriter,
  type PersonaBinder,
  type AuditChainWriter,
  type SignupLogger,
} from '../index';

interface CapturedSignupAudit {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly accountKind: 'individual' | 'business';
  readonly country: string;
  readonly kycAtomsInitialized: ReadonlyArray<string>;
}

interface CapturedTenantWrite {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly accountKind: 'individual' | 'business';
  readonly country: string;
}

interface LockStubs {
  readonly deps: SignupDeps;
  readonly tenantWrites: CapturedTenantWrite[];
  readonly auditEntries: CapturedSignupAudit[];
}

function buildLockStubs(): LockStubs {
  const tenantWrites: CapturedTenantWrite[] = [];
  const auditEntries: CapturedSignupAudit[] = [];

  const supabaseAdmin: SupabaseAdmin = {
    async createUser({ email, phone }) {
      return { ok: true, user: { id: `sb_${email}`, email, phone } };
    },
    async sendPhoneOtp() {
      return { delivered: true };
    },
  };

  const tenantWriter: TenantWriter = {
    async createTenantAndOwner(input) {
      tenantWrites.push({
        tenantId: input.tenantId,
        ownerUserId: input.ownerUserId,
        accountKind: input.accountKind,
        country: input.country,
      });
      return { tenantId: input.tenantId, ownerUserId: input.ownerUserId };
    },
  };

  const personaBinder: PersonaBinder = {
    async bindOwnerPersona() {
      // no-op.
    },
  };

  const auditChain: AuditChainWriter = {
    async appendSignupEntry(input) {
      auditEntries.push({
        tenantId: input.tenantId,
        ownerUserId: input.ownerUserId,
        accountKind: input.accountKind,
        country: input.country,
        kycAtomsInitialized: input.kycAtomsInitialized,
      });
    },
  };

  const logger: SignupLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const deps: SignupDeps = {
    supabaseAdmin,
    tenantWriter,
    personaBinder,
    auditChain,
    logger,
    newTenantId: () => 'tn_lock_1',
    newUserId: () => 'usr_lock_1',
    newSlug: (seed) =>
      `${seed.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}-slug`,
  };

  return { deps, tenantWrites, auditEntries };
}

async function postSignup(deps: SignupDeps, body: unknown): Promise<Response> {
  const app = createOrgsRouter(deps);
  return app.request('/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const INDIVIDUAL_BODY = {
  kind: 'individual' as const,
  country: 'TZ' as const,
  fullName: 'Asha Mwita',
  phoneE164: '+255712345678',
  email: 'asha@example.com',
  defaultLanguage: 'sw' as const,
  primaryCurrency: 'TZS' as const,
};

const BUSINESS_BODY = {
  kind: 'business' as const,
  country: 'KE' as const,
  orgName: 'Nairobi Mineral Cooperative Ltd',
  businessRegistrationNumber: 'BRN-12345',
  taxId: 'TIN-67890',
  ownerEmail: 'ceo@nairobi-mining.example.com',
  ownerFullName: 'Wanjiru Karanja',
  ownerPhoneE164: '+254712345678',
  defaultLanguage: 'sw' as const,
  primaryCurrency: 'KES' as const,
};

describe('JC-5 — signup locks tenant jurisdiction at creation', () => {
  it('1. individual signup: writer receives the country + owner user id', async () => {
    const stubs = buildLockStubs();
    const res = await postSignup(stubs.deps, INDIVIDUAL_BODY);
    expect(res.status).toBe(201);
    expect(stubs.tenantWrites).toHaveLength(1);
    const w = stubs.tenantWrites[0]!;
    expect(w.country).toBe('TZ');
    expect(w.ownerUserId).toBe('usr_lock_1');
    expect(w.accountKind).toBe('individual');
  });

  it('2. business signup: writer locks the registered org as well', async () => {
    const stubs = buildLockStubs();
    const res = await postSignup(stubs.deps, BUSINESS_BODY);
    expect(res.status).toBe(201);
    const w = stubs.tenantWrites[0]!;
    expect(w.country).toBe('KE');
    expect(w.ownerUserId).toBe('usr_lock_1');
    expect(w.accountKind).toBe('business');
  });

  it('3. lock metadata is non-null: owner id is always populated so the FK in 0149 attaches', async () => {
    const stubs = buildLockStubs();
    await postSignup(stubs.deps, INDIVIDUAL_BODY);
    const w = stubs.tenantWrites[0]!;
    expect(w.ownerUserId).toBeTruthy();
    expect(w.ownerUserId.length).toBeGreaterThan(0);
    expect(w.country).toMatch(/^[A-Z]{2,5}$/u);
  });

  it('4. audit chain carries the country + owner id so JC-7 override can walk the lock history', async () => {
    const stubs = buildLockStubs();
    await postSignup(stubs.deps, INDIVIDUAL_BODY);
    expect(stubs.auditEntries).toHaveLength(1);
    const entry = stubs.auditEntries[0]!;
    expect(entry.tenantId).toBe('tn_lock_1');
    expect(entry.ownerUserId).toBe('usr_lock_1');
    expect(entry.country).toBe('TZ');
    // JC-5 backfills KYC atoms by account kind — keep that contract.
    expect(entry.kycAtomsInitialized.length).toBeGreaterThan(0);
  });
});
