# Frontier Dossier — Admin/Owner Data Boundary (INV-A)

**Lane:** `admin-owner-data-boundary` (SOTA survey + code audit)
**Date:** 2026-06-08
**Author:** research subagent (Mr. Mwikila brain-layer / Borjie)
**Status:** dossier only — no code, no commit. Findings feed the MASTER_GAP_REGISTER (INV-A, line 339) and `SPEC_SECURITY_DATA_P0.md`.

---

## 0. The invariant under audit (INV-A, verbatim)

From `Docs/research/MASTER_GAP_REGISTER.md` line 339:

> **INV-A · Admin/Owner control-plane vs data-plane boundary (HARD data-protection wall)**
> - admin-web (port 3020) = BORJIE-INTERNAL control plane ONLY: platform ops + metadata
>   (tenants-as-accounts, billing, system health, global brain config, corpus, evals,
>   kill-switches, announcements). **It must NEVER read tenant business data** (ledger,
>   documents, PII, operational rows). Borjie staff support access is **BREAK-GLASS ONLY:
>   explicit + consented + time-boxed + audited (hash-chained) + ideally tenant-visible.**
> - owner-web (port 3010) = the OWNER's data plane + the owner's OWN admin. Owner-admin
>   features live HERE, NEVER in admin-web.
> - admin-web service-role / RLS-bypass usage MUST be scoped to platform tables; it may
>   not freely select tenant-scoped business rows. **AUDIT this.**

This dossier answers the "AUDIT this" mandate and benchmarks our posture against June-2026 SOTA for "operator cannot read tenant data" multi-tenant platforms. The same wall applies to **BossNyumba** (real-estate twin, `Cursor Projects/BOSSNYUMBA101`), audited in §5.

---

## 1. SOTA survey — how the best multi-tenant operators in the world avoid reading tenant data (June 2026)

The frontier is a ladder of five rungs. Each rung makes the provider's ability to read tenant data **progressively harder to abuse, and progressively impossible**. INV-A as written sits at rung 2-3; the world's best are climbing to rung 5.

### Rung 1 — Control-plane / data-plane bulkhead (table stakes)
The control plane (account/billing/config/health) is a *separate, highly-privileged* system from the data plane (tenant business rows). Microsoft's multitenant guidance is explicit: "a clear separation creates a bulkhead between control planes and data planes… control plane isolation reduces the likelihood of a security vulnerability allowing attackers to elevate their permissions across your entire system." The control plane is allowed broad metadata reach precisely *because* it is firewalled from business data. The corollary that INV-A enforces: **the moment a control-plane surface renders a tenant business row, the bulkhead is breached.** (Azure Architecture Center — Considerations for Multitenant Control Planes; WorkOS multi-tenant guide.)

### Rung 2 — Least-privilege + auditable, justified, *approvable* access (Google Access Transparency / Access Approval)
Google Cloud's three-part model is the reference design:
- **Access Approval** — "lets you decide *if and when* Google personnel can access your Customer Data." Operator access is **denied by default**; the customer must approve each request.
- **Access Transparency** — every operator data access emits an immutable, customer-visible log entry ("discover information about when Customer Data is accessed").
- **Key Access Justifications (KAJ)** — each request for the customer-held key carries a machine-readable *justification code*; the customer can auto-deny justification classes.

Crucial honest limitation Google documents: **during an outage, engineers can access data without approval** (break-glass), but the access is still logged. This is the exact shape INV-A demands: *explicit + consented + time-boxed + audited + tenant-visible.* (Google Cloud — Access Transparency / Access Approval / Key Access Justifications docs.)

### Rung 3 — Metadata-only admin + just-in-time, time-boxed break-glass
The operator console is built to render **only metadata** (account state, plan, health, counts), never business content. When a human truly must touch business data (incident, support), access is **just-in-time**: minted on an approved request, scoped to one tenant, **time-boxed** (auto-expiring session), and every read/write is hash-chained into an append-only audit the tenant can see. AWS, Google, and Salesforce Shield all converge here. Salesforce's 2025 hardening of the Slack API to **block bulk export/long-term retention** of customer data by third-party LLMs is the same principle pushed to the integration layer: *brief, justified, non-retained* access only. (Salesforce/Slack API term changes, 2025 — Computerworld, Hunton privacy blog.)

### Rung 4 — Cryptographic firewall: BYOK / CMK so the provider *cannot* read without the customer's key
Per-tenant envelope encryption with a **Customer-Managed Key** held in the customer's own KMS. The provider stores only ciphertext; to read plaintext it must call the customer's key, which the customer can **revoke or deny per-justification** (KAJ). This moves "operator cannot read" from *policy* to *cryptography*: a rogue operator with full DB/service-role access still sees only ciphertext. (AWS Confidential Computing / KMS; Google KAJ; the per-tenant-key architecture is "the foundational prerequisite for BYOK/CMK" — Medium, Justin Hamade, *Architecting Secure Multi-Tenant Data Isolation*.)

### Rung 5 — Confidential computing + verifiable transparency: the provider has *no mechanism* to read
The frontier, and the "beyond-today" target:
- **AWS Nitro System / Nitro Enclaves** — "built from the ground up, with **no mechanism for operators to access customer content**… no system or person can log in to EC2 Nitro hosts, access the memory of EC2 instances, or access customer data." Enclaves produce a **signed cryptographic attestation document** (PCR measurements) that an external service validates *before* releasing a key — independently affirmed by NCC Group. (AWS — "No AWS operator access," *The Security Design of the AWS Nitro System*; AWS Nitro Enclaves attestation docs.)
- **Apple Private Cloud Compute (PCC)** — the strongest published consumer-scale design, with five mechanisms directly transferable to a tenant-data firewall: **(1) stateless computation** (Secure Enclave re-randomizes the data-volume key every reboot, cryptographically erasing it; request data deleted on completion); **(2) no privileged runtime access** (no remote shell, no interactive debugger — *enforced by code signing*, not policy); **(3) non-targetability** (RSA blind signatures + third-party OHTTP relay so no operator can route a *specific* user's request to a compromised node); **(4) verifiable transparency** (every production build published to an **append-only, cryptographically tamper-proof transparency log**; client devices *attest* the node runs only logged software before sending data); **(5) custom audited observability** (only pre-declared structured metrics leave the node — general logging that could carry user data is impossible). (Apple Security Research — *Private Cloud Compute*.)

**The SOTA verdict for a console like admin-web:** a best-in-class operator console is **metadata-only by construction**, business reads are **deny-by-default + customer-approved + justified + time-boxed + tenant-visibly logged**, business data is **BYOK/CMK-encrypted** so the operator sees ciphertext, and the highest tier runs business compute in **attested enclaves with a published transparency log** so the operator has *no mechanism* — not merely no permission — to read.

---

## 2. Code audit — Borjie admin-web (port 3020) vs INV-A

**Method:** enumerated all `apps/admin-web/src/app` routes + API handlers; traced every page's data source; grepped the whole repo for `SUPABASE_SERVICE_ROLE_KEY`, `break-glass`/`JIT`/`consent`; read the gateway auth + database middleware and the `/internal/*` route gates.

### 2.1 The GOOD pattern already built (keep + extend)
The `/ask`, `/insights`, `/forecasts`, `/radar`, `/industry` surfaces route through `apps/admin-web/src/app/api/platform/*` and a **differential-privacy aggregate layer**:
- `apps/admin-web/src/components/ask/PrivacyBudgetCard.tsx` — reads a real **ε privacy budget** from `/api/platform/budget`; "Never renders a mock number. If the DP-accountant is not reachable, the card honestly says so."
- `apps/admin-web/src/components/ask/SliceSelector.tsx` — every query reasons over a **population slice** (jurisdiction × asset-class × window), prepended visibly + captured in the auditable transcript. No individual-row access.

This is rung-2/3 SOTA done right: platform staff query *aggregates over the industry*, spending a DP budget, never reading a single tenant's rows. **Every business-data need in admin-web should be forced through this lens.** It is the model the violations below must be migrated onto.

### 2.2 VIOLATIONS (concrete, with file evidence + fix)

**V1 — `/warehouse` renders tenant ore-stockpile business data in the internal console. [HIGH]**
- Evidence: `apps/admin-web/src/components/StaffNav.tsx:77` links `{ href: '/warehouse', label: 'Warehouse' }`. `apps/admin-web/src/app/warehouse/WarehouseClient.tsx` calls `GET /api/v1/warehouse/stockpiles` and `/stockpiles/:id/transfers` — tonnage, ore grade, **custody chain-of-custody**, custodian user IDs. This is textbook tenant *operational data*.
- Gateway side: `services/api-gateway/src/routes/warehouse.router.ts:112` gates with **`authMiddleware` only — no `requireRole`**. It is a tenant-RLS-scoped route ("Tenant-isolated via auth middleware; the repos bind `app.current_tenant_id`"). For admin-web to see rows here, a staff session must carry a tenant binding (impersonation) — i.e. the console is *designed to read one tenant's operational data directly*, which INV-A forbids.
- Fix: **delete the `/warehouse` page + StaffNav entry from admin-web.** Ore stockpiles belong on **owner-web (3010)**. If Borjie staff need fleet-level visibility, expose only **DP-aggregated** tonnage/grade distributions through the `/api/platform/*` lens (§2.1) — never per-stockpile rows, never custodian IDs.

**V2 — `/decision-trace` uses `SUPABASE_SERVICE_ROLE_KEY` to RLS-bypass and read tenant decision content, filterable by arbitrary tenant id, with no break-glass gate. [HIGH]**
- Evidence: `apps/admin-web/src/app/decision-trace/page.tsx:73` reads `process.env.SUPABASE_SERVICE_ROLE_KEY`; line 82-100 creates a service-role Supabase client and `.from('decision_traces').eq('tenant_id', tenant)` for *any* `?tenant=` in the query string; the page's own subtitle (line 146) admits "Service-role read; **bypasses tenant RLS**." Same in `apps/admin-web/src/app/decision-trace/[id]/page.tsx:69`.
- Why it violates: `decision_traces` carry tenant *decision content* (chosen branches, payouts, four-eye approvals, tenant resolution) — business data, not platform metadata. INV-A line 347 says service-role/RLS-bypass "MUST be scoped to platform tables." `decision_traces` is tenant-scoped.
- Fix: route this through the gateway's **`/internal/decision-log`** (already `requireRole`-gated) instead of a raw service-role client in the Next.js page; **return projections, not raw tenant content**; and gate the *content* (vs metadata header) behind the break-glass flow in §3. Remove `SUPABASE_SERVICE_ROLE_KEY` from admin-web entirely — a public-facing Next.js app should never hold the service-role key (also a secret-blast-radius problem).

**V3 — `/internal/support/tickets` and `/internal/daily-brief-overview` read cross-tenant business *content*, not just metadata, via RLS-bypass. [MEDIUM]**
- Evidence: `services/api-gateway/src/routes/mining/internal/support-tickets.hono.ts` selects `complianceEscalations` across all tenants and projects `summary` (the **free-text body** of a tenant's compliance escalation). `services/api-gateway/src/routes/mining/internal/daily-brief-overview.hono.ts` returns `topAlerts[].summary` (tenant alert content) and per-tenant dispatch detail; its header admits "The handler bypasses the per-tenant RLS scope so the aggregate sees every row."
- These are correctly `requireRole(SUPER_ADMIN, ADMIN)`-gated (good — rung 1), but they cross from *metadata* (counts, severities, SLAs) into *business content* (escalation/alert free text). Counts are fine for a control plane; the **text bodies are tenant business data**.
- Fix: split each route into a **metadata projection** (tenantId, severity, openedAt, SLA, counts — always allowed) and a **content projection** (`summary`, alert body) that is **only** served under an active break-glass grant for that tenant (§3). The admin console renders metadata by default; clicking through to content triggers the grant flow.

**V4 — `/data-privacy` (GDPR RTBF) executes tenant-PII deletion from the internal console without tenant-visible consent framing. [MEDIUM]**
- Evidence: `apps/admin-web/src/app/data-privacy/DataPrivacyClient.tsx` posts `/api/v1/gdpr/delete-request` and `…/:id/execute` ("super-admin execution"). RTBF *execution* is a legitimate platform-ops function (the operator must be able to honor erasure), but it touches tenant PII rows and is currently framed as a plain admin action.
- Fix: keep the *capability* in admin-web (it is a control-plane duty) but bind execution to the break-glass audit chain (§3) and surface it on the tenant's own owner-web Trust Center as a tenant-visible event. Erasure is HITL-adjacent; it should be hash-chained like money/licence/deletion per CLAUDE.md's inviolable rails.

**V5 — `TenantImpersonateTab` is the right idea but the gateway route is missing — and there is NO break-glass infrastructure anywhere in the repo. [HIGH, systemic]**
- Evidence: `apps/admin-web/src/components/internal/tenants/tabs/TenantImpersonateTab.tsx` describes the correct pattern ("A signed bearer is minted server-side, scoped to {tenant}, emits an immutable audit event, self-expires after 60 minutes") but the button is **disabled** — "the gateway impersonation route is not wired (`POST /tenants/:id/impersonate` 404s)." A repo-wide grep for `break.?glass`, `jit.?access`, `tenant.?consent`, `operator.?access.?request` returns **zero** implementation files (only `packages/ai-copilot/src/dp-memory/types.ts`, unrelated). 
- Why it matters: INV-A line 343-344 *mandates* break-glass; it does not exist. Every cross-tenant read above (V2-V4) is therefore happening (or designed to happen) **without** the consented/time-boxed/tenant-visible gate the invariant requires.
- Fix: build the break-glass spine in §3 first; it is the precondition that makes any legitimate operator data touch compliant.

### 2.3 NON-violations (correctly metadata-scoped — keep)
- `services/api-gateway/src/routes/mining/internal/tenants.hono.ts` — selects the `tenants` *index* (name, slug, plan, status, country) under `requireRole(SUPER_ADMIN, ADMIN)` + `withSecurityEvents`. These rows *are* the tenant-as-account metadata; reading them is the control plane's job. RLS-bypass here is in-bounds (line 347 allows platform-table scope). ✅
- Gateway auth is sound: `services/api-gateway/src/middleware/hono-auth.ts:198-210` (SEC-G2) trusts `tenant_id` **only** from server-managed `app_metadata`, rejecting user-writable `user_metadata` — a staff user cannot forge a tenant binding via their token. ✅
- The `/api/platform/*` aggregate + DP-budget layer (§2.1). ✅

---

## 3. The fix that closes INV-A — a break-glass + tenant-data-firewall spine (concrete, repo-anchored)

1. **Operator Access Request table + flow (rung 2-3).** New `operator_access_grants` (platform-scoped): `{ id, operatorId, tenantId, justificationCode, scope[], requestedAt, approvedBy, approvedAt, expiresAt, status }`. A staff member requesting tenant business data files a request with a **justification code** (mirrors Google KAJ). Default **deny**; grant is **time-boxed** (e.g. 60 min, matching the impersonate copy) and **single-tenant-scoped**.
2. **Wire `POST /api/v1/mining/internal/tenants/:id/impersonate`** to mint a bearer scoped to one tenant *only when an active grant exists*, re-enabling `TenantImpersonateTab`. Every read under that bearer is tagged with the `grantId`.
3. **Hash-chained, append-only audit** — reuse the existing AI audit-chain machinery (CLAUDE.md: "AI audit chain is hash-chained, append-only"). Every operator data access appends `{ grantId, operatorId, tenantId, route, rowCount, ts, prevHash }`. This is Access Transparency.
4. **Tenant-visible mirror** — surface the grant + every access on the tenant's **owner-web Trust Center** (3010): "Borjie support accessed your stockpile data on 2026-06-08 14:02 (grant g_…, justification: incident-INC-441, expires 15:02)." Optionally require tenant **approval** before the grant activates (Access Approval) for high-sensitivity scopes.
5. **Force-deny-by-default in the gateway** — add a middleware on tenant-business routes that, when the caller is a *platform* principal (not the tenant's own user), **refuses** unless an active `operator_access_grant` matches `(operatorId, tenantId, scope)`. This is the structural enforcement that makes V1-V4 impossible to reach silently.
6. **Strip `SUPABASE_SERVICE_ROLE_KEY` from admin-web** — no public Next.js app holds the service-role key; all cross-tenant reads go through gateway routes that enforce step 5.

---

## 4. Beyond-today — a cryptographic tenant-data firewall the Borjie operator *literally cannot* bypass

Policy + audit (rungs 2-3, §3) stops an *honest* operator and catches a dishonest one *after* the fact. The owner's directive ("the bar is SOTA, best-in-the-world") points at rungs 4-5, where a rogue Borjie operator with full DB + service-role access **still sees only ciphertext or has no mechanism at all**:

1. **Per-tenant BYOK/CMK envelope encryption (rung 4).** Each tenant's sensitive business columns (ledger, documents, PII, decision-trace content) are encrypted with a per-tenant DEK wrapped by a tenant-controlled KEK in the tenant's KMS (or a Borjie-hosted KMS the tenant can revoke). The DEK release carries a **Key Access Justification** code; the tenant can auto-deny justification classes. A break-glass read becomes a **cryptographically gated, justified, revocable** event — the operator with raw Postgres access reads only ciphertext. We already have the seam: `packages/database` has a `selectEncryptionPort` / `createFieldEncryptionAuditService` (see `services/api-gateway/src/middleware/database.ts`) — extend it from field-encryption to **per-tenant-keyed** envelope encryption with a KAJ-style justification on every unwrap.
2. **Attested confidential-compute enclave for the break-glass read path (rung 5, Nitro/PCC pattern).** The *only* code permitted to decrypt and render tenant business content for an operator runs inside an **attested enclave** (AWS Nitro Enclave or equivalent). The KMS releases the unwrapping key **only against a valid attestation document** (PCR measurements) of a build whose source is published to an **append-only transparency log**. Apple-PCC-style: **no remote shell, no debugger** in the enclave (enforced by code signing); only pre-declared structured audit metrics leave it. A Borjie operator cannot `ssh` in, cannot attach a debugger, cannot exfiltrate — there is **no mechanism**, not merely no permission.
3. **Non-targetability for support reads (PCC mechanism 3).** Operator break-glass requests are blind-signed and relayed so that no single insider can *target* a specific high-value tenant's node — defeating the "rogue insider picks the richest mine and reads it" threat that pure RBAC leaves open.
4. **Published transparency log of the admin console build itself.** Every admin-web/gateway build that *could* touch tenant data is hash-published; tenants (and regulators — note the existing `/regulator` surface) can verify that the operator console running in production is the audited, metadata-only-by-construction build. This turns INV-A from a documented promise into a **continuously verifiable** one.

The end-state: INV-A is enforced **by cryptography and attestation, not by code review** — the strongest form of the wall, matching what AWS Nitro and Apple PCC ship today.

---

## 5. BossNyumba (real-estate twin) — same wall, same gaps

Same brain/capability/wiring, only the domain differs, so the boundary findings **transfer 1:1**:
- `Cursor Projects/BOSSNYUMBA101/apps/admin-platform-portal/src/app/decision-trace/page.tsx:72` + `[id]/page.tsx:69` use the **identical `SUPABASE_SERVICE_ROLE_KEY` RLS-bypass** to read tenant decision content → **V2 applies verbatim**.
- BN's tenant-business analog of V1 is its property/inventory/lease/maintenance/rent-roll surfaces; any of these reachable from the admin-platform-portal must be deleted/aggregated exactly as §2.2 V1 prescribes (the advisor surfaces seen — lease-up curves, predictive-maintenance — must run on **aggregates**, not a named landlord's rows).
- The §3 break-glass spine and §4 cryptographic firewall are **brain-layer/shared**, so build them once and both estates inherit the wall.

---

## 6. One-line verdict

Borjie's admin-web has the *correct* SOTA aggregate-query lens (`/ask` + DP budget) already built — but **four leaks** (`/warehouse`, `/decision-trace` service-role, `support-tickets`/`daily-brief` content, `/data-privacy`) cross INV-A's wall, and the **break-glass spine the invariant mandates does not exist**. Close it with the §3 deny-by-default + consented/time-boxed/hash-chained/tenant-visible grant flow now, then climb to §4's BYOK/CMK + attested-enclave firewall so the operator *cannot* read rather than *must not*. BossNyumba carries the same gaps and inherits the same fix.
