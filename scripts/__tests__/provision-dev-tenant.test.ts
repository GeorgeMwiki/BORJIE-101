/**
 * provision-dev-tenant + seed-demo-data tests.
 *
 * Pure-helper + orchestration coverage. Real Postgres + Supabase paths
 * are exercised by a separate integration suite gated on DATABASE_URL +
 * a live api-gateway; these tests run on every machine and stub HTTP +
 * Postgres so they stay deterministic and fast.
 */

import { describe, it, expect } from 'vitest';
import {
  parseProvisionDevArgs,
  parseSeedDemoArgs,
  buildSignupBody,
  buildDemoDataPlan,
  seedAttributes,
  defaultCurrencyFor,
  defaultLanguageFor,
  ProvisionDevValidationError,
  SeedDemoValidationError,
} from '../lib/provision-dev-helpers.js';
import {
  provisionDevTenant,
  type DbClient,
  type HttpClient,
  type ProvisionDevResult,
  type SignupHttpResponse,
} from '../provision-dev-tenant.js';
import {
  seedDemoData,
  type AuthenticatedHttpClient,
  type SeedHttpResponse,
} from '../seed-demo-data.js';

// ─── parseProvisionDevArgs ───────────────────────────────────────────

describe('parseProvisionDevArgs — happy path', () => {
  it('accepts a full business signup with --flag value form', () => {
    const args = parseProvisionDevArgs([
      '--name', 'Acme Mining',
      '--email', 'owner@acme.test',
      '--phone', '+255700000000',
      '--kind', 'business',
      '--country', 'TZ',
    ]);
    expect(args.name).toBe('Acme Mining');
    expect(args.email).toBe('owner@acme.test');
    expect(args.phone).toBe('+255700000000');
    expect(args.kind).toBe('business');
    expect(args.country).toBe('TZ');
    expect(args.currency).toBe('TZS'); // defaulted from country
    expect(args.language).toBe('sw');  // defaulted from country
    expect(args.dryRun).toBe(false);
    expect(args.json).toBe(false);
    // Synthesised dev defaults present so /orgs/signup business schema passes.
    expect(args.businessRegistrationNumber.length).toBeGreaterThan(0);
    expect(args.taxId.length).toBeGreaterThan(0);
  });

  it('accepts --flag=value form and lower-cases the email', () => {
    const args = parseProvisionDevArgs([
      '--name=Acme',
      '--email=Owner@Example.Com',
      '--phone=+254700000000',
      '--kind=individual',
      '--country=KE',
      '--dry-run',
      '--json',
    ]);
    expect(args.email).toBe('owner@example.com');
    expect(args.kind).toBe('individual');
    expect(args.country).toBe('KE');
    expect(args.currency).toBe('KES');
    expect(args.language).toBe('en');
    expect(args.dryRun).toBe(true);
    expect(args.json).toBe(true);
  });

  it('respects explicit --currency / --language overrides', () => {
    const args = parseProvisionDevArgs([
      '--name=Acme',
      '--email=a@b.co',
      '--phone=+255700000000',
      '--currency=USD',
      '--language=en',
    ]);
    expect(args.currency).toBe('USD');
    expect(args.language).toBe('en');
  });

  it('carries an explicit --mining-licence', () => {
    const args = parseProvisionDevArgs([
      '--name=Acme',
      '--email=a@b.co',
      '--phone=+255700000000',
      '--mining-licence=ML-2026-001',
    ]);
    expect(args.miningLicenceNumber).toBe('ML-2026-001');
  });
});

describe('parseProvisionDevArgs — validation', () => {
  it('throws when --name is missing', () => {
    expect(() =>
      parseProvisionDevArgs([
        '--email=a@b.co',
        '--phone=+255700000000',
      ]),
    ).toThrow(ProvisionDevValidationError);
  });

  it('throws when --email is malformed', () => {
    expect(() =>
      parseProvisionDevArgs([
        '--name=Acme',
        '--email=not-an-email',
        '--phone=+255700000000',
      ]),
    ).toThrow(/email/);
  });

  it('throws when --phone is not E.164', () => {
    expect(() =>
      parseProvisionDevArgs([
        '--name=Acme',
        '--email=a@b.co',
        '--phone=0712345678',
      ]),
    ).toThrow(/E\.164/);
  });

  it('throws when --kind is not individual|business', () => {
    expect(() =>
      parseProvisionDevArgs([
        '--name=Acme',
        '--email=a@b.co',
        '--phone=+255700000000',
        '--kind=cooperative',
      ]),
    ).toThrow(/kind/);
  });

  it('throws when --country is not one of the allowed codes', () => {
    expect(() =>
      parseProvisionDevArgs([
        '--name=Acme',
        '--email=a@b.co',
        '--phone=+255700000000',
        '--country=ZA',
      ]),
    ).toThrow(/country/);
  });
});

// ─── buildSignupBody ────────────────────────────────────────────────

describe('buildSignupBody', () => {
  it('produces an individual signup body when kind=individual', () => {
    const args = parseProvisionDevArgs([
      '--name=Jane Owner',
      '--email=jane@acme.test',
      '--phone=+255700000000',
      '--kind=individual',
    ]);
    const body = buildSignupBody(args);
    expect(body.kind).toBe('individual');
    if (body.kind === 'individual') {
      expect(body.fullName).toBe('Jane Owner');
      expect(body.email).toBe('jane@acme.test');
      expect(body.phoneE164).toBe('+255700000000');
      expect(body.primaryCurrency).toBe('TZS');
    }
  });

  it('produces a business signup body with all required fields', () => {
    const args = parseProvisionDevArgs([
      '--name=Acme Mining',
      '--email=owner@acme.test',
      '--phone=+255700000000',
      '--kind=business',
      '--business-reg=BRELA-2026-XYZ',
      '--tax-id=TIN-9876543',
    ]);
    const body = buildSignupBody(args);
    expect(body.kind).toBe('business');
    if (body.kind === 'business') {
      expect(body.orgName).toBe('Acme Mining');
      expect(body.businessRegistrationNumber).toBe('BRELA-2026-XYZ');
      expect(body.taxId).toBe('TIN-9876543');
      expect(body.ownerEmail).toBe('owner@acme.test');
      expect(body.ownerPhoneE164).toBe('+255700000000');
    }
  });
});

// ─── defaultCurrencyFor / defaultLanguageFor ────────────────────────

describe('country defaults', () => {
  it('maps TZ → TZS / sw', () => {
    expect(defaultCurrencyFor('TZ')).toBe('TZS');
    expect(defaultLanguageFor('TZ')).toBe('sw');
  });

  it('maps OTHER → USD / en', () => {
    expect(defaultCurrencyFor('OTHER')).toBe('USD');
    expect(defaultLanguageFor('OTHER')).toBe('en');
  });
});

// ─── provisionDevTenant orchestration ────────────────────────────────

function stubArgs(overrides: Partial<Record<string, string>> = {}) {
  return parseProvisionDevArgs([
    `--name=${overrides.name ?? 'Acme Mining'}`,
    `--email=${overrides.email ?? 'owner@acme.test'}`,
    `--phone=${overrides.phone ?? '+255700000000'}`,
    `--kind=${overrides.kind ?? 'business'}`,
    `--country=${overrides.country ?? 'TZ'}`,
  ]);
}

function stubHttp(response: SignupHttpResponse): {
  readonly client: HttpClient;
  readonly calls: ReadonlyArray<{
    readonly url: string;
    readonly body: Readonly<Record<string, unknown>>;
  }>;
} {
  const calls: Array<{
    url: string;
    body: Readonly<Record<string, unknown>>;
  }> = [];
  const client: HttpClient = {
    async post(url, body) {
      calls.push({ url, body });
      return response;
    },
  };
  return Object.freeze({ client, calls });
}

function stubDb(input: {
  readonly existingTenantId?: string;
  readonly existingOwnerUserId?: string;
  readonly kycVerified?: boolean;
}): DbClient {
  return Object.freeze({
    async findTenantByOwnerPhone() {
      if (!input.existingTenantId || !input.existingOwnerUserId) return null;
      return Object.freeze({
        tenantId: input.existingTenantId,
        ownerUserId: input.existingOwnerUserId,
      });
    },
    async markKycVerified() {
      return input.kycVerified ?? true;
    },
  });
}

describe('provisionDevTenant', () => {
  it('dry-run skips HTTP + DB entirely', async () => {
    const http = stubHttp({ status: 500, body: 'should not be called' });
    const db = stubDb({});
    const args = { ...stubArgs(), dryRun: true } as ReturnType<typeof stubArgs>;
    const result: ProvisionDevResult = await provisionDevTenant(args, {
      http: http.client,
      db,
      gatewayUrl: 'http://localhost:4000',
    });
    expect(result.tenantId).toBe('dry-run-tenant');
    expect(http.calls.length).toBe(0);
  });

  it('posts to /api/v1/orgs/signup and returns the parsed tenant', async () => {
    const http = stubHttp({
      status: 201,
      body: {
        tenantId: 'tn_abc',
        ownerUserId: 'usr_xyz',
        kind: 'business',
        signupStatus: 'pending_otp_verification',
        otpRequired: true,
        kycAtomsInitialized: ['brela_pending'],
      },
    });
    const db = stubDb({ kycVerified: true });
    const args = stubArgs();
    const result = await provisionDevTenant(args, {
      http: http.client,
      db,
      gatewayUrl: 'http://localhost:4000',
    });
    expect(result.tenantId).toBe('tn_abc');
    expect(result.ownerUserId).toBe('usr_xyz');
    expect(result.alreadyExisted).toBe(false);
    expect(result.kycMarkedVerified).toBe(true);
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.url).toBe(
      'http://localhost:4000/api/v1/orgs/signup',
    );
    const body = http.calls[0]?.body as { kind?: string };
    expect(body?.kind).toBe('business');
  });

  it('is idempotent — existing tenant for phone returns without HTTP', async () => {
    const http = stubHttp({ status: 500, body: 'should not be called' });
    const db = stubDb({
      existingTenantId: 'tn_existing',
      existingOwnerUserId: 'usr_existing',
      kycVerified: true,
    });
    const args = stubArgs();
    const result = await provisionDevTenant(args, {
      http: http.client,
      db,
      gatewayUrl: 'http://localhost:4000',
    });
    expect(result.tenantId).toBe('tn_existing');
    expect(result.alreadyExisted).toBe(true);
    expect(result.kycMarkedVerified).toBe(true);
    expect(http.calls.length).toBe(0);
  });

  it('throws when signup returns non-201', async () => {
    const http = stubHttp({
      status: 409,
      body: { error: 'email_already_registered' },
    });
    const db = stubDb({});
    const args = stubArgs();
    await expect(
      provisionDevTenant(args, {
        http: http.client,
        db,
        gatewayUrl: 'http://localhost:4000',
      }),
    ).rejects.toThrow(/signup failed/);
  });

  it('throws when signup body is missing tenantId', async () => {
    const http = stubHttp({ status: 201, body: { ownerUserId: 'usr_x' } });
    const db = stubDb({});
    const args = stubArgs();
    await expect(
      provisionDevTenant(args, {
        http: http.client,
        db,
        gatewayUrl: 'http://localhost:4000',
      }),
    ).rejects.toThrow(/missing tenantId/);
  });
});

// ─── parseSeedDemoArgs ──────────────────────────────────────────────

describe('parseSeedDemoArgs', () => {
  it('accepts --tenant-id (uuid)', () => {
    const args = parseSeedDemoArgs([
      '--tenant-id=550e8400-e29b-41d4-a716-446655440000',
    ]);
    expect(args.tenantId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(args.seedRunId.startsWith('dev-seed-')).toBe(true);
  });

  it('accepts --phone instead of --tenant-id', () => {
    const args = parseSeedDemoArgs(['--phone=+255700000000']);
    expect(args.phone).toBe('+255700000000');
    expect(args.tenantId).toBeUndefined();
  });

  it('respects an explicit --seed-run-id', () => {
    const args = parseSeedDemoArgs([
      '--phone=+255700000000',
      '--seed-run-id=acme-may-2026',
    ]);
    expect(args.seedRunId).toBe('acme-may-2026');
  });

  it('throws when neither --tenant-id nor --phone is given', () => {
    expect(() => parseSeedDemoArgs([])).toThrow(SeedDemoValidationError);
  });

  it('throws when --tenant-id is not a UUID', () => {
    expect(() =>
      parseSeedDemoArgs(['--tenant-id=not-a-uuid']),
    ).toThrow(/UUID/);
  });

  it('throws when --seed-run-id contains illegal characters', () => {
    expect(() =>
      parseSeedDemoArgs([
        '--phone=+255700000000',
        '--seed-run-id=BAD ID!',
      ]),
    ).toThrow(/seed-run-id/);
  });
});

// ─── buildDemoDataPlan ──────────────────────────────────────────────

describe('buildDemoDataPlan', () => {
  const plan = buildDemoDataPlan();

  it('has the canonical 3 sites with TZ-region names', () => {
    expect(plan.sites).toHaveLength(3);
    expect(plan.sites.map((s) => s.name)).toEqual([
      'Geita Gold',
      'Mwanza Cu',
      'Mererani Tanzanite',
    ]);
  });

  it('has 5 workers per site (15 total)', () => {
    expect(plan.workers).toHaveLength(15);
    const bySite = new Map<number, number>();
    for (const w of plan.workers) {
      bySite.set(w.siteIndex, (bySite.get(w.siteIndex) ?? 0) + 1);
    }
    expect([...bySite.values()].every((n) => n === 5)).toBe(true);
  });

  it('has exactly 10 ore parcels across the 3 sites', () => {
    expect(plan.oreParcels).toHaveLength(10);
  });

  it('has 3 buyers and 1 bid per buyer', () => {
    expect(plan.buyers).toHaveLength(3);
    expect(plan.bids).toHaveLength(3);
  });

  it('has 2 incidents and 5 documents', () => {
    expect(plan.incidents).toHaveLength(2);
    expect(plan.documents).toHaveLength(5);
  });
});

// ─── seedAttributes ─────────────────────────────────────────────────

describe('seedAttributes', () => {
  it('always injects seed_run_id + seeded_by', () => {
    const attrs = seedAttributes('demo-run-1') as Record<string, unknown>;
    expect(attrs.seed_run_id).toBe('demo-run-1');
    expect(attrs.seeded_by).toBe('seed-demo-data-script');
  });

  it('merges in caller-provided extras', () => {
    const attrs = seedAttributes('demo-run-2', { source: 'manual' }) as Record<
      string,
      unknown
    >;
    expect(attrs.source).toBe('manual');
    expect(attrs.seed_run_id).toBe('demo-run-2');
  });
});

// ─── seedDemoData orchestration (dry-run) ────────────────────────────

describe('seedDemoData', () => {
  it('dry-run returns plan counts without HTTP calls', async () => {
    const calls: Array<{ path: string }> = [];
    const http: AuthenticatedHttpClient = {
      async request(_method, path): Promise<SeedHttpResponse> {
        calls.push({ path });
        return { status: 500, body: 'should not be called' };
      },
    };
    const args = parseSeedDemoArgs([
      '--tenant-id=550e8400-e29b-41d4-a716-446655440000',
      '--dry-run',
    ]);
    const result = await seedDemoData(
      '550e8400-e29b-41d4-a716-446655440000',
      args,
      { http },
    );
    expect(result.counts.sites).toBe(3);
    expect(result.counts.oreParcels).toBe(10);
    expect(result.counts.buyers).toBe(3);
    expect(result.counts.bids).toBe(3);
    expect(calls).toHaveLength(0);
  });
});
