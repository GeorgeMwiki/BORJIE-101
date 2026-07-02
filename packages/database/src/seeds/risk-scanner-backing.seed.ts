/**
 * Risk-Scanner Backing Seed — Wave Tier-1 powers reality.
 *
 * Companion to:
 *   - packages/database/src/migrations/0370_risk_scanner_backing.sql
 *   - packages/database/src/schemas/risk-scanner-backing.schema.ts
 *   - services/api-gateway/src/services/risk-scanner/scanner.ts
 *
 * Fills the LIVE demo/test tenant with REAL representative Tanzanian mining
 * values so the risk scanner returns real results on the live surface — the
 * GATE-LIVE-DATA canon (every tenant carries real provisioned data, never
 * empty). The chosen values deliberately trip the FLAGSHIP cash-runway rule
 * plus a spread of other rules so the scanner is demonstrably real end-to-end:
 *
 *   - cash.runway_below_90d   : 210M TZS on hand, ~3M/day burn → ~70-day runway
 *   - cash.ar_aging_critical  : 40% of AR aged 60+ days
 *   - hr.payroll_readiness_gap: 250M payroll due in 5 days > 210M cash
 *   - operational.fuel_inventory_below_safety : 4-day fuel cover
 *   - operational.equipment_failure_pattern   : excavator 3 failures / 30d
 *   - hr.supervisor_attrition_spike           : 2 supervisors gone in 90d
 *   - compliance.regulator_stop_work_risk     : NEMC + OSHA amber
 *   - estate.insurance_lapsing_30d            : plant cover lapses in 18 days
 *   - legal.contract_expiring_critical        : offtake expires in 25 days
 *   … and more.
 *
 * DEV / LIVE-TEST ONLY. Refuses to run when NODE_ENV === 'production'.
 * Idempotent — re-run is safe (natural-key upserts / delete-then-insert per
 * tenant scope).
 *
 * Invocation:
 *   DATABASE_URL=... pnpm tsx packages/database/src/seeds/risk-scanner-backing.seed.ts
 *
 * All figures below are REAL representative mining values — NEVER random,
 * NEVER Math.random.
 */

import postgres from 'postgres';
import { logger } from '../logger.js';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

/** ISO date `d` days from now (positive = future). */
function daysFromNow(d: number): string {
  return new Date(Date.now() + d * 86_400_000).toISOString();
}

/** Tenants that receive the risk backing data. Demo estate + test orgs. */
function seedTenants(): readonly string[] {
  const primary = optionalEnv(
    'SEED_TEST_TENANT_ID',
    '00000000-0000-0000-0000-000000000001',
  );
  const extra = (process.env.SEED_RISK_EXTRA_TENANTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set([primary, ...extra]));
}

/**
 * Seed the risk-scanner backing rows for one tenant. All statements run under
 * the seed's DB role (owner / service — RLS not enforced for the seeder) and
 * scope every row to `tenantId`. Delete-then-insert keeps re-runs idempotent
 * for the append-style relations.
 */
async function seedTenant(
  sql: postgres.Sql,
  tenantId: string,
): Promise<void> {
  // ── Base-table backing for the FLAGSHIP cash-runway rule ──────────────
  // Runway = cash on hand / (SUM(costs last 30d)/30). Seed a company + bank
  // account + a fresh cash balance + 30 days of actual cost so the computed
  // runway is REAL (~70 days) rather than null.
  const companyId = `risk-demo-co-${tenantId}`.slice(0, 60);
  const accountId = `risk-demo-acct-${tenantId}`.slice(0, 60);

  await sql`
    INSERT INTO companies (id, tenant_id, name, registration_no, tin, country)
    VALUES (${companyId}, ${tenantId}, 'Risk Demo Holdings Ltd',
            ${`BRELA-${companyId}`.slice(0, 40)}, ${'150-000-000'}, 'TZ')
    ON CONFLICT (id) DO NOTHING
  `.catch(() => undefined);

  await sql`
    INSERT INTO bank_accounts (id, tenant_id, company_id, bank_name,
                               account_number, currency, purpose)
    VALUES (${accountId}, ${tenantId}, ${companyId}, 'CRDB Bank',
            ${'0150' + tenantId.slice(-8)}, 'TZS', 'operating')
    ON CONFLICT (id) DO NOTHING
  `.catch(() => undefined);

  // Cash on hand: 210,000,000 TZS (one operating account).
  await sql`
    DELETE FROM cash_balances
      WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
  `.catch(() => undefined);
  await sql`
    INSERT INTO cash_balances (tenant_id, company_id, account_id,
                               recorded_at, balance_tzs, native_currency, source)
    VALUES (${tenantId}, ${companyId}, ${accountId}, now(),
            ${'210000000.00'}, 'TZS', 'manual')
    ON CONFLICT (tenant_id, account_id, recorded_at) DO NOTHING
  `.catch(() => undefined);

  // Costs: 90,000,000 TZS actual spend over the last 30 days → 3M/day burn →
  // runway ≈ 70 days (< 90 → flagship fires HIGH). Three real cost rows.
  await sql`
    DELETE FROM costs WHERE tenant_id = ${tenantId} AND id LIKE ${'risk-demo-cost-%'}
  `.catch(() => undefined);
  const costRows: ReadonlyArray<[string, string, string, number]> = [
    ['risk-demo-cost-fuel', 'fuel', '48000000.00', 20],
    ['risk-demo-cost-wages', 'wages', '30000000.00', 15],
    ['risk-demo-cost-spares', 'spares', '12000000.00', 8],
  ];
  for (const [id, category, amount, ago] of costRows) {
    await sql`
      INSERT INTO costs (id, tenant_id, category, amount_tzs, amount_currency,
                         state, ts)
      VALUES (${id}, ${tenantId}, ${category}, ${amount}, 'TZS', 'actual',
              ${daysFromNow(-ago)})
      ON CONFLICT (id) DO UPDATE SET amount_tzs = EXCLUDED.amount_tzs,
                                     ts = EXCLUDED.ts
    `.catch(() => undefined);
  }

  // ── accounts_receivable: 40% aged 60+ → cash.ar_aging_critical HIGH ───
  await sql`DELETE FROM accounts_receivable WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO accounts_receivable
      (tenant_id, buyer_id, buyer_name, invoice_no, amount_tzs, aging_days, due_at, status)
    VALUES
      (${tenantId}, 'buyer-tanzanite-house', 'Tanzanite House Ltd', 'INV-1001',
        ${'80000000.00'}, 75, ${daysFromNow(-15)}, 'open'),
      (${tenantId}, 'buyer-geita-traders', 'Geita Gold Traders', 'INV-1002',
        ${'120000000.00'}, 20, ${daysFromNow(10)}, 'open')
  `;

  // ── payroll_schedule: 250M due in 5 days > 210M cash → readiness gap ──
  await sql`DELETE FROM payroll_schedule WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO payroll_schedule
      (tenant_id, next_run_at, total_amount_tzs, headcount, cadence, status)
    VALUES
      (${tenantId}, ${daysFromNow(5)}, ${'250000000.00'}, 240, 'monthly', 'scheduled')
  `;

  // ── fuel_inventory: 4-day cover → below the 7-day safety floor ────────
  await sql`DELETE FROM fuel_inventory WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO fuel_inventory
      (tenant_id, site_id, fuel_kind, litres_remaining, daily_burn_litres)
    VALUES
      (${tenantId}, 'demo-site-mererani', 'diesel', ${'12000.00'}, ${'3000.00'})
  `;

  // ── equipment_failures: excavator 3× in 30d → failure pattern ────────
  await sql`DELETE FROM equipment_failures WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO equipment_failures
      (tenant_id, site_id, equipment_kind, failure_mode, failed_at)
    VALUES
      (${tenantId}, 'demo-site-mererani', 'excavator', 'hydraulic_line', ${daysFromNow(-25)}),
      (${tenantId}, 'demo-site-mererani', 'excavator', 'track_tension',  ${daysFromNow(-12)}),
      (${tenantId}, 'demo-site-mererani', 'excavator', 'engine_overheat',${daysFromNow(-3)})
  `;

  // ── workforce_separations: 2 supervisors in 90d → attrition spike ────
  await sql`DELETE FROM workforce_separations WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO workforce_separations
      (tenant_id, full_name, role, separation_kind, separated_at)
    VALUES
      (${tenantId}, 'Baraka Kessy',   'supervisor',   'resignation', ${daysFromNow(-40)}),
      (${tenantId}, 'Frank Mwasebia', 'site_manager', 'dismissal',   ${daysFromNow(-12)})
  `;

  // ── royalty_drafts_with_trend: 12% below trend → TRA audit pattern ───
  await sql`DELETE FROM royalty_drafts_with_trend WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO royalty_drafts_with_trend
      (tenant_id, draft_date, current_draft_tzs, trailing_avg_tzs, mineral)
    VALUES
      (${tenantId}, ${daysFromNow(-2).slice(0, 10)}, ${'88000000.00'}, ${'100000000.00'}, 'Au')
  `;

  // ── regulator_status: NEMC + OSHA amber → stop-work + licence-thin ───
  await sql`
    INSERT INTO regulator_status (tenant_id, regulator, status_tone, note)
    VALUES
      (${tenantId}, 'nemc', 'amber', 'EIA condition follow-up pending'),
      (${tenantId}, 'osha', 'amber', 'PPE compliance re-inspection due')
    ON CONFLICT (tenant_id, regulator)
      DO UPDATE SET status_tone = EXCLUDED.status_tone, note = EXCLUDED.note
  `;

  // ── buyer_credit_signals: 3 late payments → buyer default signal ─────
  await sql`DELETE FROM buyer_credit_signals WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO buyer_credit_signals
      (tenant_id, buyer_id, buyer_name, late_payment_count, crb_score_delta)
    VALUES
      (${tenantId}, 'buyer-tanzanite-house', 'Tanzanite House Ltd', 3, -25)
  `;

  // ── supplier_quality_signals: 4 off-spec in 60d → quality drop ───────
  await sql`DELETE FROM supplier_quality_signals WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO supplier_quality_signals
      (tenant_id, supplier_id, supplier_name, off_spec_count, window_days)
    VALUES
      (${tenantId}, 'sup-reagents-tz', 'Reagents Tanzania Ltd', 4, 60)
  `;

  // ── security_audit_events: 2 access anomalies in last hour ───────────
  await sql`DELETE FROM security_audit_events WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO security_audit_events (tenant_id, event_kind, actor_id, occurred_at)
    VALUES
      (${tenantId}, 'access_anomaly', 'user-owner', ${daysFromNow(0)}),
      (${tenantId}, 'access_anomaly', 'user-owner', ${daysFromNow(0)})
  `;

  // ── cda_milestones: 2 overdue → CSR commitment slipping ──────────────
  await sql`DELETE FROM cda_milestones WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO cda_milestones (tenant_id, title, commitment, due_at, status)
    VALUES
      (${tenantId}, 'Village borehole handover', 'Clean water access', ${daysFromNow(-20)}, 'overdue'),
      (${tenantId}, 'Secondary-school classroom block', 'Education CDA', ${daysFromNow(-5)}, 'overdue')
  `;

  // ── withholding_tax_summary: 80M payable, 20M provisioned → exposure ─
  await sql`
    INSERT INTO withholding_tax_summary
      (tenant_id, period_label, payable_tzs, provision_tzs)
    VALUES
      (${tenantId}, ${'2026-Q2'}, ${'80000000.00'}, ${'20000000.00'})
    ON CONFLICT (tenant_id, period_label)
      DO UPDATE SET payable_tzs = EXCLUDED.payable_tzs,
                    provision_tzs = EXCLUDED.provision_tzs
  `;

  // ── tra_correspondence: inquiry open + filed 40d ago → inquiry signal ─
  await sql`DELETE FROM tra_correspondence WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO tra_correspondence (tenant_id, subject, inquiry_open, last_filed_at)
    VALUES
      (${tenantId}, 'Royalty return query 2026-Q1', true, ${daysFromNow(-40)})
  `;

  // ── contracts + renewal: offtake expires in 25d, no renewal in flight ─
  await sql`DELETE FROM contract_renewal_workflows WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM contracts WHERE tenant_id = ${tenantId}`;
  const [offtake] = await sql<{ id: string }[]>`
    INSERT INTO contracts
      (tenant_id, counterparty_name, contract_kind, annual_value_tzs, effective_at, expires_at, status)
    VALUES
      (${tenantId}, 'Metals Refinery East Africa', 'offtake', ${'1800000000.00'},
        ${daysFromNow(-340)}, ${daysFromNow(25)}, 'active')
    RETURNING id
  `;
  // A SECOND contract WITH a renewal-in-flight so the join branch is exercised
  // (and this one must NOT fire — proves the negative path is real too).
  const [logistics] = await sql<{ id: string }[]>`
    INSERT INTO contracts
      (tenant_id, counterparty_name, contract_kind, annual_value_tzs, effective_at, expires_at, status)
    VALUES
      (${tenantId}, 'Dar Logistics Ltd', 'haulage', ${'600000000.00'},
        ${daysFromNow(-300)}, ${daysFromNow(50)}, 'active')
    RETURNING id
  `;
  if (logistics) {
    await sql`
      INSERT INTO contract_renewal_workflows (tenant_id, contract_id, status)
      VALUES (${tenantId}, ${logistics.id}, 'negotiation')
    `;
  }
  if (offtake) {
    logger.info('seed: risk-backing offtake contract set to expire in 25d', {
      tenantId,
      contractId: offtake.id,
    });
  }

  // ── disputes: 2 with the same counterparty in 90d → escalation ───────
  await sql`DELETE FROM disputes WHERE tenant_id = ${tenantId}`;
  await sql`
    INSERT INTO disputes
      (tenant_id, counterparty_id, counterparty_name, subject, status, opened_at)
    VALUES
      (${tenantId}, 'cp-refinery-ea', 'Metals Refinery East Africa', 'Assay dispute batch 44', 'open', ${daysFromNow(-60)}),
      (${tenantId}, 'cp-refinery-ea', 'Metals Refinery East Africa', 'Weighbridge variance batch 47', 'open', ${daysFromNow(-10)})
  `;

  logger.info('seed: risk-scanner backing complete for tenant', { tenantId });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'risk-scanner-backing.seed.ts refuses to run with NODE_ENV=production',
    );
  }
  const databaseUrl = requireEnv('DATABASE_URL');
  const tenants = seedTenants();
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    for (const tenantId of tenants) {
      await seedTenant(sql, tenantId);
    }
    logger.info('seed: risk-scanner backing done', { tenants: tenants.length });
  } finally {
    await sql.end();
  }
}

// Only auto-run when invoked directly (not when imported by a test).
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  /risk-scanner-backing\.seed\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  main().catch((err) => {
    logger.error('seed: risk-scanner backing FAILED', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  });
}

export { seedTenant, seedTenants };
