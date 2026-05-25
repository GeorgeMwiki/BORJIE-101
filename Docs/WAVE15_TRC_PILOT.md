# Wave 15 — TRC Estate Management Unit Pilot

**Status:** Pilotable in 1 week on today's BORJIE code. No new architecture, no new migrations.
**Branch:** `claude/wave15-trc-pilot`
**Last updated:** 2026-05-22

This wave makes the **Tanzania Railways Corporation Estate Management Unit
(TRC EMU)** pilot tenant runnable end-to-end against the live BORJIE
Supabase project. The deliverables here re-use existing tables, services,
and provider code — every "new architecture" temptation is documented as a
gap in the [Known Gaps](#known-gaps--deferred-to-later-waves) section
instead of taking on more schema risk.

## 1. Pilot scope

| Property                  | Value                                                              |
|---------------------------|--------------------------------------------------------------------|
| Tenant id                 | `tnt_trc_001`                                                      |
| Tenant slug               | `trc`                                                              |
| Country / currency / TZ   | `TZ` / `TZS` / `Africa/Dar_es_Salaam`                              |
| Districts (organizations) | 4 — Dar es Salaam, Dodoma, Tabora, Tanga                           |
| Properties (stations)     | 15 — see Step 1 of the demo script                                 |
| Units                     | 30 — warehouses, godowns, plots, kiosks, retail bays               |
| Users (auth + app mirror) | 8 — 2 EMU Officers, 1 Director General, 5 lessees                  |
| Leases                    | 5 — expiring at 60/30/7/1/365 days for cron testing                |
| Approval policy           | `lease_exception` with the TRC matrix below                        |
| Payment rail              | GePG production code, round-trip verified locally                  |
| Notifications             | Existing `notification_dispatch_log` with idempotency key dedupe   |

## 2. Approval matrix (TRC questionnaire → code)

| Lease rent (TZS / month) | Approver           | Role tag         | Notes                                                                 |
|--------------------------|--------------------|------------------|-----------------------------------------------------------------------|
| `<` 500 000              | **EMU Officer**    | `estate_manager` | Auto-escalates to DG after 48 h if no action                          |
| `>=` 500 000             | **Director General** | `owner`        | 72 h SLA, terminal node                                               |
| Any rent + bareland along **Railway Reserve** | EMU Officer **then** Directorate of Civil Engineering & Infrastructure (notification BEFORE leasing) | `estate_manager` + `notify` | Encoded as `trcGuards.requireCivilEngNotificationForBarelandRailwayReserve = true` in the policy JSON |

The matrix is seeded as a row in `approval_policies` (composite PK
`(tenant_id, type)`) with `type = 'lease_exception'`. The full policy JSON
shape is in [`scripts/seed-trc-tenant.mjs`](../scripts/seed-trc-tenant.mjs)
under `APPROVAL_POLICY_JSON`.

## 3. How to seed

```bash
# From repo root, with .env.local populated (NEXT_PUBLIC_SUPABASE_URL,
# SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL — all already present in the
# BORJIE dev Supabase project).
node scripts/seed-trc-tenant.mjs
```

The script is **idempotent**. Run it any number of times — it converges
without duplicating rows or auth users. Re-runs print `(exists)` for
already-present entities; the only thing that updates on every run is the
`approval_policies.policy_json` row (touch-refresh so policy schema
evolution is captured).

Sample output (first run):

```
[seed-trc-tenant] target Supabase: https://nxgawnzsnzzwgapnfvrf.supabase.co
[seed-trc-tenant] tenant id:      tnt_trc_001  (slug=trc)
  [auth] created: emu.officer1@trc.go.tz  → auth.users id = bcce6404-...
  [auth] created: emu.officer2@trc.go.tz  → auth.users id = a4f69549-...
  [auth] created: dg@trc.go.tz            → auth.users id = 54afa175-...
  [auth] created: lessee1@example.com     → auth.users id = 7de3a58d-...
  ... (5 lessees total)
[seed-trc-tenant] tenant: created (id=tnt_trc_001)
  [org] created: DAR (Dar es Salaam District)
  [org] created: DODOMA (Dodoma District)
  [org] created: TABORA (Tabora District)
  [org] created: TANGA (Tanga District)
  [user] created: ... × 8
  [prop] created: ... × 15
  [units] 30 new / 30 total
  [cust] created: ... × 5
  [lease] created: TRC-2026-001 on unit_trc_dar_ctr_bay1 (rent=350000 TZS, expires in 60d)
  ... × 5 leases
  [policy] created: lease_exception with TRC matrix
========================================================================
[seed-trc-tenant] CONVERGED — TRC pilot tenant ready
========================================================================
```

## 4. Login commands

Default password (override with `BORJIE_BOOTSTRAP_PASSWORD`):

```
TrcPilot!Secure-2026
```

```bash
# Director General — sovereign approver for ≥500 000 TZS leases
curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"dg@trc.go.tz","password":"TrcPilot!Secure-2026"}'

# EMU Officer 1 — Dar es Salaam district approver
curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"emu.officer1@trc.go.tz","password":"TrcPilot!Secure-2026"}'

# EMU Officer 2 — Tabora district approver
curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"emu.officer2@trc.go.tz","password":"TrcPilot!Secure-2026"}'

# Lessee (any of lessee1..lessee5)
curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"lessee1@example.com","password":"TrcPilot!Secure-2026"}'
```

The returned `access_token` is a Supabase JWT signed with the project's
ES256 key. The gateway auth middleware
([`services/api-gateway/src/middleware/auth.middleware.ts`](../services/api-gateway/src/middleware/auth.middleware.ts))
verifies it via JWKS and extracts:

- `app_metadata.tenant_id` → `tnt_trc_001` (server-managed, F6-trusted)
- `app_metadata.roles` → `['MANAGER', 'admin']` for officers, `['OWNER', 'admin']` for DG, `['TENANT', 'employee']` for lessees

## 5. Lease-expiry cron

Cron worker:
[`services/api-gateway/src/workers/lease-expiry-alert-cron.ts`](../services/api-gateway/src/workers/lease-expiry-alert-cron.ts)

| Config                                  | Default                                                | Override env                              |
|-----------------------------------------|--------------------------------------------------------|-------------------------------------------|
| Tick interval                           | 24 hours                                               | `LEASE_EXPIRY_ALERT_INTERVAL_MS`          |
| Windows (days before expiry)            | `[60, 30, 7, 1]`                                       | (per-instantiation `windowsDays` option)  |
| Channel priority                        | `whatsapp → sms → email → in_app`                      | (per-instantiation `channelOrder` option) |
| Disable in this process                 | `false`                                                | `LEASE_EXPIRY_ALERT_DISABLED=true`        |
| Idempotency key shape                   | `lease-expiry::<leaseId>::<window>d`                   | (built-in, see `buildIdempotencyKey`)     |
| Dedupe storage                          | `notification_dispatch_log` UNIQUE `(tenant_id, idempotency_key)` | (existing migration 0091)        |

The worker is wired into the gateway boot in
[`services/api-gateway/src/index.ts`](../services/api-gateway/src/index.ts)
right next to the Cases SLA supervisor. It starts on the same `start()`
sequence and stops cleanly during graceful shutdown.

**TRC pilot data verification.** After running the seed script, the cron's
next tick will fire exactly four alerts (one per matched window):

| Lease number | Unit                         | Rent       | Window |
|--------------|------------------------------|------------|--------|
| TRC-2026-001 | unit_trc_dar_ctr_bay1        | 350 000    | 60d    |
| TRC-2026-002 | unit_trc_dar_kur_whs1        | 1 750 000  | 30d    |
| TRC-2026-003 | unit_trc_tbr_wks_g3          | 580 000    | 7d     |
| TRC-2026-004 | unit_trc_tng_prt_whs_a       | 720 000    | 1d     |

`TRC-2026-005` (1-year lease) is the control — it does not match any window
and is correctly skipped.

## 6. GePG sandbox verification

Script: [`scripts/verify-gepg-sandbox.mjs`](../scripts/verify-gepg-sandbox.mjs)

```bash
node scripts/verify-gepg-sandbox.mjs
```

Exercises the production RSA-XML-DSig signer at
[`services/payments/src/providers/gepg/gepg-rsa-signature.ts`](../services/payments/src/providers/gepg/gepg-rsa-signature.ts)
through five checks:

1. `canonicalizeGepgEnvelope` strips XML declaration + collapses whitespace
2. `signGepgEnvelope` returns a non-empty base64 SignatureValue + appends
   `<gepgSignature>` before the closing root tag
3. `verifyGepgEnvelope(signedXml, sameKeys).valid === true`
4. `verifyGepgEnvelope(signedXml, differentKeys).valid === false`
5. Canonicalize idempotency — re-signing produces the same value

**Sample run** (with ephemeral RSA-2048 keys when real sandbox keys absent):

```
[verify-gepg-sandbox] no GEPG_SIGNING_KEY_* found → using ephemeral RSA-2048 test keypair
  [PASS] 1. canonicalize strips XML decl + whitespace — 463 chars
  [PASS] 2. sign produces <gepgSignature> — 344 base64 chars
  [PASS] 3. verify with matching keys — valid
  [PASS] 4. verify with different keys rejected — Signature mismatch
  [PASS] 5. canonicalize idempotency — resigning matches original signature

[verify-gepg-sandbox] ALL CHECKS PASSED — GePG RSA signer is round-trip clean
```

**To use real GePG sandbox keys**, set either of these in `.env.local`:

```ini
# Inline PEM
GEPG_SIGNING_KEY_PEM=-----BEGIN PRIVATE KEY-----...
GEPG_SIGNING_CERT_PEM=-----BEGIN CERTIFICATE-----...

# Or file paths (must be absolute)
GEPG_SIGNING_KEY_PATH=/abs/path/to/key.pem
GEPG_SIGNING_CERT_PATH=/abs/path/to/cert.pem
```

The signer/verifier code path is identical — only the key source changes.
No real traffic is sent to GePG; that requires Tanzania-government-issued
`SpCode` + `SpSysId` and a whitelisted source IP, both out of scope for
Wave 15.

## 7. Tests

| Test file                                                                 | What it covers                                                   |
|---------------------------------------------------------------------------|------------------------------------------------------------------|
| `scripts/__tests__/seed-trc-tenant.test.ts`                               | Seed data shape, idempotency invariants (unique-index pre-checks), approval matrix encoding |
| `services/api-gateway/src/__tests__/lease-expiry-alert-cron.test.ts`      | Window classification (60/30/7/1), idempotency key building, channel selection, end-to-end tick |
| `services/payments/src/providers/gepg/gepg-rsa-signature.test.ts`         | RSA-XML-DSig sign/verify round-trip + cross-key rejection        |

Run them with:

```bash
npx vitest run scripts/__tests__/seed-trc-tenant.test.ts \
                services/api-gateway/src/__tests__/lease-expiry-alert-cron.test.ts \
                services/payments/src/providers/gepg/gepg-rsa-signature.test.ts
```

## 8. Demo script (10 steps)

1. **Open the admin portal**, log in as `dg@trc.go.tz` with
   `TrcPilot!Secure-2026`. Verify "Tanzania Railways Corporation" appears
   as the tenant name with currency `TZS`.
2. **Navigate to Properties** — confirm 15 stations distributed across the
   four district filters (Dar, Dodoma, Tabora, Tanga).
3. **Open a property** (e.g. Kurasini Container Terminal) and confirm 2
   units inside (WHS1 at 1.75M TZS, WHS2 at 1.9M TZS).
4. **Open Leases** — five leases visible. Sort by `End date` ascending and
   confirm one expires in 1 day (TRC-2026-004 at Tanga Port).
5. **Open the lease detail** for TRC-2026-002 (1.75M TZS at Kurasini WHS1).
   Confirm rent currency is TZS and the lessee is Frank Mwakikuti.
6. **Trigger an approval workflow** by creating a lease-exception request
   for a small amount (e.g. 250 000 TZS); confirm it routes to EMU Officer.
7. **Create a second exception for 800 000 TZS** and confirm it routes to
   DG (Director General).
8. **Log out, log in as `emu.officer1@trc.go.tz`** and confirm the dashboard
   scopes to the Dar es Salaam district organization.
9. **Run the GePG round-trip**: `node scripts/verify-gepg-sandbox.mjs`.
   Confirm `ALL CHECKS PASSED`.
10. **Run the lease-expiry cron once**: from a script or a debug endpoint,
    call `leaseExpiryCron.tickOnce()`. Confirm the
    `notification_dispatch_log` table now contains 4 new rows with
    `idempotency_key` matching `lease-expiry::lease_trc_00[1-4]::*d`.

## 9. Known gaps — deferred to later waves

| Gap                                                                      | Why deferred                                                     | Wave |
|--------------------------------------------------------------------------|------------------------------------------------------------------|------|
| Real WhatsApp Business / SMS provider hookup for the lease-expiry cron   | The cron writes to `notification_dispatch_log` with `delivery_status='sent'` via a stub provider in the gateway wiring. Real provider credentials per-tenant need a separate spike. | 16 |
| Bareland-along-Railway-Reserve notification BEFORE leasing               | Encoded as `trcGuards.requireCivilEngNotificationForBarelandRailwayReserve = true` in the policy JSON, but the actual notify-and-block workflow needs a kernel hook in `domain-services/approvals`. | 16 |
| Per-tenant local-time scheduling of the expiry cron (00:00 Africa/Dar_es_Salaam) | The cron currently ticks every 24 h on UTC. Per-tenant DST-aware scheduler ships as part of the wake-loop refactor. | 17 |
| Real GePG sandbox traffic                                                | Requires TZ-government-issued `SpCode`+`SpSysId` and a whitelisted source IP. The local round-trip proves the signer is correct against arbitrary keys. | 16-17 |
| GePG control-number minting + reconciliation against the seeded leases   | The bill-builder code exists at `services/payments/src/providers/gepg/gepg-client.ts`. Wiring it to TRC leases needs a `gepg.bills` repo + a `payment_requests` row per lease. | 16 |
| Drizzle schema for a `lease_expiry_alerts` audit table                   | Wave 15 deliberately re-uses `notification_dispatch_log` for dedupe (idempotency key already unique-indexed). A dedicated audit table can ship later if reporting needs richer per-window history. | 17+ |
| Customer phone numbers seeded from a real opted-in list                  | Currently we generate placeholder `+25575xxxxxxx` numbers. Real onboarding flow per TRC's lessee directory ships in the WhatsApp module wiring wave. | 16 |
| Mobile / customer-app screens for lessee self-service                    | The `apps/customer-app` Next.js project exists but its WhatsApp-flow hookup for TZ phone numbers is incomplete. | 17 |

## 10. File map

| File                                                            | Role                                              |
|-----------------------------------------------------------------|---------------------------------------------------|
| [`scripts/seed-trc-tenant.mjs`](../scripts/seed-trc-tenant.mjs) | Idempotent seed script — tenant + orgs + properties + units + users + leases + approval policy |
| [`scripts/verify-gepg-sandbox.mjs`](../scripts/verify-gepg-sandbox.mjs) | Local GePG round-trip verifier                  |
| [`services/api-gateway/src/workers/lease-expiry-alert-cron.ts`](../services/api-gateway/src/workers/lease-expiry-alert-cron.ts) | Daily multi-tenant lease-expiry alerter |
| [`services/api-gateway/src/index.ts`](../services/api-gateway/src/index.ts) | Wiring: imports + start/stop calls            |
| [`scripts/__tests__/seed-trc-tenant.test.ts`](../scripts/__tests__/seed-trc-tenant.test.ts) | Unit tests for seed shape + idempotency invariants |
| [`services/api-gateway/src/__tests__/lease-expiry-alert-cron.test.ts`](../services/api-gateway/src/__tests__/lease-expiry-alert-cron.test.ts) | Unit tests for window classification + tick |
| [`Docs/WAVE15_TRC_PILOT.md`](./WAVE15_TRC_PILOT.md) | This document                                |
