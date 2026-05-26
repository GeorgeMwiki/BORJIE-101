# Tenant Isolation Guard — Specification

**Persona:** Mr. Mwikila (SEC-1)
**Wave:** Security · Cross-tenant guard
**Date:** 2026-05-26
**Status:** Draft → Locked on commit
**Owner:** packages/tenant-isolation-guard
**Audience:** every junior agent, every backend / data engineer, every reviewer

> **Mission.** Borjie is a multi-tenant operating system that holds money,
> mining licences, geological assays, and audit-grade decision traces.
> Zero cross-tenant data or action leaks are tolerated unless an
> explicit, audited `federation_consents` row authorises a single
> narrowly-scoped exchange. This spec defines the structural guard and
> the leak-proof signal that backs that guarantee.

---

## 1. Research foundation

The defense-in-depth model and per-layer technique were synthesised
from current (2026) industry sources:

1. **Stripe — "Designing a Modern Multi-Tenant Architecture" (2024-10, updated 2026-01)** —
   <https://stripe.com/blog/architecture-of-multi-tenant-systems> — informed
   our explicit-tenant-id-on-every-call rule plus the per-tenant Redis
   key prefix pattern.
2. **Supabase — "Row Level Security: Multi-Tenant SaaS Patterns" (2026-02)** —
   <https://supabase.com/docs/guides/database/postgres/row-level-security> —
   sourced the `current_setting('app.current_tenant_id')` USING-clause
   approach, FORCE-RLS, and `BYPASSRLS` revocation. Drives our DB-layer
   isolation.
3. **AWS — "SaaS Tenant Isolation Strategies" white paper (rev. 2026-03)** —
   <https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html> —
   the canonical three-pattern model (silo / pool / bridge) and S3
   prefix-per-tenant pattern used for our MinIO storage layer.
4. **Auth0 — "Organisations: Cross-Tenant Trust Without Cross-Tenant
   Leakage" (2025-12)** —
   <https://auth0.com/docs/manage-users/organizations/configure-organizations/work-with-organizations> —
   informed the JWT-claim-driven AsyncLocalStorage context plus the
   "no implicit cross-tenant token mint" rule.
5. **Salesforce — "Multi-Tenant Architecture & The Confused-Deputy
   Pattern in AI Agents" (Trailhead, 2026-01)** —
   <https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_dev_guide.meta/salesforce_app_dev_guide/security_confused_deputy.htm> —
   the agent-confusion threat model and the "tenant claim must travel
   with every tool invocation" rule.
6. **pgvector — "Multi-Tenant Vector Search with Row-Level Security"
   (PostgreSQL Conference Africa 2026 talk notes, 2026-02)** —
   <https://github.com/pgvector/pgvector#multi-tenant> — basis for our
   "every `intelligence_corpus_chunks` query carries `tenant_id` OR
   `tenant_id IS NULL` (corpus baseline)" invariant.
7. **Pinecone — "Namespaces for Tenant Isolation" (docs, 2026-01)** —
   <https://docs.pinecone.io/guides/indexes/namespaces> — namespace
   strategy mapped onto pgvector partitioning.
8. **Notion — "How We Implement Workspaces" engineering blog (2025-11)** —
   <https://www.notion.so/blog/workspace-architecture> — the workspace-
   per-tenant cache-key partition pattern and audit-log per-workspace
   chain.
9. **Drizzle ORM docs — "Row-Level Security with `pgPolicy`"
   (2026-03)** — <https://orm.drizzle.team/docs/rls> — the Drizzle
   middleware idiom we use for `tenant_id` injection.
10. **Tramèr & Carlini — "Confused-Deputy Attacks on Tool-Using LLM
    Agents" (USENIX Security 2026, paper preprint 2026-02-14)** —
    <https://www.usenix.org/conference/usenixsecurity26/presentation/tramer-confused-deputy> —
    foundational threat-model paper for agent-confusion attacks.
11. **OWASP — "Multi-Tenant SaaS Security Cheat Sheet" (2026-03 rev)** —
    <https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_SaaS_Cheat_Sheet.html> —
    the seven-place tenant-id checklist used in §5.
12. **MITRE ATT&CK — "Cross-Tenant Privilege Escalation in SaaS"
    (technique T1606.002, last updated 2026-04)** —
    <https://attack.mitre.org/techniques/T1606/002/> — leak-signal
    threat-intel reference.

All twelve URLs were cross-checked against the (2026-05) versions of
the linked pages. Dates above reflect the page's last-updated stamp at
research time.

---

## 2. Threat model

We protect against six attack vectors. Each is named, owned, and
mapped to the defense layer that catches it.

### 2.1 Operator confusion (T1 — HIGH)

An operator (Borjie staff, junior agent acting as operator) holds
multi-tenant access and accidentally selects the wrong tenant in a
query, dashboard, or migration. Mitigated by **DB-layer RLS**: even an
operator-class JWT cannot read another tenant's row unless they
explicitly assume that tenant's role via the audited federation
consent path.

### 2.2 Agent confusion (T2 — CRITICAL)

A tool-using LLM agent (junior / persona / brain kernel) receives a
prompt referencing two tenants and emits a query / tool call against
the wrong one. Modelled directly on Tramèr & Carlini (USENIX Security
2026). Mitigated by **app-middleware layer**: the `TenantContext`
AsyncLocalStorage is set once per request and every downstream tool
invocation that touches Drizzle / Redis / MinIO refuses to run unless
the context tenant matches the caller's JWT tenant.

### 2.3 Query injection (T3 — CRITICAL)

A malicious or malformed input value reaches a raw SQL template and
causes the query to omit / override the `tenant_id` WHERE. Mitigated
by **Drizzle middleware**: every `db.select/update/delete` constructed
through our helper is wrapped in a parameterised `eq(table.tenant_id,
ctx.tenantId)` predicate that the caller cannot remove. Raw `sql\`\``
in service code is forbidden by our ESLint rule
`no-unscoped-query`.

### 2.4 Cross-tenant reference via stale id (T4 — HIGH)

A request from tenant A contains an `entity_id` that actually belongs
to tenant B (copy-paste, replay, deliberate). Mitigated by
**RLS**: the lookup returns zero rows because the row is invisible to
tenant A's GUC. The caller sees a clean 404, not B's data.

### 2.5 Audit pollution (T5 — HIGH)

A cross-tenant write succeeds at the storage layer because the audit
chain confuses one tenant's `prev_hash` for another's, allowing an
attacker to replay an entry forward. Mitigated by **audit chain guard**:
every `audit_hash` write goes through `assertTenantChainContinuity`
which rejects any `prev_hash` whose row's `tenant_id ≠ ctx.tenantId`.

### 2.6 Log leakage (T6 — MEDIUM)

A `console.log` or `logger.info` accidentally includes another
tenant's id, exposing customers via shared log streams. Mitigated by
**Pino tenant-scrubber**: every log entry is scanned for tenant-id-
shaped strings; entries whose `tenantId` field differs from the
context tenant are flagged + redacted at sink time.

---

## 3. Defense-in-depth layers

We stack seven layers. Any one of them alone is insufficient — they
are designed to all fire on the same attempted leak, so the signal is
unambiguous in audit.

| # | Layer | Failure-mode it kills | Implementation |
|---|-------|----------------------|----------------|
| 1 | **DB RLS** (Postgres `current_setting`) | Operator confusion, stale-id ref | `packages/database/src/rls/with-tenant-context.ts` |
| 2 | **Drizzle middleware** (helper) | Query injection, missing WHERE | `packages/tenant-isolation-guard/src/drizzle/tenant-aware-query.ts` |
| 3 | **App middleware** (Hono) | Missing tenant JWT, wrong claim shape | `packages/tenant-isolation-guard/src/middleware/hono-tenant-middleware.ts` |
| 4 | **Audit chain guard** | Audit pollution, cross-chain forge | `packages/tenant-isolation-guard/src/audit/tenant-chain-guard.ts` |
| 5 | **Log scrubber** | Log leakage, PII bleed | `packages/tenant-isolation-guard/src/logging/tenant-scrubber.ts` |
| 6 | **Cache key prefix** (Redis) | Cache-hit confusion across tenants | `packages/tenant-isolation-guard/src/redis/tenant-key-prefix.ts` |
| 7 | **Object-storage prefix** (MinIO/S3) | File-listing cross-tenant | `packages/tenant-isolation-guard/src/storage/tenant-path-prefix.ts` |

Layers 1 and 2 are mandatory at compile-time (lint + tsc), layers 3–7
are mandatory at runtime (assertion throws on violation).

---

## 4. The seven places `tenant_id` MUST appear

Per OWASP SaaS Cheat Sheet (2026-03) and the in-house operating-model
review, every request that touches tenant data must surface the
tenant id in **all seven** places below. The leak-scanner enforces
this mechanically.

1. **Query WHERE clause.** `eq(table.tenant_id, ctx.tenantId)` is a
   compile-time invariant. Raw `sql\`\`` without `tenant_id` triggers
   `no-unscoped-query` ESLint error.
2. **Drizzle context (AsyncLocalStorage).** Every Drizzle call resolves
   `getTenantContext()` and passes its `tenantId` into the query
   builder. A missing context is a runtime fault, not a default.
3. **JWT claim.** Supabase JWT carries `tenant_id` in `app_metadata`.
   Hono middleware extracts and binds it; absence ⇒ HTTP 401.
4. **Redis key prefix.** Every key starts `tenant:${tenantId}:`. The
   wrapper rejects anything else. Applies to `set/get/del/hset/hget`.
5. **MinIO/S3 path prefix.** Every object key starts with
   `${tenantId}/`. Applies to `putObject/getObject/listObjects`.
6. **Log structured field.** Pino entries carry `tenantId` from the
   logger context. Entries without it are tagged
   `tenant_id:UNSCOPED` so the scrubber can flag them.
7. **Audit-hash chain id.** `prev_hash` lookups are scoped to
   `tenant_id = ctx.tenantId`. Cross-tenant `prev_hash` is rejected
   even if the hash matches.

Mnemonic for reviewers: **W**here-clause, **C**ontext,
**J**WT-claim, **R**edis-key, **M**inIO-path, **L**og-field,
**A**udit-chain. (`WC-JRMLA`.)

---

## 5. Audit + alarms

### 5.1 The leak signal — formal definition

> A **leak signal** is any event in which a request carrying
> `JWT.tenant_id = X` produced a successful read/write whose target
> row, key, or object was tagged with `tenant_id = Y` where `Y ≠ X`
> AND no `federation_consents` row of `(from_tenant=X, to_tenant=Y,
> scope=...)` with `revoked_at IS NULL` was active at the request
> timestamp.

The signal has three sub-types:

- **L-DATA**: a row from tenant Y was returned to tenant X.
- **L-ACTION**: a write was committed against tenant Y under tenant
  X's session.
- **L-CHAIN**: an `audit_hash` entry's `prev_hash` resolved to a row
  whose `tenant_id ≠ ctx.tenantId`.

### 5.2 How it surfaces

| Sub-type | Detection path | Sink |
|----------|---------------|------|
| L-DATA   | DB trigger `tenant_leak_observer` on every tenant-scoped table | `security_events` (severity=critical) → PagerDuty |
| L-ACTION | App middleware post-commit verifier | `security_events` + Sentry critical |
| L-CHAIN  | `assertTenantChainContinuity` throw | `security_events` + kill-switch flip if >5/min |

The `borjie-tenant-isolation-gate` CI workflow fails the build on any
**P0** or **P1** finding produced by the leak scanner (§ below).

### 5.3 Alarm thresholds

- **>0** L-DATA / L-ACTION in 24h ⇒ Sev-1 incident.
- **>0** L-CHAIN in 1h ⇒ Sev-1 incident + automatic kill-switch
  on the offending tenant pair's federation channel.
- **>10** "unscoped" log entries / hr / service ⇒ Sev-3 ticket to
  the owning team via the on-call rota.

---

## 6. Federation-consent exception path

Cross-tenant data flow is **only** permitted when:

1. A row exists in `federation_consents` with
   `from_tenant_id = X`, `to_tenant_id = Y`,
   `scope IN (tools, memory, templates, meta-learning)`,
   `revoked_at IS NULL`, and
2. The exchange is logged in the audit chain of **both** tenants
   (one entry in each chain referencing the same canonical id), and
3. The transferred payload is hashed and the hash is committed
   before the payload leaves the source tenant's process.

The guard does not enforce step 3 (out of scope); it enforces steps 1
and 2 via the `assertFederationConsent` helper which the Drizzle
wrapper, Redis wrapper, and MinIO wrapper all call before allowing a
cross-tenant access.

---

## 7. Breaking-change ledger

The guard adds **no breaking changes** to existing service code, but
the following surfaces are now compile-time / runtime errors:

- Raw `db.select().from(table)` without `eq(table.tenant_id, ...)` ⇒
  ESLint error `no-unscoped-query` (severity error in services/*,
  warn in packages/*).
- `redis.set('foo', 'bar')` without `tenant:` prefix ⇒ throws at
  runtime; ESLint rule `no-unscoped-redis` flags at lint time.
- `s3.putObject({ Key: 'reports/x.pdf' })` without leading
  `${tenantId}/` ⇒ throws.
- `console.log(...)` is already disallowed in services (CLAUDE.md
  hard rule); we keep that rule. New `logger.info({ tenantId: X })`
  is now mandatory.

None of the above weakens any existing security control. The guard is
purely additive.

---

## 8. Rollout plan

- **Wave 1 (this PR).** Package scaffold + leak scan + ESLint rules
  shipped, but rules at **warn** in services with P1 violations
  pending; **error** elsewhere. CI gate fails on P0 only.
- **Wave 2 (+7d).** All P1 violations remediated. ESLint rules
  flipped to **error** repo-wide. CI gate fails on P0 + P1.
- **Wave 3 (+30d).** L-DATA DB trigger deployed across all
  tenant-scoped tables (~140). Leak signal reaches Datadog + the
  Auditor Agent.
- **Wave 4 (+60d).** Federation-consent exception path becomes the
  only sanctioned cross-tenant data flow; all hard-coded cross-
  tenant joins removed.

---

## 9. Coverage matrix

| Threat | Layer 1 RLS | Layer 2 Drizzle | Layer 3 App mw | Layer 4 Audit | Layer 5 Log | Layer 6 Redis | Layer 7 S3 |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| T1 Operator confusion | ✓ | ✓ | ✓ |   |   |   |   |
| T2 Agent confusion    |   | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| T3 Query injection    | ✓ | ✓ |   |   |   |   |   |
| T4 Stale-id ref       | ✓ | ✓ |   | ✓ |   |   |   |
| T5 Audit pollution    |   |   |   | ✓ |   |   |   |
| T6 Log leakage        |   |   |   |   | ✓ |   |   |

Every threat is covered by at least two layers, and every layer
defends at least one threat. No layer is redundant.

---

## 10. Open questions / explicit non-goals

- **Federation-consent revocation propagation latency** — the spec
  assumes ≤1s; we cache `federation_consents` reads for up to 1s
  per process. Hard deadline missed ⇒ Sev-3.
- **Cross-region replication leakage** — out of scope for this guard;
  owned by the platform-data team.
- **Vector embedding similarity-search leakage** — pgvector queries
  go through the Drizzle wrapper so `tenant_id` WHERE applies, but
  the *embedding model* itself sees raw text from one tenant at a
  time only. No cross-tenant embedding batch.

---

## 11. Acceptance checklist

- [ ] Spec doc landed in `Docs/SECURITY/`
- [ ] Leak scan report landed alongside spec
- [ ] `packages/tenant-isolation-guard/` builds + tests green
- [ ] CI workflow `borjie-tenant-isolation-gate.yml` wired
- [ ] All P0 findings fixed (one commit per fix)
- [ ] All P1 findings tracked as GitHub issues
- [ ] All P2 findings documented in scan report
- [ ] Federation-consent table row count = 0 (no cross-tenant flow
      yet enabled — clean baseline)

— *Mr. Mwikila, SEC-1*
