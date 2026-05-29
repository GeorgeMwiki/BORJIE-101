# Unified Personal Knowledge Base Across Tenants — SOTA 2026

**Audience:** Borjie architects, brain team, persona-runtime owners.
**Status:** Research-only. Pure synthesis. No code touched.
**Date:** 2026-05-27.
**Author-context:** Deep online research, ≥10 WebSearch + ≥6 WebFetch
queries (citation list at bottom). All file paths absolute. All schema
references verified against the live Borjie tree.

---

## 0. The Borjie problem, restated precisely

A single human (call her **Asha**) can simultaneously occupy four
distinct relationships to the Borjie platform:

| Role | Tenant | RLS scope |
|------|--------|-----------|
| Owner of Mine A (Geita) | `tenant_id = mine_a` | full read/write |
| Manager at Mine B (Mwanza, employed) | `tenant_id = mine_b` | scoped to her department |
| Worker at Mine C (Shinyanga, weekend casual) | `tenant_id = mine_c` | crew-level, narrowest |
| Buyer for Refiner D (Dar-es-Salaam) | `tenant_id = refiner_d` | buyer module only |

Today (post wave-18AA) every memory write in `cognitive_memory_cells`,
`session_memory`, `kernel_memory_episodic`, `core_memory_blocks`, etc.
carries `tenant_id` and is gated by the `app.current_tenant_id` GUC RLS
policy. `persona-runtime` switches `tenant_id` per session.

**The user-visible promise we want to keep** is:
*"Mr. Mwikila is **my** assistant, not the mine's. He remembers I prefer
Swahili, that my mother died last August, that my Lithium-pen-test pass
threshold for buying is 0.8% — across every hat I wear."*

**The hard invariants we cannot break** are:
- Mine A's tonnage numbers must never appear in Mine B's chat context.
- Refiner D's price book must never leak into Mine A's planning.
- Mine C's payroll must never reach Refiner D's procurement screen.
- Tanzania PDPA + GDPR portability rights belong to Asha, not the org.
- Hash-chained audit (`@borjie/audit-hash-chain`) must capture every
  cross-context retrieval.

The technical question this doc answers: **where does Asha's
person-level memory live, how is it co-queried with tenant memory at
turn time, and how do we prove no number ever crosses an org line?**

---

## 1. The fundamental tension

There are exactly two stable resolutions to "person versus tenant":

### Resolution A — **Per-tenant is canonical** (current Borjie)
Every fact, including personal preferences, is duplicated per tenant.
- ✅ Trivial RLS, zero leakage, single-table query path.
- ❌ Asha re-trains Mr. Mwikila 4× ("call me Asha, not Madam"). Drift.
- ❌ No "where was I across all mines yesterday?" view.
- ❌ Mr. Mwikila can never honestly say "I know you" — only "I know the
   owner of Mine A".

### Resolution B — **Person is canonical, tenant is a lens**
A person-graph exists at a higher layer than any tenant; tenant graphs
hang off it. Each turn composes both.
- ✅ Asha is one person to her assistant.
- ✅ Cross-org portability (GDPR Art. 20) is native.
- ❌ Requires a NEW retrieval path with stricter cross-boundary policy.
- ❌ Reasoning about "what is personal vs what is the mine's IP" must be
   explicit at every write.

**Borjie's correct resolution is B with a guarded composition rule.**
This document is the design.

### Legal framing — who actually owns what

| Class of data | Owner | Authority |
|--------------|-------|-----------|
| Asha's name, phone, language preference, biometric | Asha | GDPR Art. 4(1); PDPA TZ §3 — "data subject" |
| Asha's payroll at Mine C | Mine C (controller) + Asha (subject) | PDPA TZ §31 cross-border controls |
| Mine A's gold-grade per shaft | Mine A | trade secret, Mining Act 2010 §92 |
| Asha's evaluation of Mine A's geology by Asha-the-buyer | contested | resolve per `person_links.share_consent` |
| AI-derived "Asha trusts geologists with PhDs more than ML buyers" | hybrid; not portable under GDPR Art. 20 because it is *inferred* | see §10 |

Crucially, GDPR's Article 20 right to portability covers data **the
subject provided** — it explicitly does NOT cover inferred / derived
personal models. (See [gdpr-info.eu/art-20-gdpr](https://gdpr-info.eu/art-20-gdpr/).)
That gives Borjie legal headroom to keep the AI-inferred personal layer
in our system as a *service* to Asha while still honouring portability
for raw inputs. Tanzania's PDPA Part V mirrors this scope.

---

## 2. Account models — ranked by fit for Borjie

| # | Model | Real-world example | Person ↔ Org linkage | Fit for Borjie |
|---|-------|-------------------|----------------------|----------------|
| 1 | **GitHub** — personal account + multi-org membership | github.com | One `user_account`; many `organization_memberships`; resources owned by either | **Best.** Owners do own their KPIs. Workers do own their attendance. Both ship through one identity. |
| 2 | **Clerk Organizations** (with Personal Accounts ENABLED) | clerk.com | `User` (global) + `Organization` + `OrganizationMembership` with per-org role | Drop-in match for our Supabase JWT flow. `<OrganizationSwitcher/>` mental model is exactly Borjie's persona switcher. |
| 3 | **WorkOS Multi-org pattern** | workos.com | One `User`; many `OrganizationMembership` rows | Identical shape; their guide names this "many-to-many", suitable for Figma-style multi-workspace apps. |
| 4 | **Linear** — single workspace; multi-team within | linear.app | Workspace = bag of teams; same `Member` in many teams | Wrong shape: Linear is one tenant subdivided. Borjie has truly separate tenants. |
| 5 | **Slack** (non-Enterprise) — separate accounts per workspace | slack.com | Email reused but each workspace gets its own User-ID | The anti-pattern. Loses identity continuity, exactly what we want to avoid. |
| 6 | **Slack Enterprise Grid** — same identity across workspaces | slack.com | One Enterprise org spans many workspaces | Closer to what we want, but it presumes a single enterprise umbrella. Borjie's mines are independent businesses. |
| 7 | **Discord** — global user_id; per-server nickname & profile | discord.com | One Discord ID, server-scoped display_name/role | Great precedent: identity is one, *presentation* is per-server. Borjie should mirror this: one `person`, per-tenant `persona_render`. |
| 8 | **Solid / Inrupt pods** — person owns the data, orgs lease | solidproject.org | All data lives in Asha's pod; tenants request scoped access | Radical and aspirational. The 2027+ direction. See §11. |
| 9 | **Auth0 multi-tenant via `app_metadata`** | auth0.com | Tenants jammed into one user's `app_metadata` blob | Operationally fragile (per Auth0 community: wrong-tenant writes happen). |
| 10 | **Stripe Connect** — person-identity verified once, attached to many business accounts | stripe.com | One KYC subject; many `account.individual` linkages | Useful pattern for *trust portability*: verify Asha's national-ID once; reuse across mines. |

**Recommendation for Borjie: model #1 + #2 + #7 combined.**
- GitHub-style ownership semantics (person can own resources too).
- Clerk-style switcher UX (we already have persona-runtime).
- Discord-style per-tenant *presentation* of one underlying identity.

---

## 3. Knowledge architecture patterns

### 3.1 Person-graph + Org-subgraphs (canonical pattern)

```
                       ┌─────────────────────┐
                       │   PERSON: Asha      │
                       │   - lang: sw        │
                       │   - phone: +255…    │
                       │   - personal prefs  │
                       │   - life events     │
                       │   - Mr.Mwikila trust│
                       └──────────┬──────────┘
                                  │ memberships
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
   ┌────────▼────────┐  ┌────────▼────────┐  ┌─────────▼─────────┐
   │ ORG: Mine A     │  │ ORG: Mine B     │  │ ORG: Refiner D    │
   │ role: OWNER     │  │ role: MANAGER   │  │ role: BUYER       │
   │ tenant_id:mine_a│  │ tenant_id:mine_b│  │ tenant_id:refin_d │
   │ — sealed —      │  │ — sealed —      │  │ — sealed —        │
   └─────────────────┘  └─────────────────┘  └───────────────────┘
```

Edges are **roles**, typed and consented. The Person node carries only
data the human provided about themself. Each Org node carries
operational truth.

The Collaborative-Memory paper (arXiv:2505.18279) formalises this as
two **bipartite graphs** evolving over time: `G_UA(t)` (user→agent
permission) and `G_AR(t)` (agent→resource permission). Their key
contribution: every memory fragment carries provenance and is visible
**only when both the user and the agent are still in the authorised set
at retrieval time**. That solves Borjie's "what if Asha's manager role
ends?" without a re-write — the fragment simply becomes invisible.

### 3.2 Mirror namespaces

Two memory namespaces are live every turn:

```
person:{person_id}:public          ← language, name, life facts
person:{person_id}:role:{org,role} ← Asha-qua-owner-of-Mine-A view
org:{tenant_id}:role:{role}:private ← tenant secrets (existing today)
```

The brain orchestrator composes them in this order:
1. Pull tenant memory (RLS-scoped, existing path).
2. Pull person-public memory (no tenant_id, person_id only).
3. Pull person-org-role memory only for the *currently active* role.
4. Render reply with a *boundary checker* that rejects any candidate
   token if it would echo a fact whose provenance is from a different
   tenant than the active one.

This is the same retrieval-then-filter pattern Cognee uses for its
multi-tenant graph and that Pinecone's namespace-per-tenant pattern
implies; we are just adding a second axis (person) on top.

### 3.3 Privacy-respecting cross-org synthesis

Mr. Mwikila is allowed to say:
> *"Across all your three mining operations this month, you personally
> made N decisions. I can break this down in each mine's view — switch
> to Mine A to see specifics."*

He is NOT allowed to say:
> *"Mine A's gold grade is 1.4 g/t, which is higher than Mine B's 0.9
> g/t."* (when standing in Mine B's context)

The architecturally clean implementation is the **separation principle
of Chinese walls** from broker-dealer compliance: counts and
existence-claims about cross-tenant data are allowed; specific numbers,
specific entity names, specific decisions are not. Counts get
*k-anonymised* (k ≥ 3) when cross-org. (See FINRA 91-45 + Charltons
Chinese-Wall FAQ for the regulated-industry origin.)

---

## 4. Vector + graph storage — concrete schema proposal

### 4.1 What already exists in Borjie (verified)

| Table | Tenant-scoped? | Per-user? | Embedding? | File |
|-------|----------------|-----------|------------|------|
| `cognitive_memory_cells` | yes (`tenant_id` + RLS) | no | yes (1536) | `packages/database/src/schemas/cognitive-memory.schema.ts` |
| `platform_memory_cells` | **no** (cross-tenant) | no | yes | same file (§ "federated cross-tenant cells") |
| `session_memory` | yes | yes (`user_id`) | no | `packages/database/src/schemas/persistent-memory.schema.ts` |
| `skills` (procedural) | yes (`tenant_id` + `scope_id`) | no | no | same file |
| `kernel_memory_episodic` | yes | yes | no | `packages/database/src/schemas/kernel-memory-episodic.schema.ts` |
| `core_memory_blocks` (Letta-style) | yes (`tenant_id` nullable) | yes (`user_id`) | no | `packages/database/src/schemas/core-memory-blocks.schema.ts` |
| `persona_registry` | yes (`tenant_id` nullable for platform default) | no | no | `packages/database/src/schemas/persona-registry.schema.ts` |

**Observation:** `core_memory_blocks.tenant_id` is **already nullable** —
the schema author left a hook open for exactly this. `block_kind` already
has a `'human'` variant. `platform_memory_cells` already proves we have
the precedent of "no RLS, federated table" inside the brain.

### 4.2 Proposed additive layer (zero column edits)

```
                      ┌──────────────────────┐
                      │  persons             │  NEW table
                      │  id (text)           │
                      │  primary_phone_e164  │
                      │  primary_email       │
                      │  legal_name          │
                      │  national_id_hash    │  (sha256, optional)
                      │  default_language    │  ('sw' | 'en')
                      │  created_at          │
                      └──────────┬───────────┘
                                 │
                                 │
                      ┌──────────▼───────────┐
                      │  person_links        │  NEW table
                      │  person_id → persons │
                      │  user_id (supabase)  │
                      │  tenant_id           │
                      │  share_consent jsonb │  per-category opt-ins
                      │  linked_via enum     │  ('phone'|'email'|'id'|'manual')
                      │  linked_at timestamp │
                      └──────────────────────┘
                                 │
                                 │ Mr. Mwikila treats one row
                                 │ in person_links == one "hat".
                                 ▼
                      ┌──────────────────────┐
                      │ personal_memory_     │  NEW table
                      │   cells              │
                      │  person_id           │
                      │  scope text           │
                      │     ('public'|'role'│
                      │     |'role-private')│
                      │  source_tenant_id?  │  nullable; tracked only
                      │                     │  for provenance, not RLS
                      │  contributed_role   │  e.g. 'owner@mine_a'
                      │  consent_token      │  per-write opt-in proof
                      │  embedding(1536)    │
                      │  content_text       │
                      │  content_structured │
                      │  evidence_citations │
                      │  audit_hash         │
                      └─────────────────────┘
```

Notes:
- `personal_memory_cells` has **NO `tenant_id`** (mirroring
  `platform_memory_cells`). RLS becomes `person_id = current_person_id`
  via a new GUC `app.current_person_id` bound at session start by
  api-gateway middleware (same place we bind `app.current_tenant_id`).
- The Cognee precedent shows pgvector + multi-tenant is fine
  (per their lancedb case study). Pinecone's per-user namespace
  pattern is the same idea at a different layer.

### 4.3 Why a new GUC rather than a new RLS shape

We already have `cross-tenant-denials.schema.ts`. Adding another
tenant_id-style filter would cost a JOIN in every hot query and tempt
authors to "filter from app code", which is the failure mode Borjie's
hard rules forbid. A separate GUC bound at gateway level keeps the
isolation invariant *symmetric*: tenant queries cannot see person data,
person queries cannot see tenant data, both can be `UNION ALL`-ed at
the brain orchestrator with explicit boundary tagging.

---

## 5. Persona-runtime mapping

Today `packages/persona-runtime/src/types.ts` defines:
- 5 fixed power tiers (OWNER → CUSTOMER)
- 4 action stakes (LOW → SOVEREIGN)
- 5 channels (web → voice)
- a `memoryNamespaceTemplate` of form
  `tenant:{tenant_id}:persona:{persona_slug}:project:{project_id}`

**Proposed extension** (purely additive, no field mutated):

1. Add an OPTIONAL `personId?: string` to the runtime `Session` type.
2. Extend the namespace contract:
   ```
   {existing tenant namespace}      ← unchanged path
   person:{person_id}:public         ← NEW, hydrated if personId present
   person:{person_id}:role:{tenantId}:{role}
                                    ← NEW, role-private
   ```
3. The kernel's `MemoryQueryPlanner` runs both lookups and then enforces
   a **boundary tagger**: every retrieved chunk gets tagged with origin
   (`person.public` / `person.role.{tenant_id}` / `tenant.{tenant_id}`).
4. The reply composer drops any candidate sentence whose origin tag
   does not match either (a) the active tenant, or (b) `person.public`.
   Sentences whose origin is a *different* tenant's `tenant.{other}` are
   filtered out before they reach the LLM.

This matches how Letta's three-tier (core/recall/archival) memory keeps
the LLM in-context windows clean while paging external memory — we add
a "scope tag" dimension on top.

---

## 6. Identity resolution — linking Asha across tenants

### 6.1 Algorithm (probabilistic, consent-gated)

```
score = w_phone   * exactMatch(phone_e164, ±1 digit)        # ~0.7
      + w_email   * exactMatch(email_normalised)             # ~0.2
      + w_natid   * exactMatch(sha256(national_id_no_hyph))  # ~0.4 if present
      + w_name    * jaroWinkler(legal_name) > 0.92          # ~0.2
      + w_phys    * sameDeviceFingerprint                    # ~0.1 (weak)

if score >= 0.85  → strong candidate
if 0.65–0.85      → suggest; require user confirm in UI
if < 0.65         → do NOT auto-link
```

Senzing's [identity-resolution write-up](https://senzing.com/what-is-identity-resolution-defined/)
catalogues the same three families (deterministic, probabilistic,
principle-based). Borjie should use **deterministic on phone** as the
primary gate (every Borjie user signs in with E164 — see
`workforce-mobile` and `buyer-mobile` onboarding) and probabilistic
only as a fallback signal.

### 6.2 Consent flow (PDPA + GDPR)

1. On first multi-tenant detection, surface a modal:
   *"We notice you may already use Borjie at Mine A as **Asha** and now
   you're joining Mine B. Do you want one shared assistant memory across
   both? You can change this any time."* (Swahili-first.)
2. If yes → write a `person_links` row with `share_consent` JSON listing
   which categories are opted in (language, preferences, life events,
   shortcuts, none).
3. If no → keep tenants fully separated; each gets a distinct
   `person_id` with no links.
4. Store the explicit affirmative as evidence; the AI Audit chain
   already supports this via `evidence_id`.

### 6.3 Important caveats

- **Auto-linking is forbidden in the EU** by GDPR Art. 5 ("data
  minimisation" + Art. 6 lawful basis). Affirmative consent is mandatory.
- **Tanzania PDPA Part V** likewise requires consent or contractual
  necessity for cross-controller data flows. Cross-tenant link IS a
  cross-controller flow.
- Borjie must offer a one-click *un-link* that **deletes**
  `personal_memory_cells.scope='role-private'` for the unlinked role
  but keeps `scope='public'` (since that's the human's own data).

---

## 7. Brain query patterns

| Question Asha asks | How brain answers | Source layers used |
|--------------------|------------------|---------------------|
| "Habari Mr. Mwikila, ni saa ngapi?" | Greets her by name; replies in Swahili. | `person.public` only |
| "What did I commit to this morning?" (in Mine A chat) | Same-tenant query. | `tenant.mine_a` |
| "Show me all my deals this month across all my roles." | Person-cross-org count + per-tenant tabbed breakout. | `person.public` (count) + boundary-tagged per-tenant cells displayed as separate tabs |
| "How does my Mine A's profit compare to my Mine B's?" | Refuses cross-tenant numeric synthesis. Offers tabbed view: "Open Mine A view here / Mine B view here." | `person.public` (existence) only |
| "When I'm wearing my buyer hat, what's the best mine to buy from?" | Refuses to include Mine A or B as candidates because Asha owns/manages them — surfaces conflict-of-interest flag. | `person.role.refiner_d.buyer` + COI check |
| "Remind me of the time my mum was ill last August?" | Recalls from person.public. Works regardless of which mine she's in. | `person.public` |
| "Pay the crew at Mine C." | Standard tenant action. Requires four-eyes. | `tenant.mine_c` only |

The COI case (row 5) is the killer feature. Today's per-tenant Borjie
cannot even *detect* the conflict; the personal-layer architecture sees
it natively.

---

## 8. What NOT to do

1. **Do not add another `tenant_id`-style layer to existing tables.**
   That doubles RLS predicates and tanks p95.
2. **Do not allow personal memory to flow into tenant tables.** The
   `cognitive_memory_cells.tenant_id` invariant is sacred. If a personal
   fact is also useful at the tenant level (e.g. "Asha prefers
   morning shift"), it must be **re-written into the tenant table with
   tenant provenance, with explicit consent**, not aliased.
3. **Do not break the audit hash chain.** Every personal read still hits
   `@borjie/audit-hash-chain`. Use a new `audit_kind='person'` variant
   instead of bypassing.
4. **Do not show personal context in org chat without explicit user
   opt-in.** Default: opt-OUT. Asha must turn it ON.
5. **Do not store cross-org synthesis in any per-tenant table.** A
   "you outperform Mine B by 30%" claim must live in
   `personal_memory_cells` or be ephemeral.
6. **Do not infer identity links automatically across borders.** PDPA
   Part V controls cross-border; treat every Borjie tenant as a separate
   controller until manually federated.
7. **Do not weaken kill-switch fail-closed.** The kill-switch must trip
   on `personal_memory_cells` writes too — it is just another memory
   surface from the policy gate's POV.
8. **Do not let a HIGH-risk action read from `person.role.*` without the
   active tenant matching.** The policy gate's `max_action_tier` already
   handles this; do not bypass.
9. **Do not let Mr. Mwikila return any output whose embedding's nearest
   neighbour traces back to a non-active tenant.** Add an explicit
   `provenance_check` middleware between LLM output and user.
10. **Do not cache `personal_memory_cells` results in a tenant-scoped
    cache key.** Cache key must include `person_id`, never `tenant_id`
    alone.

---

## 9. References — 12+ URLs with one-line takeaways

1. [Letta (MemGPT) Memory Models — Medium](https://medium.com/@piyush.jhamb4u/stateful-ai-agents-a-deep-dive-into-letta-memgpt-memory-models-a2ffc01a7ea1) — Three-tier (core/recall/archival) is the canonical agent-memory shape; Borjie's `core_memory_blocks` already mirrors core.
2. [Mem0 — State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) — Memory is a first-class architectural component in 2026.
3. [Cognee — How Cognee Builds AI Memory](https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory) — Logical memory graph per user/group with sessionized tools; multi-tenant across pgvector/Neo4j/Kuzu/LanceDB.
4. [Cognee + LanceDB Case Study](https://www.lancedb.com/blog/case-study-cognee) — Hybrid pgvector + graph backend, proven at scale.
5. [Pinecone — Multi-Tenancy in Vector Databases](https://www.pinecone.io/learn/series/vector-databases-in-production-for-busy-engineers/vector-database-multi-tenancy/) — Namespace-per-tenant is the default; namespace-per-user is a valid alternate.
6. [Pinecone implement multitenancy](https://docs.pinecone.io/guides/get-started/implement-multitenancy) — Each index supports 10k namespaces; cold-start matters for long-tail tenants.
7. [GitHub Docs — Types of accounts](https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts) — Personal account is identity; orgs own resources; actions are always attributed to the personal account.
8. [Clerk Organizations Overview](https://clerk.com/docs/guides/organizations/overview) — Shared user pool + per-org roles + `<OrganizationSwitcher/>` is the drop-in pattern.
9. [Clerk — Multi-tenant architecture](https://clerk.com/docs/guides/how-clerk-works/multi-tenant-architecture) — User-level identity is global; org_id stored alongside each resource.
10. [WorkOS — Model your B2B SaaS with organizations](https://workos.com/blog/model-your-b2b-saas-with-organizations) — Orgs as top-level resource; OrganizationMembership join table is the canonical shape.
11. [WorkOS guide to organization modeling](https://workos.com/guide/a-guide-to-organization-modeling) — Many-to-many user↔org requires explicit memberships table; SSO complications when crossing orgs.
12. [Slack — Enterprise Organizations](https://docs.slack.dev/enterprise/) — In Enterprise Grid, one identity spans many workspaces (matches our goal more than vanilla Slack).
13. [Discord — Per-Server Profiles](https://support.discord.com/hc/en-us/articles/4409388345495-Per-Server-Profiles) — One global user_id; per-server display/profile — *identity is one, presentation is per-tenant*.
14. [Solid Project — Wikipedia](https://en.wikipedia.org/wiki/Solid_(web_decentralization_project)) — Personal pods + selective app access is the radical end-state.
15. [Tim Berners-Lee + UK Government Solid pilot — Computer Weekly](https://www.computerweekly.com/news/252506983/UK-government-turns-to-Tim-Berners-Lee-startup-for-digital-identity-plan) — Solid is moving from theory to gov-scale practice.
16. [Microsoft Recall — privacy architecture](https://support.microsoft.com/en-us/windows/privacy-and-control-over-your-recall-experience-d404f672-7647-41e5-886c-a3c59680af15) — On-device + VBS enclaves + Hello biometric gate; precedent for "personal memory must be physically isolated from external orgs".
17. [Rewind AI architecture](https://insiderbits.com/technology/rewind-ai/) — Local LanceDB + Whisper + EasyOCR + Llama 3.1 8B; precedent for personal-AI privacy guarantees.
18. [GDPR Article 20 — Right to data portability](https://gdpr-info.eu/art-20-gdpr/) — Subject has right to receive *provided* data + transmit cross-controller "where technically feasible"; explicitly excludes inferred data.
19. [Tanzania PDPA — DLA Piper overview](https://www.dlapiperdataprotection.com/?t=law&c=TZ) — PDPA in force since 1 May 2023; Part V controls cross-border + cross-controller transfers.
20. [Tanzania PDPA cross-border opinion — DataGuidance](https://www.dataguidance.com/opinion/tanzania-personal-data-protection-act-cross-border) — Consent or contract is the safe lawful basis for cross-tenant federation.
21. [FINRA 91-45 — Chinese Wall policies](https://www.finra.org/rules-guidance/notices/91-45) — Origin of the separation principle; counts ok, specifics not.
22. [Charltons SFC Chinese-Wall FAQ](https://www.charltonslaw.com/sfc-publishes-frequently-asked-questions-on-chinese-walls-requirement/) — Practical implementation in regulated multi-firm settings.
23. [Collaborative Memory — arXiv 2505.18279](https://arxiv.org/html/2505.18279v1) — Bipartite G_UA(t), G_AR(t) graphs + provenance-aware fragments; the formal model that fits Borjie perfectly.
24. [Senzing — What is Identity Resolution](https://senzing.com/what-is-identity-resolution-defined/) — Deterministic, probabilistic, principle-based — the canonical three-family taxonomy.
25. [TigerGraph — Entity Resolution](https://www.tigergraph.com/glossary/entity-resolution/) — Identity graphs in production; nodes for entities, edges for identifier-sharing.
26. [Supabase RLS — multi-tenant best practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices) — JWT `app_metadata` for tenant claims; SECURITY DEFINER for cross-tenant joins.
27. [Auth0 multi-tenant architecture pitfalls](https://community.auth0.com/t/bug-wrong-app-metadata-record-updated-in-a-multi-tenant-architecture/135126) — Real-world evidence that cramming tenants into one user record is fragile.

---

## 10. Concrete proposal for Borjie

### 10.1 Migration (purely additive)

New migration `0184_personal_kb.sql` (next slot per `packages/database/src/schemas/index.ts`):

```sql
CREATE TABLE persons (
  id              text PRIMARY KEY,           -- 'prs_<ulid>'
  primary_phone_e164 text UNIQUE NOT NULL,
  primary_email   text,
  legal_name      text NOT NULL,
  national_id_hash text,                      -- sha256, nullable
  default_language text NOT NULL DEFAULT 'sw',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_persons_phone ON persons(primary_phone_e164);

CREATE TABLE person_links (
  person_id    text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  user_id      text NOT NULL,                 -- supabase auth.users.id
  tenant_id    text NOT NULL,
  role         text NOT NULL,                 -- mirrors borjie_user_role
  share_consent jsonb NOT NULL DEFAULT '{}',  -- {language:true, prefs:true, life:false, ...}
  linked_via   text NOT NULL,                 -- 'phone'|'email'|'id'|'manual'
  linked_at    timestamptz NOT NULL DEFAULT now(),
  unlinked_at  timestamptz,
  PRIMARY KEY (user_id, tenant_id)
);
CREATE INDEX idx_person_links_person ON person_links(person_id);
CREATE INDEX idx_person_links_tenant ON person_links(tenant_id, role);

CREATE TABLE personal_memory_cells (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       text NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  scope           text NOT NULL,              -- 'public'|'role'|'role-private'
  source_tenant_id text,                      -- provenance only, not RLS
  contributed_role text,                      -- 'owner@mine_a'
  consent_token   text NOT NULL,              -- pointer to share_consent
  kind            text NOT NULL,              -- pattern|fact|rule|preference|...
  content_text    text NOT NULL,
  content_structured jsonb,
  embedding       vector(1536),
  evidence_citations jsonb NOT NULL DEFAULT '[]',
  audit_hash      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_personal_mem_person_scope ON personal_memory_cells(person_id, scope);
CREATE INDEX idx_personal_mem_embedding_hnsw
  ON personal_memory_cells
  USING hnsw (embedding vector_cosine_ops);

-- RLS: bound by app.current_person_id GUC, symmetric to tenant model.
ALTER TABLE personal_memory_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_memory_cells FORCE  ROW LEVEL SECURITY;

CREATE POLICY personal_mem_rls ON personal_memory_cells
  USING (person_id = current_setting('app.current_person_id', true));
```

### 10.2 Brain extension

Add a `PersonLayer` sibling to the existing `TenantLayer` inside
`packages/cognitive-memory/src/orchestrator.ts` (or wherever the query
planner lives — verify before editing). The brain runs both layers
in parallel, tags every result with `origin`, and lets the boundary
filter drop cross-tenant origins.

### 10.3 Persona-runtime extension

Add an optional `personId?: string` to the session type in
`packages/persona-runtime/src/types.ts`. When set, the runtime hydrates
the `person:{person_id}:public` namespace alongside the existing tenant
namespace. The runtime's existing `scope-predicate.ts` already supports
adding a new predicate kind cleanly.

### 10.4 API-gateway middleware

In `services/api-gateway/src/middleware/`:
- New `personIdMiddleware` resolves the active Supabase user → person
  (via `person_links` → `persons.id`) and binds
  `SET app.current_person_id = …` for the connection.
- Must run **after** `tenantMiddleware` and **before** any DB call.
- Failure to resolve → person layer disabled for this request (graceful
  degradation; existing per-tenant flow continues).

### 10.5 UI changes

- **Persona switcher** already exists in persona-runtime. Add an
  "All my roles" view that hits a new `GET /api/me/persons/links`
  endpoint and returns the person's roles across all tenants she has
  linked.
- **Onboarding modal** when a new user signs up at tenant N with a phone
  number that matches an existing person. Swahili-first copy.
- **Settings → Share consent** screen with per-category toggles.

### 10.6 Chat behaviour rules

1. Mr. Mwikila prefixes cross-org statements with explicit framing:
   *"Across the three businesses you're part of …"*
2. When a question is cross-tenant numeric, Mr. Mwikila refuses the
   synthesis and offers tabbed per-tenant views.
3. When a question reveals a COI (e.g., buying-from-self), Mr. Mwikila
   raises a flag and asks the user to confirm intent.
4. All cross-org synthesis is logged in `personal_memory_cells.scope='public'`
   with provenance to all contributing tenants, so the audit chain
   stays intact.

### 10.7 Hard rule additions (proposed for `CLAUDE.md`)

- **Personal-memory writes are additive.** Never mutate existing
  per-tenant cells.
- **Cross-tenant numeric synthesis is forbidden.** Only existence-claims
  and k≥3 counts may cross the boundary.
- **The person layer fails closed.** A failure to resolve `person_id`
  must NOT silently fall back to tenant-only — it must log and surface
  a degraded-mode banner so users know personal continuity is off.
- **Consent is per-category and per-direction.** Asha can opt in to
  "language preference syncs from Mine A to Mine B" but opt OUT of
  "decisions sync".

### 10.8 Files to touch (proposal — not edited here)

| File | Change |
|------|--------|
| `packages/database/src/schemas/index.ts` | export new schemas |
| `packages/database/src/schemas/persons.schema.ts` | NEW |
| `packages/database/src/schemas/person-links.schema.ts` | NEW |
| `packages/database/src/schemas/personal-memory-cells.schema.ts` | NEW |
| `packages/database/migrations/0184_personal_kb.sql` | NEW |
| `packages/persona-runtime/src/types.ts` | add `personId?: string` |
| `packages/persona-runtime/src/scope-predicate.ts` | add `person_scope` predicate kind |
| `packages/cognitive-memory/src/orchestrator.ts` | add PersonLayer; boundary tagger |
| `packages/cognitive-memory/src/query-planner.ts` | UNION ALL person + tenant |
| `services/api-gateway/src/middleware/person-id.middleware.ts` | NEW |
| `services/api-gateway/src/index.ts` | wire middleware after tenant |
| `services/api-gateway/src/routes/me/persons.hono.ts` | NEW endpoints |
| `apps/owner-web/src/components/RolesSwitcher.tsx` | NEW |
| `apps/workforce-mobile/src/screens/settings/ShareConsent.tsx` | NEW |
| `apps/buyer-mobile/src/screens/settings/ShareConsent.tsx` | NEW |
| `CLAUDE.md` | add the four new hard rules listed above |
| `Docs/MEMORY.md` | add the personal-layer invariants |

### 10.9 Roll-out strategy

1. **Wave 1 — schema + middleware (no UI).** Ship persons table empty.
   No user-visible effect.
2. **Wave 2 — opt-in onboarding modal.** Surface to *new* signups whose
   phone matches an existing person. Backfill nothing.
3. **Wave 3 — settings UI for existing users.** Manual "I have other
   accounts" link button.
4. **Wave 4 — brain layer enabled.** Boundary tagger first; full person
   memory queries second; behind a feature flag (`features.personal_kb`).
5. **Wave 5 — observability.** Add dashboards for cross-tenant denial
   rate, false-positive identity matches, consent-revocation rate.

### 10.10 Non-goals

- Not a CRM. We don't build a "people directory."
- Not federation across competitors' platforms (no SCIM/SAML to
  external orgs).
- Not Solid pods (yet). That's a 2027+ direction — see §11.
- Not GDPR Art. 20 portability of *inferred* data; we offer raw
  inputs only (which is what the law requires anyway).

---

## 11. Future arc — towards Solid-pod ownership (2027+)

If Borjie wants to lead the field by 2027, the natural next step is:

1. Move `personal_memory_cells` into a Solid pod owned by Asha,
   hosted either on Borjie infra or her chosen provider (Inrupt).
2. Borjie becomes a *requesting party* with scoped access tokens
   instead of the controller.
3. Tenants remain controllers for their operational data, but personal
   memory is genuinely Asha's.

This makes Borjie a poster-child for African data sovereignty under
PDPA and would likely be the first such implementation at a mining-OS
scale anywhere globally. It is too costly to do in 2026 (Solid tooling
is still embryonic) but the §10 design is *Solid-compatible* — the
`persons` + `personal_memory_cells` tables can become a SQL projection
of a pod's RDF graph in the future without an app rewrite.

---

## 12. Summary

The architecturally correct answer to "one person, many tenants" in
2026 is the **GitHub + Clerk + Discord triad**: one shared identity at
the top, separate per-tenant memberships in the middle, per-tenant
*presentation* at the leaves. The data plane mirrors this with three
namespaces (`person.public`, `person.role`, `tenant`) co-queried at
every turn and joined under a **boundary tagger** that filters by
origin. Borjie already has 80% of the substrate (`platform_memory_cells`
shows we know how to do federated-no-RLS; `core_memory_blocks.tenant_id`
is already nullable; the persona-runtime already does scope-predicate
filtering). The remaining 20% is the `persons` + `person_links` +
`personal_memory_cells` additive layer in §10, gated by explicit
PDPA/GDPR consent, audited by the existing hash chain, and protected by
a Chinese-wall-style boundary filter that forbids cross-tenant numeric
synthesis. This is the design.

**End of document. No code touched.**

---

## Shipping log

- **[SHIPPED 2026-05-29]** Boundary tagger (§3.3 + §5 + §10.6) — the
  Chinese-wall filter for the person-layer / tenant-layer composition.
  Pure, no DB / network / logger. Two exports:
  `filterByActiveContext()` drops chunks whose origin is a non-active
  tenant (keeping `person.public`, matching `person.role`, and
  `platform`). `checkCrossTenantNumericSynthesis()` /
  `assertNoCrossTenantNumeric()` walks every number in candidate LLM
  output and fails-closed when the number traces back to a foreign
  tenant chunk. `kAnonymisedCount()` enforces the k ≥ 3 rule for
  cross-tenant counts. See
  `packages/cognitive-memory/src/boundary-tagger.ts` and tests
  `boundary-tagger.test.ts` (20 / 20 passing). Closes G5 in
  `Docs/AUDIT/RESEARCH_GAPS_2026-05-29.md`. Wiring into the brain
  reply composer is the follow-up roadmap item.
