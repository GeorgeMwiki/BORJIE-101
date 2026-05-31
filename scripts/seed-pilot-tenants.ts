#!/usr/bin/env node
/**
 * seed-pilot-tenants.ts — provision the three pilot demo tenants
 * (small / medium / large) plus persona bundles so pilot users land in
 * a live-looking mining estate the moment they sign in.
 *
 * NEVER runs against production. Refuses on NODE_ENV=production or any
 * DATABASE_URL that matches /prod|production|live/i.
 *
 * Three pilot tenants:
 *   - PILOT_TENANT_SMALL_ID   "Mwanza Gold Cooperative"  (1 PML,  3 owners, 12 workers)
 *   - PILOT_TENANT_MEDIUM_ID  "Geita Industrial Mining"  (1 ML,   1 owner, 50 workers)
 *   - PILOT_TENANT_LARGE_ID   "Tanzania Diamond Holdings"(1 SML,  5 owners, 200 workers)
 *
 * Per persona we attach: notifications, in-progress drafts, saved
 * searches, pinned items, recent tabs, decision-journal entries.
 *
 * The script honors RLS-FORCE by calling
 *   SELECT set_config('app.current_tenant_id', $tenantId, true)
 * inside a transaction per tenant before any insert. We use raw SQL
 * via `postgres` to match the existing borjie-mining-demo.seed.ts
 * pattern and to keep the script independent of Drizzle table imports
 * (some installs ship a partial schema).
 *
 * Every insert is ON CONFLICT ... DO NOTHING / DO UPDATE so re-running
 * is safe.
 *
 * Usage:
 *   pnpm run seed:pilot
 *   tsx scripts/seed-pilot-tenants.ts --only=small
 *   tsx scripts/seed-pilot-tenants.ts --dry-run
 *
 * Required env (loaded from .env.local by your shell or `dotenv-cli`):
 *   DATABASE_URL                — postgres pooler URL (dev only)
 *   SUPABASE_URL                — optional; if present users are mirrored
 *   SUPABASE_SERVICE_ROLE_KEY     into Supabase Auth as well.
 *
 * Exit codes:
 *   0 — converged
 *   1 — fatal error (DB / network)
 *   2 — validation error (bad CLI args / env)
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

type SeedRole = 'borjie_team' | 'owner' | 'site_manager' | 'driver' | 'buyer' | 'accountant';

interface PilotUser {
  readonly id: string;       // deterministic uuid
  readonly email: string;
  readonly password: string; // plaintext — written to gitignored credentials.json
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly role: SeedRole;
  readonly preferredLang: 'sw' | 'en';
}

interface PilotTenant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly scale: 'small' | 'medium' | 'large';
  readonly licenceKind: 'PML' | 'ML' | 'SML';
  readonly licenceNumber: string;
  readonly mineral: string;
  readonly areaHa: string;
  readonly region: string;
  readonly users: readonly PilotUser[];
  readonly workforceCount: number;
  readonly historyDays: number;
}

interface PilotCounts {
  tenant: string;
  scale: string;
  users: number;
  sites: number;
  licences: number;
  employees: number;
  shiftReports: number;
  productionEvents: number;
  royaltyFilings: number;
  salesContracts: number;
  marketplaceBids: number;
  buyers: number;
  pinnedItems: number;
  savedSearches: number;
  drafts: number;
  decisionJournal: number;
  ledgerEntries: number;
}

// ───────────────────────────────────────────────────────────────────────
// Fixture data
// ───────────────────────────────────────────────────────────────────────

const PILOT_TENANTS: readonly PilotTenant[] = [
  {
    id: '00000000-0000-0000-0000-0000000aa001',
    slug: 'pilot-mwanza-gold',
    name: 'Mwanza Gold Cooperative',
    scale: 'small',
    licenceKind: 'PML',
    licenceNumber: 'PML-2024-MWA-001',
    mineral: 'Au',
    areaHa: '5.0000',
    region: 'Mwanza',
    workforceCount: 12,
    historyDays: 30,
    users: [
      {
        id: '00000000-0000-0000-0000-00000aaa0001',
        email: 'owner.small+1@example.com',
        password: 'Pilot!Mwanza#2026',
        firstName: 'Hamisi',
        lastName: 'Mwanga',
        phone: '+255711000001',
        role: 'owner',
        preferredLang: 'sw',
      },
      {
        id: '00000000-0000-0000-0000-00000aaa0002',
        email: 'owner.small+2@example.com',
        password: 'Pilot!Mwanza#2026',
        firstName: 'Salama',
        lastName: 'Kabwe',
        phone: '+255711000002',
        role: 'owner',
        preferredLang: 'sw',
      },
      {
        id: '00000000-0000-0000-0000-00000aaa0003',
        email: 'owner.small+3@example.com',
        password: 'Pilot!Mwanza#2026',
        firstName: 'Juma',
        lastName: 'Magesa',
        phone: '+255711000003',
        role: 'owner',
        preferredLang: 'sw',
      },
      {
        id: '00000000-0000-0000-0000-00000aaa0004',
        email: 'manager.small+1@example.com',
        password: 'Pilot!Mwanza#2026',
        firstName: 'Asha',
        lastName: 'Mwakasege',
        phone: '+255711000004',
        role: 'site_manager',
        preferredLang: 'sw',
      },
      {
        id: '00000000-0000-0000-0000-00000aaa0005',
        email: 'manager.small+2@example.com',
        password: 'Pilot!Mwanza#2026',
        firstName: 'Baraka',
        lastName: 'Komba',
        phone: '+255711000005',
        role: 'site_manager',
        preferredLang: 'sw',
      },
    ],
  },
  {
    id: '00000000-0000-0000-0000-0000000bb001',
    slug: 'pilot-geita-industrial',
    name: 'Geita Industrial Mining Ltd',
    scale: 'medium',
    licenceKind: 'ML',
    licenceNumber: 'ML-2022-GEI-014',
    mineral: 'Au+Cu',
    areaHa: '200.0000',
    region: 'Geita',
    workforceCount: 50,
    historyDays: 90,
    users: [
      {
        id: '00000000-0000-0000-0000-00000bbb0001',
        email: 'owner.medium+1@example.com',
        password: 'Pilot!Geita#2026',
        firstName: 'Frederick',
        lastName: 'Mwasebia',
        phone: '+255712000001',
        role: 'owner',
        preferredLang: 'en',
      },
      {
        id: '00000000-0000-0000-0000-00000bbb0002',
        email: 'manager.medium+1@example.com',
        password: 'Pilot!Geita#2026',
        firstName: 'Imani',
        lastName: 'Ngowi',
        phone: '+255712000002',
        role: 'site_manager',
        preferredLang: 'en',
      },
      {
        id: '00000000-0000-0000-0000-00000bbb0003',
        email: 'manager.medium+2@example.com',
        password: 'Pilot!Geita#2026',
        firstName: 'Tunu',
        lastName: 'Kalinga',
        phone: '+255712000003',
        role: 'site_manager',
        preferredLang: 'sw',
      },
      {
        id: '00000000-0000-0000-0000-00000bbb0004',
        email: 'manager.medium+3@example.com',
        password: 'Pilot!Geita#2026',
        firstName: 'Goodluck',
        lastName: 'Mwakalinga',
        phone: '+255712000004',
        role: 'site_manager',
        preferredLang: 'en',
      },
      {
        id: '00000000-0000-0000-0000-00000bbb0005',
        email: 'accountant.medium+1@example.com',
        password: 'Pilot!Geita#2026',
        firstName: 'Pendo',
        lastName: 'Nyerere',
        phone: '+255712000005',
        role: 'admin',
        preferredLang: 'en',
      },
    ],
  },
  {
    id: '00000000-0000-0000-0000-0000000cc001',
    slug: 'pilot-tz-diamond-holdings',
    name: 'Tanzania Diamond Holdings',
    scale: 'large',
    licenceKind: 'SML',
    licenceNumber: 'SML-2019-DIA-007',
    mineral: 'Diamond+Tanzanite',
    areaHa: '500.0000',
    region: 'Shinyanga',
    workforceCount: 200,
    historyDays: 180,
    users: [
      {
        id: '00000000-0000-0000-0000-00000ccc0001',
        email: 'owner.large+1@example.com',
        password: 'Pilot!Diamond#2026',
        firstName: 'Esther',
        lastName: 'Mushi',
        phone: '+255713000001',
        role: 'owner',
        preferredLang: 'en',
      },
      {
        id: '00000000-0000-0000-0000-00000ccc0002',
        email: 'owner.large+2@example.com',
        password: 'Pilot!Diamond#2026',
        firstName: 'Daniel',
        lastName: 'Mkenda',
        phone: '+255713000002',
        role: 'owner',
        preferredLang: 'en',
      },
      {
        id: '00000000-0000-0000-0000-00000ccc0003',
        email: 'manager.large+1@example.com',
        password: 'Pilot!Diamond#2026',
        firstName: 'Faraja',
        lastName: 'Kileo',
        phone: '+255713000003',
        role: 'site_manager',
        preferredLang: 'en',
      },
      {
        id: '00000000-0000-0000-0000-00000ccc0004',
        email: 'accountant.large+1@example.com',
        password: 'Pilot!Diamond#2026',
        firstName: 'Saida',
        lastName: 'Mtui',
        phone: '+255713000004',
        role: 'admin',
        preferredLang: 'en',
      },
      {
        id: '00000000-0000-0000-0000-00000ccc0005',
        email: 'buyer.large+1@example.com',
        password: 'Pilot!Diamond#2026',
        firstName: 'Pamoja',
        lastName: 'Refinery',
        phone: '+255713000005',
        role: 'buyer',
        preferredLang: 'en',
      },
    ],
  },
];

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

interface CliArgs {
  readonly only: ReadonlyArray<'small' | 'medium' | 'large'>;
  readonly dryRun: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const only: Array<'small' | 'medium' | 'large'> = [];
  let dryRun = false;
  for (const arg of argv) {
    const m = arg.match(/^--only=(small|medium|large)$/);
    if (m && m[1]) only.push(m[1] as 'small' | 'medium' | 'large');
    if (arg === '--dry-run') dryRun = true;
  }
  return { only, dryRun };
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function assertNotProduction(databaseUrl: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-pilot-tenants refuses to run with NODE_ENV=production');
  }
  if (/prod|production|live/i.test(databaseUrl)) {
    throw new Error('DATABASE_URL looks like production — refusing to run');
  }
}

function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),       // version 4
    '8' + h.slice(17, 20),       // variant
    h.slice(20, 32),
  ].join('-');
}

const SEED_PROVENANCE = {
  via: 'pilot_seed' as const,
  actorId: null,
  sessionId: null,
  turnId: null,
  requestedAt: new Date().toISOString(),
};

// ───────────────────────────────────────────────────────────────────────
// Table existence cache — keep us forward-compatible if a schema is
// missing in a partial install.
// ───────────────────────────────────────────────────────────────────────

const tableExists = new Map<string, boolean>();

async function hasTable(
  sql: ReturnType<typeof postgres>,
  table: string,
): Promise<boolean> {
  const cached = tableExists.get(table);
  if (typeof cached === 'boolean') return cached;
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `;
  const exists = rows[0]?.exists === true;
  tableExists.set(table, exists);
  return exists;
}

async function hasColumn(
  sql: ReturnType<typeof postgres>,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

// ───────────────────────────────────────────────────────────────────────
// Per-tenant seed
// ───────────────────────────────────────────────────────────────────────

async function seedTenant(
  sql: ReturnType<typeof postgres>,
  tenant: PilotTenant,
  dryRun: boolean,
): Promise<PilotCounts> {
  const counts: PilotCounts = {
    tenant: tenant.name,
    scale: tenant.scale,
    users: 0,
    sites: 0,
    licences: 0,
    employees: 0,
    shiftReports: 0,
    productionEvents: 0,
    royaltyFilings: 0,
    salesContracts: 0,
    marketplaceBids: 0,
    buyers: 0,
    pinnedItems: 0,
    savedSearches: 0,
    drafts: 0,
    decisionJournal: 0,
    ledgerEntries: 0,
  };

  if (dryRun) {
    console.log(`[dry-run] would seed ${tenant.name} (${tenant.scale})`);
    counts.users = tenant.users.length;
    counts.employees = tenant.workforceCount;
    return counts;
  }

  // RLS-FORCE: bind GUC for the transaction.
  await sql`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;

  // 1. Tenant row
  await sql`
    INSERT INTO tenants (
      id, name, slug, status, subscription_tier, plan,
      primary_email, country, region
    ) VALUES (
      ${tenant.id},
      ${tenant.name},
      ${tenant.slug},
      'active',
      ${tenant.scale === 'large' ? 'enterprise' : tenant.scale === 'medium' ? 'growth' : 'starter'},
      'kampuni',
      ${'pilot+' + tenant.slug + '@example.com'},
      'TZ',
      'af-south-1'
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      updated_at = now()
  `;

  // 2. Holding company
  const companyId = deterministicUuid(`${tenant.id}:company`);
  if (await hasTable(sql, 'companies')) {
    await sql`
      INSERT INTO companies (
        id, tenant_id, name, registration_no, tin, country,
        registered_address, attributes
      ) VALUES (
        ${companyId},
        ${tenant.id},
        ${tenant.name + ' (Holding Co.)'},
        ${'BRELA-' + tenant.slug.toUpperCase().slice(0, 12)},
        ${'TIN-' + tenant.id.slice(-6)},
        'TZ',
        ${'Pilot Address — ' + tenant.region + ', Tanzania'},
        ${JSON.stringify({ scale: tenant.scale, isPilot: true })}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    `;
  }

  // 3. Users (mirror into public.users — auth.users created separately
  // by Supabase admin call when SUPABASE_SERVICE_ROLE_KEY is present;
  // see upsertSupabaseAuthUsers below).
  for (const u of tenant.users) {
    await sql`
      INSERT INTO users (
        id, tenant_id, email, first_name, last_name, phone,
        status, is_owner, mining_role, preferred_lang, activated_at
      ) VALUES (
        ${u.id},
        ${tenant.id},
        ${u.email},
        ${u.firstName},
        ${u.lastName},
        ${u.phone},
        'active',
        ${u.role === 'owner'},
        ${u.role},
        ${u.preferredLang},
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        phone = EXCLUDED.phone,
        mining_role = EXCLUDED.mining_role,
        preferred_lang = EXCLUDED.preferred_lang,
        updated_at = now()
    `;
    counts.users += 1;
  }
  const ownerUserId = tenant.users.find((u) => u.role === 'owner')?.id ?? null;
  const managerUserId =
    tenant.users.find((u) => u.role === 'site_manager')?.id ?? null;

  // 4. Licence + site (one per pilot tenant for simplicity; counts scale
  // via employees / shifts / sales).
  const licenceId = deterministicUuid(`${tenant.id}:licence`);
  const siteId = deterministicUuid(`${tenant.id}:site`);
  if (await hasTable(sql, 'licences')) {
    const grant = new Date();
    grant.setFullYear(grant.getFullYear() - 5);
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 5);
    await sql`
      INSERT INTO licences (
        id, tenant_id, company_id, kind, number, mineral,
        holder_user_id, grant_date, expiry_date, area_ha, status,
        fees, obligations, dormancy_score
      ) VALUES (
        ${licenceId},
        ${tenant.id},
        ${companyId},
        ${tenant.licenceKind},
        ${tenant.licenceNumber},
        ${tenant.mineral},
        ${ownerUserId},
        ${grant.toISOString().slice(0, 10)},
        ${expiry.toISOString().slice(0, 10)},
        ${tenant.areaHa},
        'active',
        ${JSON.stringify({ annual_fee_tzs: 10_000_000, royalty_rate_pct: 6, inspection_pct: 0.3 })}::jsonb,
        ${JSON.stringify({ epp: true, eia: tenant.scale !== 'small', community_benefit_pct: 1 })}::jsonb,
        5
      )
      ON CONFLICT (id) DO UPDATE SET expiry_date = EXCLUDED.expiry_date, updated_at = now()
    `;
    counts.licences += 1;
  }
  if (await hasTable(sql, 'sites')) {
    await sql`
      INSERT INTO sites (
        id, tenant_id, licence_id, name, mineral, phase, manager_user_id,
        geology_confidence, status, attributes
      ) VALUES (
        ${siteId},
        ${tenant.id},
        ${licenceId},
        ${tenant.name + ' — Main Pit'},
        ${tenant.mineral},
        'extraction',
        ${managerUserId},
        '0.72',
        'active',
        ${JSON.stringify({ region: tenant.region, scale: tenant.scale, isPilot: true })}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET phase = EXCLUDED.phase, updated_at = now()
    `;
    counts.sites += 1;
  }

  // 5. Workforce (employees) — generated deterministically up to count.
  if (await hasTable(sql, 'employees')) {
    const roles: ReadonlyArray<{
      role: string;
      basis: 'daily' | 'monthly' | 'production_share';
      rate: string;
      type: string;
    }> = [
      { role: 'driller', basis: 'daily', rate: '35000', type: 'PML_employee' },
      { role: 'sorter', basis: 'daily', rate: '20000', type: 'casual' },
      { role: 'security_guard', basis: 'monthly', rate: '450000', type: 'contractor' },
      { role: 'foreman', basis: 'monthly', rate: '850000', type: 'PML_employee' },
      { role: 'driver', basis: 'monthly', rate: '380000', type: 'PML_employee' },
    ];
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 12);
    for (let i = 0; i < tenant.workforceCount; i++) {
      const r = roles[i % roles.length]!;
      const empId = deterministicUuid(`${tenant.id}:emp:${i}`);
      await sql`
        INSERT INTO employees (
          id, tenant_id, company_id, site_id, full_name, role,
          wage_basis, wage_rate_tzs, employment_type, nationality,
          status, start_date
        ) VALUES (
          ${empId},
          ${tenant.id},
          ${companyId},
          ${siteId},
          ${`${r.role.charAt(0).toUpperCase() + r.role.slice(1)} #${i + 1}`},
          ${r.role},
          ${r.basis},
          ${r.rate},
          ${r.type},
          'TZ',
          'active',
          ${startDate.toISOString().slice(0, 10)}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      counts.employees += 1;
    }
  }

  // 6. Shift reports — historyDays rows.
  if (await hasTable(sql, 'shift_reports')) {
    for (let d = 0; d < tenant.historyDays; d++) {
      const day = new Date();
      day.setDate(day.getDate() - d);
      const id = deterministicUuid(`${tenant.id}:shift:${d}`);
      await sql`
        INSERT INTO shift_reports (
          id, tenant_id, site_id, shift_date, shift_kind,
          workers_present, rom_tonnes, fuel_litres, next_shift_plan
        ) VALUES (
          ${id},
          ${tenant.id},
          ${siteId},
          ${day.toISOString().slice(0, 10)},
          ${d % 2 === 0 ? 'day' : 'night'},
          ${Math.max(5, Math.floor(tenant.workforceCount * 0.7))},
          ${(50 + (d % 20)).toString()},
          ${(180 + (d % 40)).toString()},
          ${'Pilot shift report for ' + tenant.name}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      counts.shiftReports += 1;
    }
  }

  // 7. Production tonnage events — coarse-grained.
  if (await hasTable(sql, 'production_tonnage_events')) {
    const events = Math.floor(tenant.historyDays / 3);
    for (let i = 0; i < events; i++) {
      const id = deterministicUuid(`${tenant.id}:prod:${i}`);
      const at = new Date();
      at.setDate(at.getDate() - i * 3);
      await sql`
        INSERT INTO production_tonnage_events (
          id, tenant_id, site_id, recorded_by_id, ore_tonnes,
          waste_tonnes, captured_at, source
        ) VALUES (
          ${id},
          ${tenant.id},
          ${siteId},
          ${ownerUserId ?? tenant.users[0]?.id ?? null},
          ${(120 + i * 3).toString()},
          ${(40 + i * 2).toString()},
          ${at.toISOString()},
          'manual_entry'
        )
        ON CONFLICT (id) DO NOTHING
      `;
      counts.productionEvents += 1;
    }
  }

  // 8. Royalty filings — quarterly cadence (live table: regulatory_filings).
  if (await hasTable(sql, 'regulatory_filings')) {
    const filings = tenant.scale === 'small' ? 5 : tenant.scale === 'medium' ? 8 : 12;
    for (let i = 0; i < filings; i++) {
      const id = deterministicUuid(`${tenant.id}:royalty:${i}`);
      const period = new Date();
      period.setMonth(period.getMonth() - i * 3);
      await sql`
        INSERT INTO regulatory_filings (
          id, tenant_id, regulator, filing_type, due_at,
          submitted_at, status, fee_paid_tzs, notes
        ) VALUES (
          ${id},
          ${tenant.id},
          'mining_commission',
          'royalty_return',
          ${new Date(period.getTime() + 90 * 24 * 3600 * 1000).toISOString()},
          ${i < 2 ? null : new Date(period.getTime() + 60 * 24 * 3600 * 1000).toISOString()},
          ${i < 2 ? 'upcoming' : 'submitted'},
          ${(6_000_000 + i * 600_000).toString()},
          ${'Pilot quarterly royalty return for ' + tenant.name}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      counts.royaltyFilings += 1;
    }
  }

  // 9. Buyer + sales contracts.
  const buyerId = deterministicUuid(`${tenant.id}:buyer`);
  if (await hasTable(sql, 'buyers')) {
    await sql`
      INSERT INTO buyers (
        id, tenant_id, name, kind, country, licence_number,
        contact_name, contact_email, contact_phone, kyc_status,
        credit_limit_tzs, aml_status
      ) VALUES (
        ${buyerId},
        ${tenant.id},
        ${tenant.scale === 'large' ? 'Pamoja Refinery International' : 'Lake Zone Trading'},
        'export_buyer',
        'TZ',
        ${'DEALER-PILOT-' + tenant.slug.slice(-6).toUpperCase()},
        'Joseph Mhagama',
        'buyer.pilot+1@example.com',
        '+255713445566',
        'verified',
        ${tenant.scale === 'large' ? '500000000' : '150000000'},
        'clear'
      )
      ON CONFLICT (id) DO UPDATE SET kyc_status = EXCLUDED.kyc_status
    `;
    counts.buyers += 1;
  }
  // Sales (scale-dependent) — live table `sales`; each references an ore_parcel.
  if ((await hasTable(sql, 'sales')) && (await hasTable(sql, 'ore_parcels'))) {
    const contracts = tenant.scale === 'small' ? 2 : tenant.scale === 'medium' ? 10 : 30;
    for (let i = 0; i < contracts; i++) {
      const id = deterministicUuid(`${tenant.id}:sale:${i}`);
      const parcelId = deterministicUuid(`${tenant.id}:parcel:${i}`);
      const signed = new Date();
      signed.setDate(signed.getDate() - i * 5);
      const grossTzs = (50 + i * 5) * (5_000_000 + i * 100_000);
      await sql`
        INSERT INTO ore_parcels (id, tenant_id, site_id)
        VALUES (${parcelId}, ${tenant.id}, ${siteId})
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO sales (
          id, tenant_id, parcel_id, buyer_id, route,
          gross_price_tzs, net_tzs, payment_status, ts
        ) VALUES (
          ${id},
          ${tenant.id},
          ${parcelId},
          ${buyerId},
          'trader',
          ${grossTzs.toString()},
          ${Math.round(grossTzs * 0.9).toString()},
          ${i < 2 ? 'pending' : 'paid'},
          ${signed.toISOString()}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      counts.salesContracts += 1;
    }
  }

  // 10. Marketplace listings + bids — large tenant only.
  if (
    tenant.scale === 'large' &&
    (await hasTable(sql, 'marketplace_bids')) &&
    (await hasTable(sql, 'marketplace_listings'))
  ) {
    const mineral = tenant.mineral.split('+')[0] ?? 'Au';
    for (let l = 0; l < 5; l++) {
      await sql`
        INSERT INTO marketplace_listings (id, tenant_id, category, title)
        VALUES (
          ${deterministicUuid(`${tenant.id}:listing:${l}`)},
          ${tenant.id},
          'mineral',
          ${`${mineral} parcel — lot ${l + 1}`}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
    for (let i = 0; i < 20; i++) {
      const id = deterministicUuid(`${tenant.id}:bid:${i}`);
      const created = new Date();
      created.setDate(created.getDate() - i);
      await sql`
        INSERT INTO marketplace_bids (
          id, tenant_id, listing_id, buyer_id, bid_price_tzs,
          status, created_at
        ) VALUES (
          ${id},
          ${tenant.id},
          ${deterministicUuid(`${tenant.id}:listing:${i % 5}`)},
          ${buyerId},
          ${(20_000_000 + i * 1_000_000).toString()},
          ${i < 3 ? 'pending' : i < 10 ? 'accepted' : 'rejected'},
          ${created.toISOString()}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      counts.marketplaceBids += 1;
    }
  }

  // 11. Ledger entries — basic cash-flow trace for the large tenant.
  if (tenant.scale === 'large' && (await hasTable(sql, 'ledger_entries'))) {
    const cols = await hasColumn(sql, 'ledger_entries', 'amount_tzs');
    if (cols) {
      for (let i = 0; i < 30; i++) {
        const id = deterministicUuid(`${tenant.id}:ledger:${i}`);
        const at = new Date();
        at.setDate(at.getDate() - i);
        await sql`
          INSERT INTO ledger_entries (
            id, tenant_id, occurred_at, debit_account, credit_account,
            amount_tzs, memo
          ) VALUES (
            ${id},
            ${tenant.id},
            ${at.toISOString()},
            ${'cash:bank:main'},
            ${'revenue:mineral_sales'},
            ${(50_000_000 + i * 1_000_000).toString()},
            ${'Pilot ledger entry #' + (i + 1)}
          )
          ON CONFLICT (id) DO NOTHING
        `;
        counts.ledgerEntries += 1;
      }
    }
  }

  // 12. Persona bundles — per user
  for (const u of tenant.users) {
    // Pinned items
    if (await hasTable(sql, 'pinned_items')) {
      const pins = [
        { entity: 'licence', id: licenceId, label: tenant.licenceNumber },
        { entity: 'site', id: siteId, label: tenant.name + ' — Main Pit' },
      ];
      for (let i = 0; i < pins.length; i++) {
        const p = pins[i]!;
        await sql`
          INSERT INTO pinned_items (
            id, tenant_id, owner_id, entity_type, entity_id, label, position
          ) VALUES (
            ${deterministicUuid(`${tenant.id}:${u.id}:pin:${i}`)},
            ${tenant.id},
            ${u.id},
            ${p.entity},
            ${p.id},
            ${p.label},
            ${i}
          )
          ON CONFLICT DO NOTHING
        `;
        counts.pinnedItems += 1;
      }
    }
    // Saved searches
    if (await hasTable(sql, 'saved_searches') && u.role !== 'driver') {
      await sql`
        INSERT INTO saved_searches (
          id, tenant_id, user_id, label, query_json, source, frequency
        ) VALUES (
          ${deterministicUuid(`${tenant.id}:${u.id}:search:1`)},
          ${tenant.id},
          ${u.id},
          ${'Au buyers offering > 5M TZS/kg'},
          ${JSON.stringify({ commodity: 'Au', minPriceTzsPerKg: 5_000_000 })}::jsonb,
          'marketplace',
          'daily'
        )
        ON CONFLICT (id) DO NOTHING
      `;
      counts.savedSearches += 1;
    }
    // In-progress document draft (one per owner)
    if (u.role === 'owner' && (await hasTable(sql, 'document_drafts'))) {
      await sql`
        INSERT INTO document_drafts (
          id, tenant_id, created_by_user_id, kind, status,
          title_sw, title_en, jurisdiction, language, content_md
        ) VALUES (
          ${deterministicUuid(`${tenant.id}:${u.id}:draft:1`)},
          ${tenant.id},
          ${u.id},
          'letter',
          'drafting',
          ${'Barua kwa TMAA — ongezeko la kibali'},
          'Letter to TMAA — licence extension request',
          'TZ',
          'sw',
          ${'# Hello TMAA\n\nNaomba kuongezewa muda wa kibali ' + tenant.licenceNumber + '...'}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      counts.drafts += 1;
    }
    // Decision journal entry (one per owner)
    if (u.role === 'owner' && (await hasTable(sql, 'decisions'))) {
      const hasChain = await hasColumn(sql, 'decisions', 'entry_hash');
      if (hasChain) {
        const rowHash = createHash('sha256')
          .update(`${tenant.id}:${u.id}:decision:1`)
          .digest('hex');
        await sql`
          INSERT INTO decisions (
            id, tenant_id, decided_by_kind, decided_by_actor_id,
            decision_subject, decided_value, alternatives_considered, rationale,
            confidence, status, prev_hash, entry_hash
          ) VALUES (
            ${deterministicUuid(`${tenant.id}:${u.id}:decision:1`)},
            ${tenant.id},
            'owner',
            ${u.id},
            ${'buyer_selection'},
            ${JSON.stringify({ buyerId, reason: 'best_price' })}::jsonb,
            ${JSON.stringify([{ buyer: 'alt-1', price: 4_500_000 }])}::jsonb,
            'Selected buyer offering highest TZS/kg with verified KYC.',
            '0.82',
            'committed',
            ${null},
            ${rowHash}
          )
          ON CONFLICT (id) DO NOTHING
        `;
        counts.decisionJournal += 1;
      }
    }
  }

  return counts;
}

// ───────────────────────────────────────────────────────────────────────
// Supabase Auth mirror (optional)
// ───────────────────────────────────────────────────────────────────────

async function upsertSupabaseAuthUsers(tenants: readonly PilotTenant[]): Promise<void> {
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.warn(
      '[pilot-seed] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping auth user creation.',
    );
    return;
  }
  let supabase;
  try {
    // Dynamic import keeps this script runnable in installs without supabase-js.
    const mod = await import('@supabase/supabase-js');
    supabase = mod.createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch {
    console.warn('[pilot-seed] @supabase/supabase-js not available — skipping auth user creation.');
    return;
  }
  for (const t of tenants) {
    for (const u of t.users) {
      const appMetadata = { tenant_id: t.id, mining_role: u.role };
      const userMetadata = {
        first_name: u.firstName,
        last_name: u.lastName,
        preferred_lang: u.preferredLang,
        pilot: true,
      };
      const { error } = await supabase.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        app_metadata: appMetadata,
        user_metadata: userMetadata,
      });
      if (error && !/already (registered|exists)/i.test(error.message)) {
        console.warn(`[pilot-seed] auth.createUser ${u.email} failed: ${error.message}`);
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────
// Credentials file
// ───────────────────────────────────────────────────────────────────────

function writeCredentialsFile(tenants: readonly PilotTenant[]): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(__dirname, 'pilot-credentials.json');
  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    warning: 'PLAINTEXT credentials for pilot demo only. Gitignored.',
    tenants: tenants.map((t) => ({
      tenantId: t.id,
      name: t.name,
      scale: t.scale,
      personas: t.users.map((u) => ({
        email: u.email,
        password: u.password,
        role: u.role,
        firstName: u.firstName,
        lastName: u.lastName,
      })),
    })),
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 });
  return outPath;
}

// ───────────────────────────────────────────────────────────────────────
// Live verification — query three endpoints with seeded tenant context.
// ───────────────────────────────────────────────────────────────────────

interface VerifyResult {
  readonly tenant: string;
  readonly checks: ReadonlyArray<{ name: string; nonEmpty: boolean; rowCount: number }>;
}

async function verifyTenant(
  sql: ReturnType<typeof postgres>,
  tenant: PilotTenant,
): Promise<VerifyResult> {
  await sql`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
  const checks: Array<{ name: string; nonEmpty: boolean; rowCount: number }> = [];
  if (await hasTable(sql, 'users')) {
    const r = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM users WHERE tenant_id = ${tenant.id}`;
    checks.push({ name: 'users', rowCount: r[0]!.c, nonEmpty: r[0]!.c > 0 });
  }
  if (await hasTable(sql, 'sites')) {
    const r = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM sites WHERE tenant_id = ${tenant.id}`;
    checks.push({ name: 'sites', rowCount: r[0]!.c, nonEmpty: r[0]!.c > 0 });
  }
  if (await hasTable(sql, 'employees')) {
    const r = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM employees WHERE tenant_id = ${tenant.id}`;
    checks.push({ name: 'employees', rowCount: r[0]!.c, nonEmpty: r[0]!.c > 0 });
  }
  return { tenant: tenant.name, checks };
}

// ───────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = requireEnv('DATABASE_URL');
  assertNotProduction(databaseUrl);

  const targets =
    args.only.length > 0
      ? PILOT_TENANTS.filter((t) => args.only.includes(t.scale))
      : PILOT_TENANTS;

  console.log(`[pilot-seed] target tenants: ${targets.map((t) => t.scale).join(', ')}`);

  const sql = postgres(databaseUrl, { max: 1 });
  const allCounts: PilotCounts[] = [];
  const verifyResults: VerifyResult[] = [];

  try {
    for (const tenant of targets) {
      console.log(`[pilot-seed] seeding ${tenant.scale} — ${tenant.name}`);
      // Each tenant runs in its own transaction so RLS GUC is scoped.
      const counts = await sql.begin(async (txn) => {
        return seedTenant(txn as unknown as ReturnType<typeof postgres>, tenant, args.dryRun);
      });
      allCounts.push(counts);
    }

    if (!args.dryRun) {
      for (const tenant of targets) {
        // Wrap in a transaction so the LOCAL app.current_tenant_id GUC
        // (set_config(..., true)) survives across the verify queries.
        // Outside a transaction the LOCAL setting is discarded after the
        // set_config statement's implicit commit, leaving RLS-FORCE to
        // filter every row and report a false FAIL.
        const res = await sql.begin(async (txn) =>
          verifyTenant(txn as unknown as ReturnType<typeof postgres>, tenant),
        );
        verifyResults.push(res);
      }
    }
  } finally {
    await sql.end();
  }

  if (!args.dryRun) {
    await upsertSupabaseAuthUsers(targets);
    const credPath = writeCredentialsFile(targets);
    console.log(`[pilot-seed] credentials written: ${credPath}`);
  }

  console.log('\n[pilot-seed] === COUNTS ===');
  for (const c of allCounts) {
    console.log(JSON.stringify(c, null, 2));
  }
  if (verifyResults.length > 0) {
    console.log('\n[pilot-seed] === VERIFY ===');
    for (const v of verifyResults) {
      console.log(`${v.tenant}:`);
      for (const c of v.checks) {
        console.log(`  ${c.nonEmpty ? 'PASS' : 'FAIL'}  ${c.name.padEnd(20)} ${c.rowCount} rows`);
      }
    }
  }
  console.log('\n[pilot-seed] done.');
}

main().catch((err) => {
  console.error('[pilot-seed] FATAL:', err);
  process.exit(err instanceof Error && err.message.includes('Missing required env') ? 2 : 1);
});
