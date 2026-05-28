# Multi-Region Readiness — Gap Audit

**Last Updated:** 2026-05-28
**Audit type:** read-only — no blockers in this doc were fixed during
the SCALE HARDENING wave. Each row is a follow-up wave candidate.
**Default region today:** `eu-west-1` (Ireland) per
`infrastructure/terraform/variables.tf::aws_region`.
**Target Borjie geography:** Tanzania + East Africa today; pan-African
ambition (KE, UG, NG) and Gulf institutional investors next. Compliance
posture requires the option for a TZ data residency (NIDA / PDPA TZ)
without porting the codebase.

## Posture summary

| Pillar | Current | Multi-region ready? |
|--------|---------|---------------------|
| Compute (api-gateway, workers) | Single region, HPA 3–20 pods | YES — stateless, can run in N regions |
| Postgres primary | Single region (`eu-west-1`) | NO — primary write region only |
| Postgres read replicas | Same-region; Z5 HA scaffold under `infrastructure/` | NO — no cross-region replica wired |
| Redis (rate-limit, idempotency cache) | Single region, Sentinel HA | NO — would need Redis Cluster or per-region instance with sticky tenant routing |
| Object storage (S3) | Single bucket, single region | YES — flip on cross-region replication, no code change |
| Supabase auth | Single project (single region) | NO — Supabase is single-region per project; would require federated auth or per-region projects |
| OTel collector + Sentry | Single region exporter | YES — endpoints are global, just add per-region exporters |
| Audit hash-chain | Single Postgres table | NO — hash-chain assumes a single linear history |

## Blockers (must close before going multi-region)

### B1 — Postgres write topology

**What:** All writes today go to a single `db.t4g.large` primary. The
RLS GUC `app.current_tenant_id` is bound at the api-gateway and assumed
to be valid for the single global write target.

**Why a blocker:** A multi-region deploy that hits a non-local primary
adds 100+ ms of write latency per tenant action (irrespective of how
fast the brain is). The brain's per-turn ledger writes (audit-chain,
decision-trace) become a hot bottleneck.

**Options:**
1. **Aurora Global Database** with secondary regions, manual failover.
   Adds the option to read locally per region but writes still funnel
   to the primary. Tenant-level write affinity is the right shape for
   single-tenant-per-region.
2. **CockroachDB Serverless / Dedicated** with multi-region table
   localities. Tenant_id becomes the partition key; per-tenant
   write region is declared by the `tenants.primary_region` column
   (column does not exist yet — gap G4 below).
3. **YugabyteDB.** Same shape as CockroachDB; postgres-wire compatible
   so the Drizzle layer is unchanged.

**Recommended:** option 2 (CockroachDB) — preserves Drizzle/postgres
wire, gives clean per-tenant locality, and the tenant_id partition
matches our RLS shape exactly.

**Effort:** 4–6 weeks engineering.

### B2 — Redis topology

**What:** Single Redis Sentinel cluster in `eu-west-1`. The
per-tenant rate-budget middleware and the webhook idempotency cache
fail CLOSED if the cluster is unreachable.

**Why a blocker:** Cross-region request to Redis adds 50–150 ms;
combined with the per-request token-budget INCRBY this would dominate
chat-first-frame latency. Fail-closed behaviour means a cross-region
network partition kills inbound webhooks.

**Options:**
1. Per-region Redis cluster + tenant routing at the L7 load balancer
   so a tenant always lands in its home region.
2. Redis Cluster with cross-region replication (Active-Active via
   Redis Enterprise). Higher cost; preserves transparent multi-region.

**Recommended:** option 1 (sticky tenant routing) — cheapest and
matches the per-tenant write region from B1.

**Effort:** 1–2 weeks once B1 lands.

### B3 — Supabase single-project topology

**What:** Borjie uses a single Supabase project; JWTs are issued by
its single auth server. The api-gateway verifies signature against
the Supabase JWKS endpoint.

**Why a blocker:** Supabase does not support multi-region a single
project. A tenant whose data lives in `me-central-1` cannot get
auth-server affinity without either:
1. running a second Supabase project (means two JWKS endpoints, two
   user pools, two RLS posture surfaces), or
2. moving auth out of Supabase entirely.

**Options:**
1. Keep Supabase as primary auth; mirror token verification per
   region by caching the JWKS at the api-gateway (current behaviour).
   Accept the ~50 ms cross-region auth lookup latency.
2. Replace Supabase auth with a federated provider (Cognito / Auth0)
   that supports per-region presence. Heavy lift; touches every
   sign-in / sign-out path.
3. Run per-region Supabase projects + federated identity layer
   (a thin proxy that mints a Borjie JWT after asserting a Supabase
   JWT from the home region). Adds a hop; preserves Supabase as the
   user-pool source of truth.

**Recommended:** option 1 short-term, option 3 long-term.

**Effort:** 4–8 weeks for option 3.

### B4 — Hash-chained audit invariant

**What:** `packages/observability/src/audit/audit-logger.ts` writes
to a single hash-chained `ai_audit_chain` table. Each event SHA-256s
the previous event's hash + its own payload. Verification walks the
chain linearly.

**Why a blocker:** Multi-region writes against the same table cause
hash divergence — two concurrent writers in different regions both
read `prev_hash = X` and each commit a row with `prev_hash = X`,
breaking the linearity invariant.

**Options:**
1. Per-region hash chain (one chain per `home_region`). Sovereign
   reviewer verifies each chain independently. Cross-region tenant
   migration becomes a "fork point" in the chain.
2. Centralised auth writer service that serialises all chain writes
   (single-writer Kafka partition keyed by tenant_id). Adds a
   bottleneck but preserves the linear invariant per tenant.

**Recommended:** option 1 (per-region chain) — matches the per-tenant
write region from B1 and B2.

**Effort:** 2–3 weeks.

## Schema / app gaps (lower severity but on the path)

### G1 — No `tenants.primary_region` column

**Where:** `packages/database/src/schemas/tenants.schema.ts` — has
`country`, `default_language`, `primary_currency` from migration
`0085`, but no region affinity field.

**Required:** add migration `0091_tenant_primary_region.sql` adding
`primary_region text NOT NULL DEFAULT 'eu-west-1'` with CHECK against
the enum `('eu-west-1', 'me-central-1', 'us-east-1', 'af-south-1')`.

### G2 — Cross-tenant memory federation has no region awareness

**Where:** `personal_memory_cells` (migration `0088`) — federated,
no RLS. Boundary tagger filters by `app.current_person_id` at brain
turn time.

**Required:** boundary tagger must additionally check
`person.home_region == request.region` before surfacing a cell
across regions, or 451 (Unavailable For Legal Reasons) for residency
violations.

### G3 — Outbox / Inngest is single-region

**Where:** `services/outbox-processor`, Inngest cloud config.

**Required:** per-region outbox + Inngest function set; tenant-affinity
routing in the dispatcher.

### G4 — File ingest / OCR is single-region

**Where:** `packages/document-analysis`, `services/consolidation-worker`.

**Required:** uploaded documents currently land in a single S3 bucket
in `eu-west-1`. PDPA TZ requires TZ-resident documents stay in a
TZ-resident bucket. Add `tenant.primary_region` to ingest path; route
to per-region bucket.

### G5 — Object storage cross-region policy

**Where:** Terraform `infrastructure/terraform/`.

**Required:** S3 cross-region replication rules with object-lock; sse-kms
keys per region; per-tenant prefix.

### G6 — OTel collector + Sentry per region

**Where:** `services/api-gateway/src/observability/otel-bootstrap.ts`.

**Required:** OTEL exporter endpoint should be region-local
(`https://otel.<region>.borjie.co.tz`). Sentry can stay global but
should tag spans with `region`. Trivial change.

### G7 — Geo-routing schema (`packages/database/src/schemas/geo-routing.schema.ts`)

**Where:** schema exists but has no production wiring.

**Required:** populate region-routing table, wire api-gateway to read
it and prefer in-region downstream services.

## What is multi-region-ready today

- **Stateless services:** api-gateway, consolidation-worker,
  outbox-processor, payments-ledger — all can run in N regions with
  shared config.
- **S3:** flip on `aws_s3_bucket_replication_configuration`.
- **Helm / k8s charts:** under `k8s/` — region-agnostic.
- **CORS allowlist:** add region-specific subdomains to
  `ALLOWED_ORIGINS`.
- **CDN (CloudFront / Cloudflare):** geo-aware routing is a config
  change.

## Decision matrix

| Decision | Owner | Target |
|----------|-------|--------|
| Cockroach vs Aurora Global vs Yugabyte | Founder + DBA | wave +2 |
| Per-region Redis vs Active-Active | SRE | wave +2 (after B1) |
| Supabase posture | Founder + Auth team | wave +3 |
| Per-region hash chain | Compliance + Brain team | wave +3 |
| TZ residency MVP (single tenant, single TZ region) | Founder | wave +4 (pilot for institutional buyer) |

## Effort estimate to fully multi-region

- Blockers (B1–B4): **10–14 weeks** engineering.
- Schema gaps (G1–G7): **3–4 weeks** engineering, mostly migrations
  + outbox refactor.
- Compliance review (PDPA TZ, NIDA, Bank of Tanzania bank-data rules):
  **2–4 weeks** legal review.
- Per-tenant runbook (operator playbook for cross-region migration):
  **1 week**.

**Total:** ~16–22 weeks (4–5 months) to ship a credible MVP that can
host an institutional buyer's data exclusively in `me-central-1` or
`af-south-1`.

## References

- `infrastructure/terraform/variables.tf::aws_region`
- `packages/database/src/schemas/tenants.schema.ts`
- `packages/database/src/schemas/geo-routing.schema.ts`
- `packages/observability/src/audit/audit-logger.ts`
- `services/api-gateway/src/middleware/per-tenant-rate-budget.ts`
- `services/api-gateway/src/middleware/webhook-idempotency.middleware.ts`
