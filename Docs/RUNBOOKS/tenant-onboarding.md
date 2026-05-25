# Tenant Onboarding — End-to-End

**Scope**: provisioning a brand-new tenant org from the single-command
bootstrap through autonomy defaults, feature flags, and demo data. The
bootstrap script itself is idempotent — safe to re-run.

---

## 1. One-command bootstrap

Wrapper at `scripts/bootstrap-tenant.sh` (validates tooling + env) that
execs `scripts/bootstrap-tenant.ts`:

```bash
scripts/bootstrap-tenant.sh \
  --name "Acme Properties" \
  --country TZ \
  --admin-email admin@acme.example \
  --admin-phone "+255712345678" \
  [--slug acme] [--with-demo-data] [--dry-run] [--json]
```

Eight steps documented at `scripts/bootstrap-tenant.ts:4-28` — every
Postgres write lives in a single transaction so a partial tenant cannot
leak. Re-running with the same slug + admin email converges (step-level
idempotency).

---

## 2. Country plugin selection

Country plugins live in `packages/compliance-plugins/src/countries/`
with one directory per ISO-3166 alpha-2 code. Full-fidelity profiles
today (`packages/compliance-plugins/src/countries/index.ts:79-94`):

| Code | Notes                                                       |
| ---- | ----------------------------------------------------------- |
| TZ   | First-class — see Tanzania notes below                       |
| DE, FR, GB, SG, CA, AU, IN, BR, JP, AE, MX, KR | Hand-authored real-data profiles |

Every other ISO code resolves to an auto-generated scaffold
(`SCAFFOLD_PROFILES`) and unknown codes fall through to
`GLOBAL_DEFAULT_PROFILE` (USD / English / Stripe + manual rail) — see
`packages/compliance-plugins/src/countries/index.ts:122-162`.

The bootstrap defaults `--country TZ` via
`getTenantCountryDefault()` at
`packages/compliance-plugins/src/countries/index.ts:204-207`.

### Tanzania specifics (first-class)

Plugin at `packages/compliance-plugins/src/countries/tz/index.ts`
(511 lines) encodes:

- **WHT on rent** — 10% resident / 15% non-resident / 30% corporate
  (ITA 2004 § 83, lines 8-14).
- **Deposit caps** — 6 months residential industry norm, 12 months
  commercial (LLTA 2022 § 32, lines 30-32).
- **Notice windows** — 30-day non-payment, 90-day end-of-term residential,
  180-day major-refurb repossession (lines 32-35).
- **Data protection** — PDPA 2022 + 2023 Regulations; plugin stamps
  `country: 'TZ'` on every audit event (lines 41-46).
- **Identity** — NIDA 20-digit national ID validator (line 50+).
- **Payment rails** — GePG, M-Pesa (wired via env prefixes in the
  plugin).

Currency on the tenant row comes from `resolveCountryCurrency` at
`scripts/bootstrap-tenant.ts:62`.

---

## 3. Autonomy policy defaults

`bootstrap-tenant.ts` step 7 registers a default `AutonomyPolicy` built
by `packages/ai-copilot/src/autonomy/defaults.ts:19-102`.

Key defaults (safe by design — conservative where policy matters, bold
where payoff justifies it, per the file header lines 1-13):

| Domain            | Notable default                                                             |
| ----------------- | --------------------------------------------------------------------------- |
| `autonomousModeEnabled` | `false` — heads explicitly flip the master switch                       |
| finance           | auto-send reminders at 5 / 10 / 20 days (line 27)                           |
| finance           | escalate arrears above 500,000 minor units (line 30)                        |
| leasing           | auto-approve same-terms renewals (line 33); rent-increase cap 8% (line 34)  |
| maintenance       | auto-approve below 100k minor units (line 40); safety-critical → human (44) |
| compliance        | auto-draft notices, NEVER auto-send legal notices (lines 46-47)             |
| communications    | quiet hours 21:00–07:00 (lines 55-56)                                       |
| marketing / hr / procurement / insurance | all auto-* flags `false` or zero-threshold (lines 62-77) |
| legal_proceedings | auto-draft eviction notices ok; auto-file tribunal blocked (lines 83-87)    |

Matrix dimensions (`DELEGATION_MATRIX_DIMENSIONS` at
`packages/ai-copilot/src/autonomy/defaults.ts:109-113`): 11 domains × 6
action types = 66 cells. Heads loosen individual cells via the delegation
matrix UI after onboarding.

---

## 4. Feature-flag setup per tenant

Router at `services/api-gateway/src/routes/feature-flags.router.ts`
mounted at `/api/v1/feature-flags` (see file header lines 2-8):

- `GET /feature-flags` — resolved list for the caller's tenant.
- `PUT /feature-flags/:key` — admin-only override, body
  `{ enabled: boolean }`. Role gate at lines 64-68 requires
  `TENANT_ADMIN`, `SUPER_ADMIN`, or `ADMIN`.

Platform-default flags seed inside the bootstrap transaction at
`scripts/bootstrap-tenant.ts:102-104` (`seedPlatformDefaults`). To
override a flag post-onboarding:

```bash
curl -X PUT "$BASE/api/v1/feature-flags/<key>" \
  -H "Authorization: Bearer $TENANT_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"enabled": true}'
```

Unknown flag → 404 (`UNKNOWN_FLAG`); validation error → 400; service
unwired → 503 `NOT_IMPLEMENTED` (lines 27-37, 85-90).

---

## 5. Seed demo-org fixtures

No standalone `scripts/seed-demo.ts` exists. The real path is the
workspace `db:seed` runner at
`packages/database/src/seeds/run-seed.ts`, documented in
`packages/database/src/seeds/README.md:15-28`:

```bash
SEED_ORG_SEEDS=true DATABASE_URL=postgres://... pnpm db:seed --org=demo
# or everything registered:
SEED_ORG_SEEDS=true DATABASE_URL=postgres://... pnpm db:seed --org=all
```

The `demo` seed ships a Tanzania-based enterprise tenant with 4
districts / ~20 regions / ~50 stations, 20 properties, 15 active
leases, 50 ledger entries, 5 maintenance cases — see the "What's in each
seed" table at `packages/database/src/seeds/README.md:41-58`. Each seed
runs inside its own transaction and is idempotent (`ON CONFLICT DO
NOTHING`, deterministic `<org>-*-NNN` ids).

Alternative at tenant-create time: pass `--with-demo-data` to the
bootstrap script to inline-seed starter data (step 6 at
`scripts/bootstrap-tenant.ts:14`).

---

## 6. Close-out checklist

- [ ] `tenants.status = 'active'`; admin user receives welcome email.
- [ ] First executive briefing scheduled for next Monday 08:00 local
      (`scripts/bootstrap-tenant.ts:11`).
- [ ] Feature-flag list loads via `GET /api/v1/feature-flags`.
- [ ] Autonomy policy v1 row visible in `autonomy_policies` for
      `tenantId`.
- [ ] Bootstrap audit entry written (step 8).

Teardown (dev/test only): `scripts/teardown-tenant.sh` gated behind
`BORJIE_ALLOW_TEARDOWN=true` — see
`Docs/OPERATIONS.md:228-229`.

---

## Cross-links

- Incident response if a tenant breaks: [`./incident-response.md`](./incident-response.md)
- Migration cadence: [`./migration-production.md`](./migration-production.md)
- Rate-limit policy (per-role caps applied from first request): [`../RATE_LIMITS.md`](../RATE_LIMITS.md)
