#!/usr/bin/env node
/**
 * seed-trc-tenant.mjs — provision the TRC (Tanzania Railways Corporation)
 * Estate Management Unit pilot tenant in BORJIE's live Supabase project.
 *
 * Wave-15 deliverable. Creates everything needed to demo TRC's EMU operating
 * on TODAY's code (no new architecture, no new migrations):
 *
 *   1. The TRC tenant row (id `tnt_trc_001`, slug `trc`, country TZ,
 *      timezone Africa/Dar_es_Salaam, currency TZS).
 *
 *   2. Four district `organizations` rows (Dar es Salaam, Dodoma, Tabora,
 *      Tanga) with materialized-path hierarchy under the tenant.
 *
 *   3. ~15 realistic properties (stations) distributed across the four
 *      districts — Dar Central, Tabora Junction, Tanga Port, Dodoma HQ,
 *      Dar Yard, Tabora Workshop, etc.
 *
 *   4. ~30 units (warehouses, godowns, plots, bays) inside those stations.
 *
 *   5. Eight Supabase auth users:
 *        - 2 EMU Officers (manager role + admin)
 *        - 1 Director General (owner role + admin)
 *        - 5 sample lessees (tenant role + employee)
 *      Each mirrored into the app-level `users` table so the gateway can
 *      resolve them after JWT verification.
 *
 *   6. Five `customers` rows linked to the lessee users, with five `leases`
 *      attached at varying rents (some <500,000 TZS some >=500,000 TZS) and
 *      a spread of expiry dates so the Wave-15 lease-expiry cron has live
 *      data to fire on (60/30/7/1 day windows).
 *
 *   7. Approval-policy seed rows in `approval_policies` for the TRC matrix:
 *        - lease_exception: <500k TZS → EMU Officer, ≥500k → DG
 *        - lease_exception with bareland_railway_reserve = required notify
 *          Directorate of Civil Engineering & Infrastructure BEFORE leasing
 *
 * All steps are idempotent — re-running converges (UPDATEs on existing rows
 * instead of duplicating) and exits 0 with `(exists)` annotations.
 *
 * Reads from `.env.local`:
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   DATABASE_URL
 *
 * Optional:
 *   BORJIE_BOOTSTRAP_PASSWORD (default: TrcPilot!Secure-2026)
 *   TRC_TENANT_ID                 (default: tnt_trc_001)
 *
 * Exit codes:
 *   0 — converged (seeded or already there)
 *   1 — fatal error (network / auth / SQL / programming bug)
 *   2 — missing required env var
 *
 * Safety: refuses to run when SUPABASE_URL pattern-matches production.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// 1. Env loading — same pattern as seed-live-test-users.mjs (no dotenv dep).
// ---------------------------------------------------------------------------

function loadDotEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const [, key, valRaw] = m;
    if (process.env[key]) continue;
    const val = valRaw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    process.env[key] = val;
  }
}
loadDotEnvLocal();

function required(name) {
  const v = process.env[name];
  if (!v || /^TODO_/.test(v)) {
    console.error(`[seed-trc-tenant] missing required env: ${name}`);
    process.exit(2);
  }
  return v;
}

function requiredOneOf(names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && !/^TODO_/.test(v)) return v;
  }
  console.error(`[seed-trc-tenant] missing required env (one of): ${names.join(', ')}`);
  process.exit(2);
}

const SUPABASE_URL = requiredOneOf(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']).replace(/\/+$/, '');
const SERVICE_ROLE = required('SUPABASE_SERVICE_ROLE_KEY');
const DATABASE_URL = required('DATABASE_URL');
const TENANT_ID = process.env.TRC_TENANT_ID ?? 'tnt_trc_001';
const TENANT_SLUG = 'trc';
const PASSWORD = process.env.BORJIE_BOOTSTRAP_PASSWORD ?? 'TrcPilot!Secure-2026';

function assertNotProduction() {
  if (/prod|production|live/i.test(SUPABASE_URL)) {
    console.error(
      `[seed-trc-tenant] REFUSING to run — SUPABASE_URL looks like production: ${SUPABASE_URL}`,
    );
    process.exit(1);
  }
}
assertNotProduction();

// ---------------------------------------------------------------------------
// 2. The seed data model. All ids are deterministic so re-runs converge.
// ---------------------------------------------------------------------------

const ORG_PREFIX = TENANT_ID; // organizations are scoped beneath the tenant id

const DISTRICTS = [
  {
    id: `${ORG_PREFIX}_dar`,
    code: 'DAR',
    name: 'Dar es Salaam District',
    description: 'Coastal Dar es Salaam railway estate operations',
  },
  {
    id: `${ORG_PREFIX}_dodoma`,
    code: 'DODOMA',
    name: 'Dodoma District',
    description: 'Capital district headquarters and central railway operations',
  },
  {
    id: `${ORG_PREFIX}_tabora`,
    code: 'TABORA',
    name: 'Tabora District',
    description: 'Western junction and workshop district',
  },
  {
    id: `${ORG_PREFIX}_tanga`,
    code: 'TANGA',
    name: 'Tanga District',
    description: 'Northern coast port and warehouse district',
  },
];

// Stations distributed across the four districts. Property type uses
// existing enum values: 'commercial', 'mixed_use', 'estate', 'other'.
const STATIONS = [
  // Dar es Salaam (5 stations)
  { id: `prop_trc_dar_central`, district: `${ORG_PREFIX}_dar`, code: 'DAR-CTR', name: 'Dar Central Station', type: 'commercial', city: 'Dar es Salaam', address: 'Sokoine Drive, Dar es Salaam Central' },
  { id: `prop_trc_dar_yard`, district: `${ORG_PREFIX}_dar`, code: 'DAR-YRD', name: 'Dar Marshalling Yard', type: 'estate', city: 'Dar es Salaam', address: 'Pugu Road, Ilala' },
  { id: `prop_trc_dar_kurasini`, district: `${ORG_PREFIX}_dar`, code: 'DAR-KUR', name: 'Kurasini Container Terminal', type: 'commercial', city: 'Dar es Salaam', address: 'Kurasini, Temeke' },
  { id: `prop_trc_dar_ilala_hotel`, district: `${ORG_PREFIX}_dar`, code: 'DAR-HTL', name: 'Ilala Railway Hotel', type: 'mixed_use', city: 'Dar es Salaam', address: 'Uhuru Street, Ilala' },
  { id: `prop_trc_dar_buguruni`, district: `${ORG_PREFIX}_dar`, code: 'DAR-BGR', name: 'Buguruni Railway Reserve', type: 'other', city: 'Dar es Salaam', address: 'Buguruni Mnyamani, Ilala' },

  // Dodoma (3 stations)
  { id: `prop_trc_dodoma_hq`, district: `${ORG_PREFIX}_dodoma`, code: 'DOD-HQ', name: 'Dodoma HQ Complex', type: 'mixed_use', city: 'Dodoma', address: 'Railway Drive, Dodoma' },
  { id: `prop_trc_dodoma_station`, district: `${ORG_PREFIX}_dodoma`, code: 'DOD-STN', name: 'Dodoma Central Station', type: 'commercial', city: 'Dodoma', address: 'Railway Square, Dodoma' },
  { id: `prop_trc_dodoma_warehouse`, district: `${ORG_PREFIX}_dodoma`, code: 'DOD-WHS', name: 'Dodoma Goods Warehouse', type: 'commercial', city: 'Dodoma', address: 'Kikuyu Avenue, Dodoma' },

  // Tabora (4 stations)
  { id: `prop_trc_tabora_junction`, district: `${ORG_PREFIX}_tabora`, code: 'TBR-JCT', name: 'Tabora Junction', type: 'commercial', city: 'Tabora', address: 'Junction Road, Tabora' },
  { id: `prop_trc_tabora_workshop`, district: `${ORG_PREFIX}_tabora`, code: 'TBR-WKS', name: 'Tabora Workshop', type: 'estate', city: 'Tabora', address: 'Industrial Area, Tabora' },
  { id: `prop_trc_tabora_godown`, district: `${ORG_PREFIX}_tabora`, code: 'TBR-GDN', name: 'Tabora Godown Complex', type: 'commercial', city: 'Tabora', address: 'Mwanza Road, Tabora' },
  { id: `prop_trc_tabora_bareland`, district: `${ORG_PREFIX}_tabora`, code: 'TBR-BLD', name: 'Tabora Bareland Reserve', type: 'other', city: 'Tabora', address: 'Railway Reserve Strip, Tabora' },

  // Tanga (3 stations)
  { id: `prop_trc_tanga_port`, district: `${ORG_PREFIX}_tanga`, code: 'TNG-PRT', name: 'Tanga Port Yard', type: 'commercial', city: 'Tanga', address: 'Port Road, Tanga' },
  { id: `prop_trc_tanga_station`, district: `${ORG_PREFIX}_tanga`, code: 'TNG-STN', name: 'Tanga Railway Station', type: 'commercial', city: 'Tanga', address: 'Independence Avenue, Tanga' },
  { id: `prop_trc_tanga_warehouse`, district: `${ORG_PREFIX}_tanga`, code: 'TNG-WHS', name: 'Tanga Coastal Warehouse', type: 'commercial', city: 'Tanga', address: 'Pongwe Industrial, Tanga' },
];

// Units inside stations. Existing enum: 'warehouse','commercial_retail',
// 'commercial_office','storage','parking','other'. Rent in TZS minor units
// (the storage layer treats rent_amount as minor; for TZS 1 TZS = 100 cents).
const UNITS = [
  // Dar Central — 3 bays + 1 office
  { id: 'unit_trc_dar_ctr_bay1', propertyId: 'prop_trc_dar_central', code: 'BAY1', name: 'Dar Central — Bay 1', type: 'warehouse', rent: 350_000_00 },
  { id: 'unit_trc_dar_ctr_bay2', propertyId: 'prop_trc_dar_central', code: 'BAY2', name: 'Dar Central — Bay 2', type: 'warehouse', rent: 420_000_00 },
  { id: 'unit_trc_dar_ctr_bay3', propertyId: 'prop_trc_dar_central', code: 'BAY3', name: 'Dar Central — Bay 3 (Loading)', type: 'warehouse', rent: 480_000_00 },
  { id: 'unit_trc_dar_ctr_off1', propertyId: 'prop_trc_dar_central', code: 'OFF1', name: 'Dar Central — Office Suite 1', type: 'commercial_office', rent: 250_000_00 },

  // Dar Yard — 2 godowns
  { id: 'unit_trc_dar_yrd_gd1', propertyId: 'prop_trc_dar_yard', code: 'GD1', name: 'Dar Yard — Godown A', type: 'warehouse', rent: 850_000_00 },
  { id: 'unit_trc_dar_yrd_gd2', propertyId: 'prop_trc_dar_yard', code: 'GD2', name: 'Dar Yard — Godown B', type: 'warehouse', rent: 920_000_00 },

  // Kurasini — 1 large warehouse (>500k)
  { id: 'unit_trc_dar_kur_whs1', propertyId: 'prop_trc_dar_kurasini', code: 'WHS1', name: 'Kurasini — Container Warehouse 1', type: 'warehouse', rent: 1_750_000_00 },
  { id: 'unit_trc_dar_kur_whs2', propertyId: 'prop_trc_dar_kurasini', code: 'WHS2', name: 'Kurasini — Container Warehouse 2', type: 'warehouse', rent: 1_900_000_00 },

  // Ilala Hotel — 2 retail units
  { id: 'unit_trc_dar_htl_r1', propertyId: 'prop_trc_dar_ilala_hotel', code: 'R1', name: 'Ilala Hotel — Retail Bay 1', type: 'commercial_retail', rent: 320_000_00 },
  { id: 'unit_trc_dar_htl_r2', propertyId: 'prop_trc_dar_ilala_hotel', code: 'R2', name: 'Ilala Hotel — Retail Bay 2', type: 'commercial_retail', rent: 360_000_00 },

  // Buguruni Railway Reserve — bareland plot (must notify Civil Eng)
  { id: 'unit_trc_dar_bgr_plot1', propertyId: 'prop_trc_dar_buguruni', code: 'PLT1', name: 'Buguruni Reserve — Plot A (bareland)', type: 'other', rent: 180_000_00 },

  // Dodoma HQ — 3 offices
  { id: 'unit_trc_dod_hq_off1', propertyId: 'prop_trc_dodoma_hq', code: 'OFF1', name: 'Dodoma HQ — Suite 101', type: 'commercial_office', rent: 280_000_00 },
  { id: 'unit_trc_dod_hq_off2', propertyId: 'prop_trc_dodoma_hq', code: 'OFF2', name: 'Dodoma HQ — Suite 102', type: 'commercial_office', rent: 280_000_00 },
  { id: 'unit_trc_dod_hq_off3', propertyId: 'prop_trc_dodoma_hq', code: 'OFF3', name: 'Dodoma HQ — Director Floor', type: 'commercial_office', rent: 650_000_00 },

  // Dodoma Station — 2 retail
  { id: 'unit_trc_dod_stn_r1', propertyId: 'prop_trc_dodoma_station', code: 'R1', name: 'Dodoma Station — Kiosk 1', type: 'commercial_retail', rent: 95_000_00 },
  { id: 'unit_trc_dod_stn_r2', propertyId: 'prop_trc_dodoma_station', code: 'R2', name: 'Dodoma Station — Kiosk 2', type: 'commercial_retail', rent: 105_000_00 },

  // Dodoma Warehouse
  { id: 'unit_trc_dod_whs_a', propertyId: 'prop_trc_dodoma_warehouse', code: 'WHS-A', name: 'Dodoma Warehouse — Block A', type: 'warehouse', rent: 540_000_00 },

  // Tabora Junction — 2 bays
  { id: 'unit_trc_tbr_jct_b1', propertyId: 'prop_trc_tabora_junction', code: 'B1', name: 'Tabora Junction — Bay 1', type: 'warehouse', rent: 310_000_00 },
  { id: 'unit_trc_tbr_jct_b2', propertyId: 'prop_trc_tabora_junction', code: 'B2', name: 'Tabora Junction — Bay 2', type: 'warehouse', rent: 340_000_00 },

  // Tabora Workshop — 3 godowns
  { id: 'unit_trc_tbr_wks_g1', propertyId: 'prop_trc_tabora_workshop', code: 'G1', name: 'Tabora Workshop — Godown 1', type: 'warehouse', rent: 410_000_00 },
  { id: 'unit_trc_tbr_wks_g2', propertyId: 'prop_trc_tabora_workshop', code: 'G2', name: 'Tabora Workshop — Godown 2', type: 'warehouse', rent: 440_000_00 },
  { id: 'unit_trc_tbr_wks_g3', propertyId: 'prop_trc_tabora_workshop', code: 'G3', name: 'Tabora Workshop — Godown 3 (heavy)', type: 'warehouse', rent: 580_000_00 },

  // Tabora Godown Complex
  { id: 'unit_trc_tbr_gdn_1', propertyId: 'prop_trc_tabora_godown', code: '1', name: 'Tabora Godown — Section 1', type: 'storage', rent: 220_000_00 },

  // Tabora Bareland (along Railway Reserve)
  { id: 'unit_trc_tbr_bld_plot1', propertyId: 'prop_trc_tabora_bareland', code: 'PLT1', name: 'Tabora Bareland — Plot A (railway reserve)', type: 'other', rent: 145_000_00 },

  // Tanga Port — 3 warehouses
  { id: 'unit_trc_tng_prt_whs_a', propertyId: 'prop_trc_tanga_port', code: 'WHS-A', name: 'Tanga Port — Warehouse A', type: 'warehouse', rent: 720_000_00 },
  { id: 'unit_trc_tng_prt_whs_b', propertyId: 'prop_trc_tanga_port', code: 'WHS-B', name: 'Tanga Port — Warehouse B', type: 'warehouse', rent: 760_000_00 },
  { id: 'unit_trc_tng_prt_whs_c', propertyId: 'prop_trc_tanga_port', code: 'WHS-C', name: 'Tanga Port — Warehouse C (refrigerated)', type: 'warehouse', rent: 1_150_000_00 },

  // Tanga Station — 2 kiosks
  { id: 'unit_trc_tng_stn_k1', propertyId: 'prop_trc_tanga_station', code: 'K1', name: 'Tanga Station — Kiosk 1', type: 'commercial_retail', rent: 85_000_00 },
  { id: 'unit_trc_tng_stn_k2', propertyId: 'prop_trc_tanga_station', code: 'K2', name: 'Tanga Station — Kiosk 2', type: 'commercial_retail', rent: 90_000_00 },

  // Tanga Warehouse
  { id: 'unit_trc_tng_whs_main', propertyId: 'prop_trc_tanga_warehouse', code: 'MAIN', name: 'Tanga Coastal Warehouse — Main Bay', type: 'warehouse', rent: 880_000_00 },
];

// Users seeded into auth.users + mirrored to app `users` table.
const USERS = [
  // EMU Officers (manager role, <500k TZS approver)
  { email: 'emu.officer1@trc.go.tz', firstName: 'Asha', lastName: 'Mwakasege', roles: ['MANAGER', 'admin'], isOwner: false, kind: 'officer' },
  { email: 'emu.officer2@trc.go.tz', firstName: 'Juma', lastName: 'Mhando',     roles: ['MANAGER', 'admin'], isOwner: false, kind: 'officer' },
  // Director General (owner role, ≥500k TZS approver)
  { email: 'dg@trc.go.tz',           firstName: 'Hamza', lastName: 'Songoro',   roles: ['OWNER',   'admin'], isOwner: true,  kind: 'dg' },
  // Lessees (tenant role)
  { email: 'lessee1@example.com',    firstName: 'Mwajuma', lastName: 'Salim',   roles: ['TENANT',  'employee'], isOwner: false, kind: 'lessee' },
  { email: 'lessee2@example.com',    firstName: 'Frank',   lastName: 'Mwakikuti', roles: ['TENANT', 'employee'], isOwner: false, kind: 'lessee' },
  { email: 'lessee3@example.com',    firstName: 'Neema',   lastName: 'Lyimo',   roles: ['TENANT',  'employee'], isOwner: false, kind: 'lessee' },
  { email: 'lessee4@example.com',    firstName: 'Tatu',    lastName: 'Massawe', roles: ['TENANT',  'employee'], isOwner: false, kind: 'lessee' },
  { email: 'lessee5@example.com',    firstName: 'Khalid',  lastName: 'Suleiman', roles: ['TENANT', 'employee'], isOwner: false, kind: 'lessee' },
];

// Sample leases. End-date offsets (in days from today) are chosen so the
// lease-expiry cron has hits at 60, 30, 7, 1 day and one far-future control.
const LEASES = [
  { id: 'lease_trc_001', leaseNumber: 'TRC-2026-001', unitId: 'unit_trc_dar_ctr_bay1',    customerEmail: 'lessee1@example.com', rent: 350_000_00, daysToExpiry:  60, primaryOccupant: { name: 'Mwajuma Salim', relationship: 'self', idNumber: 'TZ-1234567' } },
  { id: 'lease_trc_002', leaseNumber: 'TRC-2026-002', unitId: 'unit_trc_dar_kur_whs1',    customerEmail: 'lessee2@example.com', rent: 1_750_000_00, daysToExpiry: 30, primaryOccupant: { name: 'Frank Mwakikuti', relationship: 'company-rep', idNumber: 'TZ-2345678' } },
  { id: 'lease_trc_003', leaseNumber: 'TRC-2026-003', unitId: 'unit_trc_tbr_wks_g3',      customerEmail: 'lessee3@example.com', rent: 580_000_00, daysToExpiry:   7, primaryOccupant: { name: 'Neema Lyimo', relationship: 'self', idNumber: 'TZ-3456789' } },
  { id: 'lease_trc_004', leaseNumber: 'TRC-2026-004', unitId: 'unit_trc_tng_prt_whs_a',   customerEmail: 'lessee4@example.com', rent: 720_000_00, daysToExpiry:   1, primaryOccupant: { name: 'Tatu Massawe', relationship: 'company-rep', idNumber: 'TZ-4567890' } },
  { id: 'lease_trc_005', leaseNumber: 'TRC-2026-005', unitId: 'unit_trc_tbr_bld_plot1',   customerEmail: 'lessee5@example.com', rent: 145_000_00, daysToExpiry: 365, primaryOccupant: { name: 'Khalid Suleiman', relationship: 'self', idNumber: 'TZ-5678901' } },
];

// Approval policy seed rows.
// `lease_exception` carries the TRC approval matrix: <500k → EMU officer,
// ≥500k → DG. Bareland-railway-reserve is encoded as an explicit
// auto-approve guard (require_civil_eng_notification = true), surfaced in
// the policy JSON so the gateway/render can show the matrix correctly even
// while the deeper sovereign workflow ships later.
const APPROVAL_POLICY_THRESHOLD_TZS = 500_000_00; // 500,000 TZS in minor units
const APPROVAL_POLICY_TYPE = 'lease_exception';
const APPROVAL_POLICY_JSON = {
  tenantId: TENANT_ID,
  type: APPROVAL_POLICY_TYPE,
  thresholds: [
    {
      minAmount: 0,
      maxAmount: APPROVAL_POLICY_THRESHOLD_TZS,
      requiredRole: 'estate_manager', // EMU Officer
      approvalLevel: 1,
    },
    {
      minAmount: APPROVAL_POLICY_THRESHOLD_TZS,
      maxAmount: null,
      requiredRole: 'owner', // Director General
      approvalLevel: 2,
    },
  ],
  autoApproveRules: [],
  approvalChain: [
    { level: 1, requiredRole: 'estate_manager', timeoutHours: 48, escalateToRole: 'owner' },
    { level: 2, requiredRole: 'owner',          timeoutHours: 72, escalateToRole: null },
  ],
  defaultTimeoutHours: 72,
  autoEscalateToRole: 'owner',
  // TRC-specific guard rails — surfaced in the policy JSON so the UI / cron
  // can read them. Wave-15 stops here; deeper sovereign-workflow plumbing
  // ships in a later wave (see WAVE15_TRC_PILOT.md gaps section).
  trcGuards: {
    requireCivilEngNotificationForBarelandRailwayReserve: true,
    notifyDirectorate: 'civil_engineering_and_infrastructure',
  },
  currency: 'TZS',
};

// ---------------------------------------------------------------------------
// 3. Supabase Admin API helpers — exact pattern from seed-live-test-users.
// ---------------------------------------------------------------------------

async function adminApi(pathSuffix, init = {}) {
  const url = `${SUPABASE_URL}${pathSuffix}`;
  const headers = {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    'Content-Type': 'application/json',
    ...(init.headers ?? {}),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function findUserByEmail(email) {
  // Pagination — seed set is <30 users, page 1 is sufficient.
  const { ok, body, status } = await adminApi('/auth/v1/admin/users?page=1&per_page=200');
  if (!ok) throw new Error(`list users failed (${status}): ${JSON.stringify(body)}`);
  const users = Array.isArray(body?.users) ? body.users : [];
  return users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function createOrUpdateSupabaseUser(user) {
  const existing = await findUserByEmail(user.email);
  const payload = {
    email: user.email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: {
      tenant_id: TENANT_ID,
      roles: user.roles,
      environment: 'pilot',
      pilot: 'trc',
    },
    user_metadata: {
      first_name: user.firstName,
      last_name: user.lastName,
      // NEVER put tenant_id here — F6 would reject the token.
    },
  };
  if (existing) {
    const { ok, body, status } = await adminApi(
      `/auth/v1/admin/users/${encodeURIComponent(existing.id)}`,
      { method: 'PUT', body: JSON.stringify(payload) },
    );
    if (!ok) throw new Error(`update user ${user.email} failed (${status}): ${JSON.stringify(body)}`);
    return { id: existing.id, alreadyExisted: true };
  }
  const { ok, body, status } = await adminApi('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!ok) throw new Error(`create user ${user.email} failed (${status}): ${JSON.stringify(body)}`);
  return { id: body?.id ?? body?.user?.id, alreadyExisted: false };
}

// ---------------------------------------------------------------------------
// 4. SQL helpers — every seed step is a guarded INSERT…ON CONFLICT DO UPDATE.
// ---------------------------------------------------------------------------

async function ensureTenant(tx) {
  const existing = await tx`
    SELECT id FROM tenants WHERE slug = ${TENANT_SLUG} AND deleted_at IS NULL LIMIT 1
  `;
  if (existing.length) return { id: existing[0].id, alreadyExisted: true };

  await tx`
    INSERT INTO tenants (
      id, name, slug, status, primary_email, country, settings,
      max_users, max_properties, max_units,
      created_at, updated_at, created_by
    ) VALUES (
      ${TENANT_ID},
      'Tanzania Railways Corporation',
      ${TENANT_SLUG},
      'active',
      'dg@trc.go.tz',
      'TZ',
      ${JSON.stringify({
        currency: 'TZS',
        timezone: 'Africa/Dar_es_Salaam',
        pilot: 'trc',
        organization: 'Estate Management Unit',
        approvalMatrix: { threshold: APPROVAL_POLICY_THRESHOLD_TZS, currency: 'TZS' },
      })}::jsonb,
      100, 100, 1000,
      NOW(), NOW(),
      'seed-trc-tenant'
    )
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      status = 'active',
      country = 'TZ',
      updated_at = NOW(),
      updated_by = 'seed-trc-tenant'
  `;
  return { id: TENANT_ID, alreadyExisted: false };
}

async function ensureDistricts(tx, tenantId) {
  const results = [];
  for (const d of DISTRICTS) {
    const existing = await tx`
      SELECT id FROM organizations
       WHERE tenant_id = ${tenantId} AND code = ${d.code} AND deleted_at IS NULL
       LIMIT 1
    `;
    if (existing.length) {
      results.push({ ...d, alreadyExisted: true });
      continue;
    }
    await tx`
      INSERT INTO organizations (
        id, tenant_id, parent_id, code, name, description, level, path, is_active,
        created_at, updated_at, created_by
      ) VALUES (
        ${d.id}, ${tenantId}, NULL, ${d.code}, ${d.name}, ${d.description},
        0, ${`/${d.code}/`}, TRUE,
        NOW(), NOW(), 'seed-trc-tenant'
      )
      ON CONFLICT DO NOTHING
    `;
    results.push({ ...d, alreadyExisted: false });
  }
  return results;
}

async function ensureAppUsers(tx, tenantId, supabaseUsers) {
  const results = [];
  for (const u of supabaseUsers) {
    const existing = await tx`
      SELECT id, organization_id FROM users
       WHERE tenant_id = ${tenantId} AND email = ${u.email} AND deleted_at IS NULL
       LIMIT 1
    `;
    if (existing.length) {
      results.push({ ...u, appUserId: existing[0].id, alreadyExisted: true });
      continue;
    }
    const appUserId = `usr_${randomUUID()}`;
    // Officers/DG attach to a specific district org for filtering UI; DG
    // is left org-less (he's tenant-wide). Lessees stay org-less.
    let organizationId = null;
    if (u.kind === 'officer' && u.email === 'emu.officer1@trc.go.tz') {
      organizationId = `${ORG_PREFIX}_dar`;
    } else if (u.kind === 'officer' && u.email === 'emu.officer2@trc.go.tz') {
      organizationId = `${ORG_PREFIX}_tabora`;
    }
    await tx`
      INSERT INTO users (
        id, tenant_id, organization_id, email, phone, first_name, last_name,
        status, is_owner, timezone, locale,
        created_at, updated_at, created_by
      ) VALUES (
        ${appUserId}, ${tenantId}, ${organizationId}, ${u.email}, NULL,
        ${u.firstName}, ${u.lastName},
        'active', ${u.isOwner}, 'Africa/Dar_es_Salaam', 'sw',
        NOW(), NOW(), 'seed-trc-tenant'
      )
      ON CONFLICT DO NOTHING
    `;
    results.push({ ...u, appUserId, organizationId, alreadyExisted: false });
  }
  return results;
}

async function ensureProperties(tx, tenantId, ownerUserId) {
  const results = [];
  for (const s of STATIONS) {
    const existing = await tx`
      SELECT id FROM properties
       WHERE tenant_id = ${tenantId} AND property_code = ${s.code} AND deleted_at IS NULL
       LIMIT 1
    `;
    if (existing.length) {
      results.push({ ...s, alreadyExisted: true });
      continue;
    }
    await tx`
      INSERT INTO properties (
        id, tenant_id, owner_id, property_code, name, type, status, description,
        address_line1, city, country, default_currency,
        created_at, updated_at, created_by
      ) VALUES (
        ${s.id}, ${tenantId}, ${ownerUserId}, ${s.code}, ${s.name}, ${s.type}, 'active',
        ${`TRC ${s.name} — district ${s.district}`},
        ${s.address}, ${s.city}, 'TZ', 'TZS',
        NOW(), NOW(), 'seed-trc-tenant'
      )
      ON CONFLICT DO NOTHING
    `;
    results.push({ ...s, alreadyExisted: false });
  }
  return results;
}

async function ensureUnits(tx, tenantId) {
  const results = [];
  for (const u of UNITS) {
    const existing = await tx`
      SELECT id, status FROM units
       WHERE tenant_id = ${tenantId} AND property_id = ${u.propertyId} AND unit_code = ${u.code}
         AND deleted_at IS NULL
       LIMIT 1
    `;
    if (existing.length) {
      results.push({ ...u, alreadyExisted: true });
      continue;
    }
    await tx`
      INSERT INTO units (
        id, tenant_id, property_id, unit_code, name, type, status,
        base_rent_amount, base_rent_currency,
        created_at, updated_at, created_by
      ) VALUES (
        ${u.id}, ${tenantId}, ${u.propertyId}, ${u.code}, ${u.name}, ${u.type}, 'vacant',
        ${u.rent}, 'TZS',
        NOW(), NOW(), 'seed-trc-tenant'
      )
      ON CONFLICT DO NOTHING
    `;
    results.push({ ...u, alreadyExisted: false });
  }
  return results;
}

async function ensureCustomers(tx, tenantId, lesseeUsers) {
  const results = [];
  for (const u of lesseeUsers) {
    const customerCode = `CUST-${u.email.split('@')[0].toUpperCase()}`;
    const existing = await tx`
      SELECT id FROM customers
       WHERE tenant_id = ${tenantId} AND email = ${u.email} AND deleted_at IS NULL
       LIMIT 1
    `;
    if (existing.length) {
      results.push({ email: u.email, customerId: existing[0].id, alreadyExisted: true });
      continue;
    }
    const customerId = `cust_${randomUUID()}`;
    await tx`
      INSERT INTO customers (
        id, tenant_id, customer_code, email, phone,
        first_name, last_name, status, kyc_status, nationality,
        created_at, updated_at, created_by
      ) VALUES (
        ${customerId}, ${tenantId}, ${customerCode}, ${u.email}, ${'+25575' + Math.floor(1000000 + Math.random() * 9000000).toString().slice(0, 7)},
        ${u.firstName}, ${u.lastName}, 'active', 'verified', 'Tanzanian',
        NOW(), NOW(), 'seed-trc-tenant'
      )
      ON CONFLICT DO NOTHING
    `;
    results.push({ email: u.email, customerId, alreadyExisted: false });
  }
  return results;
}

async function ensureLeases(tx, tenantId, customersByEmail) {
  const results = [];
  const today = new Date();
  for (const l of LEASES) {
    const customer = customersByEmail.get(l.customerEmail);
    if (!customer) {
      results.push({ ...l, skipped: 'customer not found', alreadyExisted: false });
      continue;
    }
    const existing = await tx`
      SELECT id, end_date FROM leases
       WHERE tenant_id = ${tenantId} AND lease_number = ${l.leaseNumber} AND deleted_at IS NULL
       LIMIT 1
    `;
    if (existing.length) {
      results.push({ ...l, alreadyExisted: true });
      continue;
    }
    // Resolve propertyId from unitId so we keep the seed declaration short.
    const unit = await tx`
      SELECT property_id FROM units WHERE id = ${l.unitId} AND tenant_id = ${tenantId} LIMIT 1
    `;
    if (!unit.length) {
      results.push({ ...l, skipped: 'unit not found', alreadyExisted: false });
      continue;
    }
    const startDate = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
    const endDate = new Date(today.getTime() + l.daysToExpiry * 24 * 60 * 60 * 1000);
    await tx`
      INSERT INTO leases (
        id, tenant_id, property_id, unit_id, customer_id, lease_number,
        lease_type, status,
        start_date, end_date,
        rent_amount, rent_currency, rent_frequency, rent_due_day,
        security_deposit_amount, security_deposit_paid,
        primary_occupant,
        created_at, updated_at, created_by
      ) VALUES (
        ${l.id}, ${tenantId}, ${unit[0].property_id}, ${l.unitId}, ${customer.customerId},
        ${l.leaseNumber},
        'fixed_term', 'active',
        ${startDate.toISOString()}, ${endDate.toISOString()},
        ${l.rent}, 'TZS', 'monthly', 1,
        ${l.rent}, ${l.rent},
        ${JSON.stringify(l.primaryOccupant)}::jsonb,
        NOW(), NOW(), 'seed-trc-tenant'
      )
      ON CONFLICT DO NOTHING
    `;
    // Mark the unit as occupied + link the current lease so reports work.
    await tx`
      UPDATE units
         SET status = 'occupied',
             current_lease_id = ${l.id},
             current_customer_id = ${customer.customerId},
             updated_at = NOW(),
             updated_by = 'seed-trc-tenant'
       WHERE id = ${l.unitId} AND tenant_id = ${tenantId}
    `;
    results.push({ ...l, alreadyExisted: false });
  }
  return results;
}

async function ensureApprovalPolicy(tx, tenantId) {
  const existing = await tx`
    SELECT tenant_id, type FROM approval_policies
     WHERE tenant_id = ${tenantId} AND type = ${APPROVAL_POLICY_TYPE}
     LIMIT 1
  `;
  if (existing.length) {
    // Refresh — the JSON might have evolved between seed runs.
    await tx`
      UPDATE approval_policies
         SET policy_json = ${JSON.stringify({
           ...APPROVAL_POLICY_JSON,
           updatedAt: new Date().toISOString(),
           updatedBy: 'seed-trc-tenant',
         })}::jsonb,
             updated_at = NOW(),
             updated_by = 'seed-trc-tenant'
       WHERE tenant_id = ${tenantId} AND type = ${APPROVAL_POLICY_TYPE}
    `;
    return { alreadyExisted: true };
  }
  await tx`
    INSERT INTO approval_policies (tenant_id, type, policy_json, updated_at, updated_by)
    VALUES (${tenantId}, ${APPROVAL_POLICY_TYPE}, ${JSON.stringify({
      ...APPROVAL_POLICY_JSON,
      updatedAt: new Date().toISOString(),
      updatedBy: 'seed-trc-tenant',
    })}::jsonb, NOW(), 'seed-trc-tenant')
    ON CONFLICT (tenant_id, type) DO NOTHING
  `;
  return { alreadyExisted: false };
}

// ---------------------------------------------------------------------------
// 5. Main.
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[seed-trc-tenant] target Supabase: ${SUPABASE_URL}`);
  console.log(`[seed-trc-tenant] tenant id:      ${TENANT_ID}  (slug=${TENANT_SLUG})`);

  // Step A — create Supabase auth.users (so we know their ids).
  const supabaseUsers = [];
  for (const u of USERS) {
    const { id, alreadyExisted } = await createOrUpdateSupabaseUser(u);
    supabaseUsers.push({ ...u, supabaseUserId: id, alreadyExisted });
    console.log(`  [auth] ${alreadyExisted ? 'exists' : 'created'}: ${u.email}  →  auth.users id = ${id}`);
  }

  // Step B — mirror to app DB inside a transaction so partial failures roll back.
  const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
  let summary;
  try {
    summary = await sql.begin(async (tx) => {
      const tenantResult = await ensureTenant(tx);
      const tenantId = tenantResult.id;
      console.log(`[seed-trc-tenant] tenant: ${tenantResult.alreadyExisted ? 'exists' : 'created'} (id=${tenantId})`);

      const districtResults = await ensureDistricts(tx, tenantId);
      for (const d of districtResults) {
        console.log(`  [org] ${d.alreadyExisted ? 'exists' : 'created'}: ${d.code} (${d.name})`);
      }

      const appUsers = await ensureAppUsers(tx, tenantId, supabaseUsers);
      for (const u of appUsers) {
        console.log(`  [user] ${u.alreadyExisted ? 'exists' : 'created'}: ${u.email} (app id=${u.appUserId})`);
      }

      // Use the DG as the owner_id on every property (he's the sovereign
      // approver and TRC's effective property owner under EMU mandate).
      const dg = appUsers.find((u) => u.kind === 'dg');
      if (!dg) throw new Error('seed-trc-tenant: DG user not found after creation');

      const propertyResults = await ensureProperties(tx, tenantId, dg.appUserId);
      for (const p of propertyResults) {
        console.log(`  [prop] ${p.alreadyExisted ? 'exists' : 'created'}: ${p.code} (${p.name})`);
      }

      const unitResults = await ensureUnits(tx, tenantId);
      console.log(`  [units] ${unitResults.filter((u) => !u.alreadyExisted).length} new / ${unitResults.length} total`);

      const lessees = appUsers.filter((u) => u.kind === 'lessee');
      const customerResults = await ensureCustomers(tx, tenantId, lessees);
      const customersByEmail = new Map(customerResults.map((c) => [c.email, c]));
      for (const c of customerResults) {
        console.log(`  [cust] ${c.alreadyExisted ? 'exists' : 'created'}: ${c.email} (${c.customerId})`);
      }

      const leaseResults = await ensureLeases(tx, tenantId, customersByEmail);
      for (const l of leaseResults) {
        const status = l.skipped ? `SKIPPED (${l.skipped})` : (l.alreadyExisted ? 'exists' : 'created');
        console.log(`  [lease] ${status}: ${l.leaseNumber} on ${l.unitId} (rent=${l.rent / 100} TZS, expires in ${l.daysToExpiry}d)`);
      }

      const policyResult = await ensureApprovalPolicy(tx, tenantId);
      console.log(`  [policy] ${policyResult.alreadyExisted ? 'updated' : 'created'}: lease_exception with TRC matrix`);

      return {
        tenantId,
        appUsers,
        districts: districtResults,
        properties: propertyResults,
        units: unitResults,
        customers: customerResults,
        leases: leaseResults,
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }

  // ---------------------------------------------------------------------------
  // 6. Summary + login commands.
  // ---------------------------------------------------------------------------

  console.log('\n========================================================================');
  console.log('[seed-trc-tenant] CONVERGED — TRC pilot tenant ready');
  console.log('========================================================================');
  console.log(`tenant_id:    ${summary.tenantId}`);
  console.log(`tenant_slug:  ${TENANT_SLUG}`);
  console.log(`districts:    ${summary.districts.length}`);
  console.log(`properties:   ${summary.properties.length}`);
  console.log(`units:        ${summary.units.length}`);
  console.log(`customers:    ${summary.customers.length}`);
  console.log(`leases:       ${summary.leases.length}`);
  console.log('\nUsers:');
  for (const u of summary.appUsers) {
    console.log(`  ${u.email.padEnd(30)} role=${u.roles.join(',').padEnd(18)} supabase_id=${u.supabaseUserId}`);
  }

  console.log('\nLogin example (DG):');
  console.log(`  curl -X POST ${SUPABASE_URL}/auth/v1/token?grant_type=password \\`);
  console.log(`    -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"email":"dg@trc.go.tz","password":"${PASSWORD}"}'`);
  console.log('\nThen call any gateway-authed route with the returned access_token.');
}

main().catch((err) => {
  console.error('[seed-trc-tenant] FAILED:', err?.stack || err);
  process.exit(1);
});
