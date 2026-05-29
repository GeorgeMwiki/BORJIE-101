/**
 * Borjie — Mining Demo Data Seed
 *
 * Companion to `borjie-test-users.seed.ts`. Wires up the 5 seeded test
 * users to a recognizable Tanzanian mining operation so live testers can
 * exercise the full Mr. Mwikila flow against real shaped data instead of
 * empty tables.
 *
 * DEV / LIVE-TEST ONLY. Refuses to run when NODE_ENV === 'production'.
 *
 * Provisions (all idempotent — re-run is safe):
 *   - 1 demo tenant (text id; matches Docs/AUDIT/* references)
 *   - 1 holding company (Tanzanian BRELA + TRA placeholders)
 *   - 3 mining sites with realistic TZ regional names
 *     (Mwadui Kimberley, Mererani Tanzanite, Kabanga Nickel)
 *   - 3 licences (1 SML, 1 PML, 1 PL) tied to the sites
 *   - 12 workforce records (foreman, drillers, sorters, security)
 *   - 4 mining tasks (drilling, sorting, transport, payroll)
 *   - 2 owner reminders (licence renewal, royalty payment)
 *   - 1 buyer + 1 ore parcel + 1 mineral sale
 *   - 1 chain-of-custody step (extract → store)
 *   - 1 cooperative settlement period (draft)
 *   - 1 in-progress LOI document draft (kind=letter, status=drafting)
 *   - 1 open risk (licence dormancy) + 1 open task (sample assay)
 *
 * Invocation:
 *   pnpm tsx packages/database/src/seeds/borjie-mining-demo.seed.ts
 *
 * Required env:
 *   DATABASE_URL                                — postgres pooler URL
 *   SEED_TEST_TENANT_ID (optional)              — default 00000000-...001
 *   SEED_TEST_TENANT_NAME (optional)            — default 'Demo Mining Estate Ltd'
 *   SEED_TEST_OWNER_EMAIL (optional)            — to link reminders/drafts
 *   SEED_TEST_BORJIE_ADMIN_EMAIL (optional)
 *
 * The seed reads existing user IDs from public.users by email; it does
 * NOT depend on Supabase Auth being live. If the user rows aren't found
 * (e.g. test-users seed hasn't run yet), the seed prints a warn line and
 * skips the user-bound rows but still seeds the org-level entities.
 */

import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Static fixture data — keyed by stable natural-key IDs for idempotence.
// ---------------------------------------------------------------------------

interface SiteSpec {
  readonly id: string;
  readonly name: string;
  readonly mineral: string;
  readonly phase: string;
  readonly licenceKind: 'SML' | 'PML' | 'PL';
  readonly licenceNumber: string;
}

const DEMO_SITES: readonly SiteSpec[] = [
  {
    id: 'demo-site-mwadui',
    name: 'Mwadui Kimberley Field',
    mineral: 'diamond',
    phase: 'extraction',
    licenceKind: 'SML',
    licenceNumber: 'SML-001-MWADUI',
  },
  {
    id: 'demo-site-mererani',
    name: 'Mererani Block C Tanzanite',
    mineral: 'tanzanite',
    phase: 'extraction',
    licenceKind: 'PML',
    licenceNumber: 'PML-002-MERERANI',
  },
  {
    id: 'demo-site-kabanga',
    name: 'Kabanga Nickel Prospect',
    mineral: 'Ni',
    phase: 'exploration',
    licenceKind: 'PL',
    licenceNumber: 'PL-003-KABANGA',
  },
];

interface EmployeeSpec {
  readonly id: string;
  readonly siteId: string;
  readonly fullName: string;
  readonly role: string;
  readonly wageBasis: 'daily' | 'monthly' | 'production_share';
  readonly wageRateTzs: string;
  readonly employmentType: 'PML_employee' | 'contractor' | 'pit_holder_worker' | 'casual';
}

const DEMO_EMPLOYEES: readonly EmployeeSpec[] = [
  // Mwadui — 5 workers
  { id: 'demo-emp-001', siteId: 'demo-site-mwadui', fullName: 'Mzee Issa Mwemezi', role: 'foreman', wageBasis: 'monthly', wageRateTzs: '850000', employmentType: 'PML_employee' },
  { id: 'demo-emp-002', siteId: 'demo-site-mwadui', fullName: 'Hamisi Selemani', role: 'driller', wageBasis: 'daily', wageRateTzs: '35000', employmentType: 'PML_employee' },
  { id: 'demo-emp-003', siteId: 'demo-site-mwadui', fullName: 'Salum Mkenda', role: 'driller', wageBasis: 'daily', wageRateTzs: '35000', employmentType: 'casual' },
  { id: 'demo-emp-004', siteId: 'demo-site-mwadui', fullName: 'Zainabu Kihwele', role: 'sorter', wageBasis: 'daily', wageRateTzs: '20000', employmentType: 'casual' },
  { id: 'demo-emp-005', siteId: 'demo-site-mwadui', fullName: 'John Mhongo', role: 'security_guard', wageBasis: 'monthly', wageRateTzs: '450000', employmentType: 'contractor' },
  // Mererani — 4 workers
  { id: 'demo-emp-006', siteId: 'demo-site-mererani', fullName: 'Baraka Kessy', role: 'foreman', wageBasis: 'monthly', wageRateTzs: '780000', employmentType: 'PML_employee' },
  { id: 'demo-emp-007', siteId: 'demo-site-mererani', fullName: 'Frank Mwasebia', role: 'driller', wageBasis: 'daily', wageRateTzs: '32000', employmentType: 'PML_employee' },
  { id: 'demo-emp-008', siteId: 'demo-site-mererani', fullName: 'Aisha Komba', role: 'sorter', wageBasis: 'production_share', wageRateTzs: '18000', employmentType: 'pit_holder_worker' },
  { id: 'demo-emp-009', siteId: 'demo-site-mererani', fullName: 'Edward Lyimo', role: 'security_guard', wageBasis: 'monthly', wageRateTzs: '420000', employmentType: 'contractor' },
  // Kabanga — 3 workers (exploration phase, smaller crew)
  { id: 'demo-emp-010', siteId: 'demo-site-kabanga', fullName: 'Peter Mwakalinga', role: 'geologist', wageBasis: 'monthly', wageRateTzs: '1200000', employmentType: 'contractor' },
  { id: 'demo-emp-011', siteId: 'demo-site-kabanga', fullName: 'Jonas Kweyu', role: 'driver', wageBasis: 'monthly', wageRateTzs: '380000', employmentType: 'casual' },
  { id: 'demo-emp-012', siteId: 'demo-site-kabanga', fullName: 'Halima Mwenda', role: 'camp_cook', wageBasis: 'monthly', wageRateTzs: '280000', employmentType: 'casual' },
];

const DEMO_COMPANY_ID = 'demo-company-mming';
const DEMO_BUYER_ID = 'demo-buyer-tanzanite-house';
const DEMO_PARCEL_ID = 'demo-parcel-mererani-001';
const DEMO_SALE_ID = 'demo-sale-mererani-001';
const DEMO_COOP_PERIOD_ID = '00000000-0000-0000-0000-000000000901';
const DEMO_COOPERATIVE_PARTY_ID = '00000000-0000-0000-0000-000000000902';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function hashHex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Canonical provenance payload for seed-inserted rows. Matches the
 * `ProvenanceJson` shape in packages/database/src/helpers/provenance-column.ts.
 */
const SEED_PROVENANCE = {
  via: 'unknown' as const,
  actorId: null,
  sessionId: null,
  turnId: null,
  requestedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'borjie-mining-demo.seed.ts refuses to run with NODE_ENV=production',
    );
  }

  const databaseUrl = requireEnv('DATABASE_URL');
  const tenantId = optionalEnv(
    'SEED_TEST_TENANT_ID',
    '00000000-0000-0000-0000-000000000001',
  );
  const tenantName = optionalEnv('SEED_TEST_TENANT_NAME', 'Demo Mining Estate Ltd');
  const ownerEmail = optionalEnv('SEED_TEST_OWNER_EMAIL', 'owner@borjie.test');
  const adminEmail = optionalEnv(
    'SEED_TEST_BORJIE_ADMIN_EMAIL',
    'admin@borjie.test',
  );
  const managerEmail = optionalEnv('SEED_TEST_MANAGER_EMAIL', 'manager@borjie.test');

  const tenantIsUuid = isUuidLike(tenantId);

  logger.info('seed: mining-demo starting', { tenantId, tenantName });
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    // 1. Ensure tenant exists (borjie-test-users.seed.ts also upserts this,
    // but we don't want to depend on the run order).
    await sql`
      INSERT INTO tenants (
        id, name, slug, status, subscription_tier, plan,
        primary_email, country, region
      ) VALUES (
        ${tenantId},
        ${tenantName},
        ${tenantId},
        'active',
        'enterprise',
        'kampuni',
        ${'admin@' + tenantId + '.borjie.test'},
        'TZ',
        'af-south-1'
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        country = EXCLUDED.country,
        updated_at = now()
    `;
    logger.info('seed: tenant upserted');

    // 2. Resolve linked user ids by email (set NULL if missing).
    const ownerRow = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${ownerEmail} AND tenant_id = ${tenantId}
      LIMIT 1
    `;
    const adminRow = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${adminEmail} AND tenant_id = ${tenantId}
      LIMIT 1
    `;
    const managerRow = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${managerEmail} AND tenant_id = ${tenantId}
      LIMIT 1
    `;
    const ownerUserId = ownerRow[0]?.id ?? null;
    const adminUserId = adminRow[0]?.id ?? null;
    const managerUserId = managerRow[0]?.id ?? null;
    if (!ownerUserId) {
      logger.warn(
        'seed: owner user not found — run borjie-test-users.seed.ts first to link reminders/drafts',
        { ownerEmail, tenantId },
      );
    }

    // 3. Holding company.
    await sql`
      INSERT INTO companies (
        id, tenant_id, name, registration_no, tin, country,
        registered_address, attributes
      ) VALUES (
        ${DEMO_COMPANY_ID},
        ${tenantId},
        ${'Demo Mining Holdings Ltd'},
        ${'BRELA-92837465'},
        ${'105-829-374'},
        'TZ',
        ${'PO Box 12345, Plot 78 Sokoine Drive, Dar es Salaam'},
        ${JSON.stringify({ sector: 'precious_metals_gems', isDemo: true })}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
    `;
    logger.info('seed: holding company upserted');

    // 4. Sites + 5. Licences (one per site).
    for (const site of DEMO_SITES) {
      const licenceId = `demo-lic-${site.id.replace('demo-site-', '')}`;
      const expiry = new Date();
      // Mwadui licence near expiry to drive reminder relevance.
      expiry.setDate(expiry.getDate() + (site.id === 'demo-site-mwadui' ? 35 : 365));
      const grantDate = new Date();
      grantDate.setFullYear(grantDate.getFullYear() - 5);
      await sql`
        INSERT INTO licences (
          id, tenant_id, company_id, kind, number, mineral,
          holder_user_id, grant_date, expiry_date, area_ha, status, fees, obligations, dormancy_score
        ) VALUES (
          ${licenceId},
          ${tenantId},
          ${DEMO_COMPANY_ID},
          ${site.licenceKind},
          ${site.licenceNumber},
          ${site.mineral},
          ${ownerUserId},
          ${grantDate.toISOString().slice(0, 10)},
          ${expiry.toISOString().slice(0, 10)},
          ${site.licenceKind === 'SML' ? '500.0000' : site.licenceKind === 'PML' ? '10.0000' : '2000.0000'},
          'active',
          ${JSON.stringify({ annual_fee_tzs: 5_000_000, royalty_rate_pct: 6, inspection_pct: 0.3 })}::jsonb,
          ${JSON.stringify({ epp: true, eia: site.licenceKind === 'SML', community_benefit_pct: 1 })}::jsonb,
          ${site.id === 'demo-site-kabanga' ? 45 : 5}
        )
        ON CONFLICT (id) DO UPDATE SET
          expiry_date = EXCLUDED.expiry_date,
          dormancy_score = EXCLUDED.dormancy_score,
          updated_at = now()
      `;

      await sql`
        INSERT INTO sites (
          id, tenant_id, licence_id, name, mineral, phase, manager_user_id,
          geology_confidence, status, attributes
        ) VALUES (
          ${site.id},
          ${tenantId},
          ${licenceId},
          ${site.name},
          ${site.mineral},
          ${site.phase},
          ${managerUserId},
          ${site.phase === 'exploration' ? '0.35' : '0.78'},
          'active',
          ${JSON.stringify({ region: site.id.includes('mwadui') ? 'Shinyanga' : site.id.includes('mererani') ? 'Manyara' : 'Kagera', isDemo: true })}::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          phase = EXCLUDED.phase,
          updated_at = now()
      `;
    }
    logger.info('seed: 3 sites + 3 licences upserted');

    // 6. Employees.
    for (const emp of DEMO_EMPLOYEES) {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 12);
      await sql`
        INSERT INTO employees (
          id, tenant_id, company_id, site_id, full_name, role,
          wage_basis, wage_rate_tzs, employment_type, nationality,
          status, start_date
        ) VALUES (
          ${emp.id},
          ${tenantId},
          ${DEMO_COMPANY_ID},
          ${emp.siteId},
          ${emp.fullName},
          ${emp.role},
          ${emp.wageBasis},
          ${emp.wageRateTzs},
          ${emp.employmentType},
          'TZ',
          'active',
          ${startDate.toISOString().slice(0, 10)}
        )
        ON CONFLICT (id) DO UPDATE SET
          role = EXCLUDED.role,
          wage_rate_tzs = EXCLUDED.wage_rate_tzs
      `;
    }
    logger.info('seed: 12 employees upserted');

    // 7. Mining tasks — requires uuid tenant_id; only seed if our tenantId
    // is uuid-shaped (the canonical 00000000-...001 default is).
    if (tenantIsUuid) {
      const tasks = [
        {
          id: '00000000-0000-0000-0000-000000000401',
          titleSw: 'Endeleza uchimbaji wa shimo namba 3',
          titleEn: 'Continue drilling on pit 3',
          priority: 'high',
        },
        {
          id: '00000000-0000-0000-0000-000000000402',
          titleSw: 'Panga madini yaliyochimbwa leo',
          titleEn: 'Sort today\'s extracted ore',
          priority: 'normal',
        },
        {
          id: '00000000-0000-0000-0000-000000000403',
          titleSw: 'Sukuma malori mawili ya makaa Dar es Salaam',
          titleEn: 'Transport 2 truck-loads of ore to Dar es Salaam',
          priority: 'urgent',
        },
        {
          id: '00000000-0000-0000-0000-000000000404',
          titleSw: 'Lipa mishahara ya wafanyakazi wa wiki hii',
          titleEn: 'Pay this week\'s payroll',
          priority: 'high',
        },
      ];
      const tenantUuid = tenantId;
      const siteUuidMap = {
        'demo-site-mwadui': '00000000-0000-0000-0000-000000000501',
        'demo-site-mererani': '00000000-0000-0000-0000-000000000502',
        'demo-site-kabanga': '00000000-0000-0000-0000-000000000503',
      } as const;
      const defaultSiteUuid: string = siteUuidMap['demo-site-mwadui'];
      for (const task of tasks) {
        await sql`
          INSERT INTO mining_tasks (
            id, tenant_id, site_id, assigned_to_user_id, assigned_by_user_id,
            title_sw, title_en, priority, status, due_at
          ) VALUES (
            ${task.id}::uuid,
            ${tenantUuid}::uuid,
            ${defaultSiteUuid}::uuid,
            NULL,
            ${managerUserId && isUuidLike(managerUserId) ? managerUserId : null},
            ${task.titleSw},
            ${task.titleEn},
            ${task.priority},
            'pending',
            ${new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()}
          )
          ON CONFLICT (id) DO NOTHING
        `;
      }
      logger.info('seed: 4 mining tasks upserted');
    } else {
      logger.warn('seed: tenant_id is not uuid-shaped — skipping mining_tasks rows', {
        tenantId,
      });
    }

    // 8. Owner reminders — requires ownerUserId.
    if (ownerUserId) {
      const reminders = [
        {
          title: 'Renew Mwadui SML licence',
          body: 'Mwadui licence SML-001-MWADUI expires in 35 days. File renewal with TMAA + remit annual fees before expiry.',
          triggerIn: 5 * 24 * 60 * 60 * 1000,
          idempotencyKey: 'demo-reminder-mwadui-renewal',
          payload: { documentLink: '/dashboard/licences/demo-lic-mwadui' },
        },
        {
          title: 'TMAA royalty payment due',
          body: 'Q1 royalty remittance (6% of sale net) is due to TMAA in 14 days. Prepare statement + bank transfer.',
          triggerIn: 14 * 24 * 60 * 60 * 1000,
          idempotencyKey: 'demo-reminder-royalty-q1',
          payload: { royaltyPeriod: '2026-Q1' },
        },
      ];
      for (const r of reminders) {
        await sql`
          INSERT INTO reminders (
            tenant_id, owner_id, title, body, trigger_at, channel,
            status, payload, idempotency_key, provenance
          ) VALUES (
            ${tenantId},
            ${ownerUserId},
            ${r.title},
            ${r.body},
            ${new Date(Date.now() + r.triggerIn).toISOString()},
            'email',
            'scheduled',
            ${JSON.stringify(r.payload)}::jsonb,
            ${r.idempotencyKey},
            ${JSON.stringify(SEED_PROVENANCE)}::jsonb
          )
          ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        `;
      }
      logger.info('seed: 2 owner reminders upserted');
    } else {
      logger.warn('seed: skipping reminders — owner user not seeded yet');
    }

    // 9. Buyer + ore parcel + sale + chain-of-custody.
    await sql`
      INSERT INTO buyers (
        id, tenant_id, name, company_id, kind, country, licence_number,
        contact_name, contact_email, contact_phone, kyc_status,
        credit_limit_tzs, aml_status
      ) VALUES (
        ${DEMO_BUYER_ID},
        ${tenantId},
        ${'Tanzanite House International'},
        NULL,
        'export_buyer',
        'TZ',
        'DEALER-AR-2026-118',
        'Joseph Mhagama',
        'joseph@tanzanitehouse.example',
        '+255713445566',
        'verified',
        '350000000',
        'clear'
      )
      ON CONFLICT (id) DO UPDATE SET
        kyc_status = EXCLUDED.kyc_status
    `;

    await sql`
      INSERT INTO ore_parcels (
        id, tenant_id, site_id, mass_kg, grade, storage_location,
        status, attributes
      ) VALUES (
        ${DEMO_PARCEL_ID},
        ${tenantId},
        ${'demo-site-mererani'},
        '180.500',
        ${JSON.stringify({ Ct_g_t: 14.8, recovery_pct: 62 })}::jsonb,
        'Mererani Block C wash-bay store',
        'sold',
        ${JSON.stringify({ category: 'tanzanite-rough-grade-A', isDemo: true })}::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO sales (
        id, tenant_id, parcel_id, buyer_id, route, weighbridge_doc_id,
        gross_price_usd, gross_price_tzs, fx_at_sale_tzs_per_usd,
        royalty_pct, inspection_pct, vat_pct, net_tzs,
        payment_status, payment_received_at, provenance
      ) VALUES (
        ${DEMO_SALE_ID},
        ${tenantId},
        ${DEMO_PARCEL_ID},
        ${DEMO_BUYER_ID},
        'export_direct',
        'WB-DEMO-001',
        '125000.00',
        '320000000.00',
        '2560.0000',
        '6.00',
        '0.30',
        '18.00',
        '240640000.00',
        'received',
        ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()},
        ${JSON.stringify(SEED_PROVENANCE)}::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `;

    // Chain-of-custody step — needs ai_audit_chain prevhash anchor; we
    // synthesize a deterministic dev-only hash. Requires an
    // external_parties row to satisfy the to_party_id FK.
    if (tenantIsUuid) {
      const stockpilePartyId = '00000000-0000-0000-0000-000000000801';
      await sql`
        INSERT INTO external_parties (
          id, tenant_id, party_type, name, country, status, provenance
        ) VALUES (
          ${stockpilePartyId}::uuid,
          ${tenantId},
          'logistics_co',
          ${'Demo Mererani Wash-bay Store'},
          'TZ',
          'active',
          ${JSON.stringify(SEED_PROVENANCE)}::jsonb
        )
        ON CONFLICT (id) DO NOTHING
      `;

      const auditHashId = randomUUID();
      const stepHash = hashHex(`${DEMO_PARCEL_ID}|step-0|seeded`);
      await sql`
        INSERT INTO mineral_chain_of_custody (
          tenant_id, parcel_id, step_index, from_party_id, to_party_id,
          action, weight_grams, grade_pct, location, audit_hash_id, prev_audit_hash,
          provenance
        ) VALUES (
          ${tenantId},
          ${DEMO_PARCEL_ID},
          0,
          NULL,
          ${stockpilePartyId}::uuid,
          'extract',
          '180500.000',
          '14.8000',
          'Mererani Block C pit-mouth',
          ${auditHashId}::uuid,
          ${stepHash},
          ${JSON.stringify(SEED_PROVENANCE)}::jsonb
        )
        ON CONFLICT (tenant_id, parcel_id, step_index) DO NOTHING
      `;
      logger.info('seed: 1 chain-of-custody step upserted');
    } else {
      logger.warn('seed: tenant_id not uuid — skipping chain-of-custody');
    }

    // 10. Cooperative settlement period (draft).
    if (tenantIsUuid) {
      const periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - 30);
      const periodEnd = new Date();
      await sql`
        INSERT INTO cooperative_settlement_periods (
          id, tenant_id, cooperative_party_id, period_start, period_end,
          total_volume_kg, total_revenue_tzs, levies_tzs, net_distributable_tzs,
          status, provenance
        ) VALUES (
          ${DEMO_COOP_PERIOD_ID}::uuid,
          ${tenantId}::uuid,
          ${DEMO_COOPERATIVE_PARTY_ID}::uuid,
          ${periodStart.toISOString().slice(0, 10)},
          ${periodEnd.toISOString().slice(0, 10)},
          '180.500',
          '320000000.00',
          '23360000.00',
          '296640000.00',
          'calculated',
          ${JSON.stringify(SEED_PROVENANCE)}::jsonb
        )
        ON CONFLICT (id) DO NOTHING
      `;
      logger.info('seed: 1 cooperative settlement period upserted');
    }

    // 11. In-progress document draft (LOI to ABC Off-takers).
    // Idempotency: use a deterministic UUID derived from tenantId + slug.
    // The draft has status 'drafting' so the happy-path flow can pick it up
    // OR create a fresh one (test covers both cases).
    if (ownerUserId) {
      const draftSeed = `${tenantId}|demo-loi-abc-offtakers|v1`;
      const draftId = (() => {
        // RFC 4122-ish v5 namespace: use sha256-derived bytes formatted as uuid.
        const h = hashHex(draftSeed).slice(0, 32);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
      })();
      await sql`
        INSERT INTO document_drafts (
          id, tenant_id, created_by_user_id, kind, status,
          title_sw, title_en, jurisdiction, language, content_md,
          intent, classification, provenance
        ) VALUES (
          ${draftId}::uuid,
          ${tenantId},
          ${ownerUserId},
          'letter',
          'drafting',
          ${'Barua ya Nia: ABC Off-takers — Sanduku la dhahabu'},
          'Letter of Intent: ABC Off-takers — Gold concentrate',
          'TZ',
          'bilingual',
          ${[
            '# Letter of Intent',
            '',
            'TO: ABC Off-takers Ltd',
            'FROM: Demo Mining Estate Ltd',
            'RE: 2 tonnes of gold concentrate (DRAFT — pending owner review)',
            '',
            'This Letter of Intent ("LOI") outlines the proposed terms under which',
            'Demo Mining Estate Ltd ("Seller") will deliver 2 tonnes of gold',
            'concentrate from the Mwadui Kimberley Field to ABC Off-takers Ltd',
            '("Buyer").',
            '',
            '## Price',
            '- USD __TBD__ per gram, gross',
            '',
            '## Delivery',
            '- FOB Dar es Salaam, on or before [date]',
            '',
            '## Payment terms',
            '- 30% deposit on signing; 70% on bill of lading.',
          ].join('\n')},
          ${'Draft LOI to ABC Off-takers for 2 tonnes of gold concentrate'},
          'confidential',
          ${JSON.stringify(SEED_PROVENANCE)}::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = now()
      `;
      logger.info('seed: in-progress LOI draft upserted', { draftId });
    } else {
      logger.warn('seed: skipping LOI draft — owner user not seeded');
    }

    // 12. Open risk + open follow-up task.
    await sql`
      INSERT INTO risks (
        id, tenant_id, site_id, licence_id, kind, severity,
        description, mitigations, status, likelihood, attributes
      ) VALUES (
        'demo-risk-001',
        ${tenantId},
        ${'demo-site-kabanga'},
        ${'demo-lic-kabanga'},
        'licence',
        'high',
        ${'Kabanga PL dormancy score climbing — 45/100 after 24 months of low activity. TMAA may flag for cancellation.'},
        ${[
          'Schedule fresh sampling within 30 days',
          'File interim work programme with TMAA',
          'Pay Q2 inspection fees on time',
        ]},
        'open',
        '0.55',
        ${JSON.stringify({ source: 'demo-seed' })}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        description = EXCLUDED.description,
        severity = EXCLUDED.severity
    `;

    await sql`
      INSERT INTO tasks (
        id, tenant_id, owner_user_id, title, kind, priority,
        site_id, licence_id, due_date, required_evidence,
        cost_implication_tzs, risk_if_delayed, status, ai_followup_cadence
      ) VALUES (
        'demo-task-001',
        ${tenantId},
        ${ownerUserId},
        ${'Schedule confirmation sampling at Kabanga PL'},
        'sample_assay',
        4,
        ${'demo-site-kabanga'},
        ${'demo-lic-kabanga'},
        ${new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)},
        ${['drill_logs.pdf', 'tmaa_interim_report.pdf']},
        '14000000.00',
        ${'TMAA may issue notice of breach if dormancy threshold exceeds 60.'},
        'open',
        'weekly'
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        due_date = EXCLUDED.due_date
    `;
    logger.info('seed: 1 risk + 1 follow-up task upserted');

    logger.info('seed: mining-demo complete', {
      tenantId,
      sites: DEMO_SITES.length,
      employees: DEMO_EMPLOYEES.length,
    });
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  logger.error('seed: mining-demo FAILED', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
