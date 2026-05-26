# ORG HIERARCHY + TERMINOLOGY SPEC (Wave 18X)

**Status:** authoritative spec for the largest structural addition since the manifesto.
**Companion code:** `packages/org-scope/`, migration `0026_org_scope_hierarchy.sql`.
**Cross-links:** [MASTER_BRAIN_AUTONOMY_MANIFESTO](./MASTER_BRAIN_AUTONOMY_MANIFESTO.md), [CAPABILITIES_UNIFICATION (18Q)](./CAPABILITIES_UNIFICATION.md), [UNIVERSAL_OBSERVABILITY_SPEC (18R)](./UNIVERSAL_OBSERVABILITY_SPEC.md), [MUTATION_AUTHORITY_SPEC (18S)](./MUTATION_AUTHORITY_SPEC.md), [COGNITIVE_ENGINE_SPEC (18T)](./COGNITIVE_ENGINE_SPEC.md), [DATA_ONBOARDING_SPEC (18U)](./DATA_ONBOARDING_SPEC.md), [JUNIOR_ARCHITECTURE_SPEC (18V)](./JUNIOR_ARCHITECTURE_SPEC.md), [HOME_DASHBOARD_STANDARD (18W)](./HOME_DASHBOARD_STANDARD.md).

---

## 1. Vision (founder, verbatim)

The founder articulated five interconnected requirements. They are stated here verbatim because every downstream design choice traces back to one of them.

**(1) Dynamic UI is for owner + admin portals only.** Manager / worker / buyer / customer apps just **reflect** whatever UI the owner+admin have configured. They never propose UI changes. They never run a UI evolution worker. Their floating chat, their tab list, their field labels — all of it is read-state of the owner/admin's last accepted configuration.

**(2) Custom terminology per tenant.** Every default name (department, unit, division, branch, site, parcel, worker, contract, KPI — any noun that varies by industry / region / firm culture) is RENAMEABLE. We ship industry-standard defaults; each tenant customises. Renames propagate through every UI, every doc template, every report, every chat caption.

**(3) Multi-level organisational hierarchy.** A single tenant has:
- Owner (root) — apex authority
- Admins (owner-delegated) — root-scoped, same portal as owner
- Sub-organisational units — each has its own admins, own HR, own finance, own ops
- Sub-org admins — full MD power **within their silo**
- Sub-org managers / workers / buyers — read-only consumers of their sub-org's UI

**(4) Multi-level MD.** Every sub-org has its OWN Mr. Mwikila instance — same persona, same 5 atomic capabilities (research / tab / doc / media / campaign), same cognitive engine + observability + mutation authority — but **scoped to that sub-org's data + UI + people**. The ROOT MD oversees all sub-orgs and has the holistic picture across the whole organisation.

**(5) Concrete example (Tanzania districts).** A mining company operates in 6 districts (Geita, Mererani, Kahama, Mbeya, Tunduru, Chunya). Each district is a sub-org with its own HR, finance, ops, MD instance. Owner / root admin sees all 6 districts. Each district admin sees only their own district.

These five requirements are inviolable. Every later section, every retrofit task, every migration, every UI affordance is in service of them.

---

## 2. The Org Hierarchy Model

A single tenant is the root of a **directed acyclic tree** of organisational scopes. Trees can be deep (district → site → crew → shift) or shallow (single-tenant SMB with no sub-units). The tree is bounded only by reasonable UX (we recommend depth ≤ 6).

```
Tenant (root) ─┬─ Org Unit (district / branch / division / dept — tenant-named)
               │      ├─ Sub-Unit (team / crew / ward — recursive depth)
               │      │      └─ Sub-Sub-Unit (rare, but supported)
               │      └─ another Sub-Unit
               └─ Org Unit
                      ├─ Sub-Unit
                      └─ Sub-Unit
```

Each org-unit node has:

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Stable identifier |
| `tenant_id` | text | Root tenant — every unit belongs to exactly one tenant |
| `parent_unit_id` | uuid \| null | `null` only for the tenant-root pseudo-unit |
| `default_kind` | enum | `district \| branch \| division \| department \| unit \| team \| crew \| ward` (extensible) |
| `display_name` | text | The tenant's customised name for this unit (e.g. `"Geita"`) |
| `display_kind_singular` | text | The tenant's customised name for the unit-type singular (e.g. `"district"`) |
| `display_kind_plural` | text | Same, plural (e.g. `"districts"`) |
| `materialised_path` | text | Slashed ancestry like `borjie/north-zone/geita` for fast ancestry queries |
| `depth` | int | 0 for the tenant-root pseudo-unit, 1 for top-level units, ... |
| `authority_inheritance` | boolean | Whether sub-units inherit authority bindings from parent — default `true` |

The **materialised path** is the canonical ancestry representation. Adjacency-list traversal (`WITH RECURSIVE`) is the fallback for correctness; the path string is the fast index for the common "give me this subtree" query. The path uses lowercased ASCII slugs joined by `/`; the resolver in `packages/org-scope/src/hierarchy/path-builder.ts` is the only authority that ever computes it.

The **tenant-root pseudo-unit** is an implicit node — it has no `org_units` row. It is referenced by `org_unit_id = NULL` in user-scope bindings (`scope_kind = 'tenant_root'`). The owner and root admins are always bound to the tenant-root pseudo-unit. Sub-org admins are bound to a specific row in `org_units`.

---

## 3. The User-Scope Binding

Every user is bound to one or more scopes. A binding answers: "this user, in this scope, has this role, with this authority ceiling".

```typescript
export interface UserScopeBinding {
  readonly user_id: string;
  readonly tenant_id: string;
  readonly scope_kind: 'tenant_root' | 'org_unit' | 'cross_scope';
  readonly org_unit_id: string | null;        // null when scope is tenant_root
  readonly role: 'owner' | 'admin' | 'manager' | 'employee' | 'customer' | 'auditor';
  readonly authority_tier_max: 0 | 1 | 2;     // ceiling within this scope
  readonly granted_at: string;
  readonly granted_by: string;
}
```

A user can have multiple bindings — e.g. an admin who oversees two districts has two `org_unit` bindings. A `cross_scope` binding records an explicit "this person is allowed to read across the following scopes" relationship — it does NOT grant write authority across scopes (writes are always scoped to a single binding's `org_unit_id`).

When the user is active in the system, `resolveUserScope(user_id, tenant_id, active_scope_hint?)` produces a `ResolvedScope` that names the union of their effective visibility plus the maximum authority tier they can currently exercise. The owner-web / admin-web add an explicit "switch context" UI that lets a multi-binding user pick which scope they are acting in at any given moment; the manager / worker / buyer / customer apps auto-resolve to the user's single binding.

Authority tiers map to the existing Mutation Authority spec (18S):
- **Tier 0** — read-only
- **Tier 1** — soft mutation (single signature)
- **Tier 2** — hard mutation (owner + second authoriser, see §7)

---

## 4. The Custom Terminology Layer

Every "named thing" in the system has a default name + per-tenant override.

### Default vocabulary catalogue

```typescript
export interface TerminologyDefault {
  readonly key: string;                       // 'org_unit', 'worker', 'parcel', 'site', 'shift', etc.
  readonly singular_en: string;
  readonly plural_en: string;
  readonly singular_sw: string;
  readonly plural_sw: string;
  readonly category: 'org_structure' | 'people' | 'asset' | 'process' | 'compliance' | 'commerce';
  readonly description: string;
}
```

The full catalogue lives at `packages/org-scope/src/terminology/defaults.ts`. It ships with ≥ 40 entries spanning every domain noun the platform currently exposes: org_unit, worker, manager, supervisor, parcel, site, shift, incident, contract, buyer, owner, payroll_entry, certification, licence, inspection, assay, drill_hole, fx_position, hedge, kpi, briefing, return, filing, submission, audit, report, evolution_proposal, ui_proposal, doc_proposal, campaign, deal, settlement, marketplace_listing, kyb_record, document, tab, dashboard, home, search, profile.

New defaults are added in lockstep with new features — every wave that introduces a new domain noun MUST add a row to `DEFAULT_TERMINOLOGY` in the same PR.

### Per-tenant overrides

```typescript
export interface TerminologyOverride {
  readonly tenant_id: string;
  readonly org_unit_id: string | null;       // null = applies tenant-wide; not-null = scoped to a sub-org
  readonly key: string;                       // matches a default key
  readonly singular_en: string;
  readonly plural_en: string;
  readonly singular_sw: string;
  readonly plural_sw: string;
  readonly overridden_by: string;             // user_id
  readonly overridden_at: string;
}
```

Resolution order (deterministic; cached per request):

1. Look up an override for the exact `(tenant_id, org_unit_id, key)` — if present, use it.
2. Walk up the materialised path: for each ancestor org-unit, look up an override for `(tenant_id, ancestor_unit_id, key)`. First hit wins.
3. Fall back to the tenant-wide override `(tenant_id, null, key)`.
4. Fall back to the default in `DEFAULT_TERMINOLOGY`.
5. Fall back to the default key itself (defensive; should never fire if the catalogue is complete).

### Where overrides flow

| Layer | Hook point |
|---|---|
| Dynamic UI (18B) | `TabRecipe.compose(ctx)` calls `terminology.resolve(key, scope)` before rendering every label |
| Document templates (18C) | `DocRecipe.compose(ctx)` calls the same resolver in headers, footers, table column titles |
| Research (18D/E) | The synthesiser uses the resolved term in summary copy + the daily briefing |
| Chat / MD captions | The persona-runtime wraps every system caption (`"Generated 3 parcels"` → `"Generated 3 vifurushi"`) |
| Audit-chain breadcrumbs | Every hash-chain entry records both the canonical key AND the resolved term for human-readable replay |
| Doc templates of mutations (18S) | Resolved terms appear in approval-request bodies so owners read familiar names |

Overrides at the **sub-org level** ONLY affect that sub-org and its descendants. Peer sub-orgs are NOT affected. This is the single most important consequence of §1.5: a Geita-district rename of "site" → "kambi" does not leak into Mererani.

---

## 5. Multi-Level MD Architecture

```
Root MD (Mr. Mwikila — tenant-root scope)
   │
   ├─ holistic visibility across all org_units
   │
   ├─ Org Unit A MD (Mr. Mwikila — scoped to Org Unit A)
   │      │
   │      └─ Sub-Unit MD (recursive)
   │
   ├─ Org Unit B MD (Mr. Mwikila — scoped to Org Unit B)
   │
   └─ Org Unit C MD
```

Every MD instance shares the **same persona** (name "Mr. Mwikila", mandate, conversational modes, principles). The persona row in `persona-runtime` is unchanged. The only thing that varies is the **scope context** the kernel receives on every turn.

The cognitive engine's `OrgUserDataContext` is extended:

```typescript
export interface ScopedOrgUserDataContext extends OrgUserDataContext {
  readonly scope: ResolvedScope;
}

export interface ResolvedScope {
  readonly kind: 'tenant_root' | 'org_unit' | 'multi_org_unit';
  readonly tenant_id: string;
  readonly org_unit_ids: ReadonlyArray<string>; // tenant_root = all; org_unit = [id]; multi = explicit list
  readonly authority_tier_max: 0 | 1 | 2;
  readonly visible_tables_filter: VisibilityFilter;     // applied as a WHERE clause to every data query
  readonly visible_juniors: ReadonlyArray<string>;      // which scoped junior IDs are reachable
  readonly visible_recipes: ReadonlyArray<string>;      // tab/doc/media/campaign recipes within scope
  readonly resolved_terminology: ResolvedTerminology;   // tenant + sub-org-level overrides applied
}
```

The Root MD has `org_unit_ids = [all-tenant-unit-ids]`. A sub-org MD has `org_unit_ids = [specific_id]`. A multi-org-unit binding (a regional admin overseeing two districts) has `org_unit_ids = [district_a, district_b]`.

### Cross-scope coordination

When the **owner** asks "compare Geita versus Mererani", the Root MD turn-runs once at `tenant_root` scope and reads both sub-org sub-trees. The two sub-org MDs are not consulted (no agent-to-agent message-passing here — that's a different wave). The synthesis is **one MD, holistic data view**.

Sub-org MDs cannot read across — the Geita MD that tries to fetch Mererani data hits a `VisibilityFilter` block before the query reaches Postgres, and Postgres RLS is the second line of defence.

### Budget meters per scope

Each scope has its **own budget meter**. The Geita MD's daily research budget is its own; it does NOT draw from the tenant-root MD's budget. Owner-set caps in the admin console specify both a tenant-root cap AND per-org-unit caps. Mutation Authority's existing budget envelopes (tenant-budget-envelopes table) is extended with an optional `org_unit_id` column in a follow-up wave.

---

## 6. Manager / Worker / Buyer / Customer App Reflection

These four apps DO NOT have UI evolution power. They are pure consumers of the owner+admin's configured UI, filtered by:

1. **Tenant + org-unit scope** — only tab recipes where `audience_includes ⊇ {role}` AND the recipe is published within a scope the user can see.
2. **Field labels** — every label runs through the terminology resolver with the user's `ResolvedScope`.
3. **Permitted actions** — per role + authority tier; actions that would mutate state outside `authority_tier_max` are hidden in the UI and refused by the API.

Floating chat in these apps:
- Routes to the **scope-appropriate junior** (see Wave 18V).
- The junior's `ResolvedScope` matches the user's binding — a worker in Geita talking to their floating chat cannot ask "show me Mererani's parcels".
- The junior's caption — every line of conversation — uses the resolved terminology.

Owner / admin portals retain full UI evolution power (Wave 17B + 18F). The floating chat in owner-web is the **Root MD** (or whichever scope the owner has switched into via the context switcher).

---

## 7. Authority Inheritance + Delegation

- **Owner** has Tier 2 in tenant-root scope by birthright.
- **Owner** can grant **admins** Tier 2 in tenant-root (delegated). Audit-chain records the grant.
- **Owner / root admin** can grant **sub-org admins** Tier 2 in a specific `org_unit_id` scope. Recursive: a sub-org admin with `authority_inheritance = true` propagates Tier 2 into descendant sub-units unless the descendant has an explicit override.
- **Sub-org admin** CANNOT grant authority outside their scope. They can grant Tier 1 within their org_unit to managers/employees.
- **Tier 2-Critical mutations** within a sub-org may require:
  1. Sub-org admin (primary signer)
  2. Owner OR root admin (second authoriser)

This is configurable per-tenant in `second_authoriser_assignments` (Wave 18S table — extended in a follow-up wave with `org_unit_id` + `requires_root_co_signature boolean`). The Mutation Authority engine looks up the assignment by `(tenant_id, mutation_kind, org_unit_id)` with progressive fallback to `(tenant_id, mutation_kind, null)`.

---

## 8. Visibility Rules Table

The seven canonical roles + their visibility/write rules:

| Role               | Scope                            | Can see                                                | Can write                                  |
|--------------------|----------------------------------|--------------------------------------------------------|---------------------------------------------|
| owner              | tenant_root                      | everything across all org_units                        | Tier 2 anywhere                            |
| root admin         | tenant_root                      | everything (delegated by owner)                        | Tier 2 anywhere                            |
| sub-org admin      | org_unit_id (+ descendants)      | own org_unit + child sub-units                         | Tier 2 within own org_unit                 |
| manager            | org_unit_id                      | own org_unit's operational data                        | Tier 1 within scope                        |
| employee/worker    | org_unit_id                      | own assignments + relevant scoped data                 | Tier 0 read; Tier 1 self-actions           |
| customer/buyer     | tenant_root (marketplace only)   | public marketplace + own deals                         | Tier 1 on own deals                        |
| auditor (external) | tenant_root or org_unit_id       | read-only access for the period of the audit window    | Tier 0 read                                |

Every API endpoint MUST resolve the active user's scope and apply the corresponding `VisibilityFilter` to its query. The middleware in `services/api-gateway/src/middleware/tenant-context.middleware.ts` is extended (follow-up wave) to also set a Postgres GUC `app.org_unit_id` so RLS policies can reference it.

---

## 9. Schema Additions

Three net-new tables. RLS policies use the canonical `current_setting('app.tenant_id', true)` pattern from migration 0003.

```sql
-- Org hierarchy: recursive tree per tenant
CREATE TABLE org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_unit_id uuid REFERENCES org_units(id) ON DELETE CASCADE,
  default_kind text NOT NULL,                  -- district|branch|division|department|unit|team|crew|ward
  display_name text NOT NULL,
  display_kind_singular text NOT NULL,
  display_kind_plural text NOT NULL,
  materialised_path text NOT NULL,             -- e.g. 'borjie/north-zone/geita'
  depth int NOT NULL DEFAULT 0,
  authority_inheritance boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_units_default_kind_chk CHECK (
    default_kind IN ('district','branch','division','department','unit','team','crew','ward','company','region','zone','subsidiary')
  ),
  CONSTRAINT org_units_depth_nonneg_chk CHECK (depth >= 0)
);

CREATE INDEX org_units_tenant_idx ON org_units(tenant_id);
CREATE INDEX org_units_tenant_path_idx ON org_units(tenant_id, materialised_path);
CREATE INDEX org_units_parent_idx ON org_units(parent_unit_id);

ALTER TABLE org_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org_units;
CREATE POLICY tenant_isolation ON org_units
  USING (tenant_id = current_setting('app.tenant_id', true));

-- User-scope bindings (many-to-many user × scope)
CREATE TABLE user_scope_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope_kind text NOT NULL,                    -- tenant_root|org_unit|cross_scope
  org_unit_id uuid REFERENCES org_units(id) ON DELETE CASCADE,
  role text NOT NULL,                          -- owner|admin|manager|employee|customer|auditor
  authority_tier_max smallint NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by text NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT usb_scope_kind_chk CHECK (scope_kind IN ('tenant_root','org_unit','cross_scope')),
  CONSTRAINT usb_tier_range_chk CHECK (authority_tier_max BETWEEN 0 AND 2),
  CONSTRAINT usb_role_chk CHECK (role IN ('owner','admin','manager','employee','customer','auditor'))
);

CREATE INDEX usb_user_tenant_idx ON user_scope_bindings(user_id, tenant_id);
CREATE INDEX usb_scope_idx ON user_scope_bindings(tenant_id, org_unit_id);
CREATE INDEX usb_active_idx ON user_scope_bindings(tenant_id, user_id) WHERE revoked_at IS NULL;

ALTER TABLE user_scope_bindings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_scope_bindings;
CREATE POLICY tenant_isolation ON user_scope_bindings
  USING (tenant_id = current_setting('app.tenant_id', true));

-- Terminology overrides
CREATE TABLE terminology_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_unit_id uuid REFERENCES org_units(id) ON DELETE CASCADE,  -- null = tenant-wide
  key text NOT NULL,
  singular_en text NOT NULL,
  plural_en text NOT NULL,
  singular_sw text,
  plural_sw text,
  overridden_by text NOT NULL,
  overridden_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX terminology_overrides_unique_idx
  ON terminology_overrides(tenant_id, COALESCE(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
CREATE INDEX terminology_overrides_tenant_key_idx
  ON terminology_overrides(tenant_id, key);

ALTER TABLE terminology_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON terminology_overrides;
CREATE POLICY tenant_isolation ON terminology_overrides
  USING (tenant_id = current_setting('app.tenant_id', true));
```

A follow-up wave will add `org_unit_id text` (defaultable to the tenant-root sentinel) to every operational table (workers, parcels, sites, shifts, assays, etc.) and backfill it from existing site/branch hints. That column-addition wave is OUT OF SCOPE for the current spec.

---

## 10. Retrofit Map for Sibling Packages

The following 14 in-flight packages will need scope-awareness retrofitted in follow-up waves. This wave does NOT modify any of them; sibling agents own each retrofit.

| Sibling package                       | What scope-awareness adds                                                                  | Effort |
|---------------------------------------|--------------------------------------------------------------------------------------------|--------|
| `@borjie/dynamic-ui`                  | `TabRecipe.compose` ctx → `ResolvedScope`; terminology resolver wraps every UI label       | M      |
| `@borjie/document-templates`          | `DocRecipe.compose` ctx → `ResolvedScope`; terminology resolver in headers/footers         | M      |
| `@borjie/media-generation`            | `MediaRecipe.compose` ctx → scoped brand-spec + scoped subject filter                      | S      |
| `@borjie/marketing-studio`            | `CampaignRecipe` → `audience_segments × scope`; can't run campaigns outside scope          | M      |
| `@borjie/research-tools`              | Source whitelisting can include scope-specific sources                                     | S      |
| `@borjie/research-orchestrator`       | Daily-briefing scoped per org_unit (owner gets cross-scope synthesis)                      | M      |
| `@borjie/ui-evolution-worker`         | Lock/improve per org_unit (sub-org admin sees their own evolutions only)                   | S      |
| `@borjie/doc-evolution-worker`        | Same as UI                                                                                 | S      |
| `@borjie/cognitive-engine`            | `ScopedOrgUserDataContext` propagation through every kernel turn                           | M      |
| `@borjie/session-mirror`              | UI state mirror filtered by scope                                                          | S      |
| `@borjie/mutation-authority`          | Authority tier checked against `UserScopeBinding` for the active scope                     | M      |
| `@borjie/data-onboarding`             | Onboard data into the right org_unit; data inherits `org_unit_id`                          | M      |
| `@borjie/agent-platform`              | Junior persona registry: per-scope junior instances                                        | M      |
| `@borjie/chat-ui` / `home-shell`      | HomeShell resolves persona by user's active scope                                          | S      |

Each retrofit lands as its own wave with its own migration tickets, test plan, and rollout. No package retrofit forces a global flag-day cutover — `@borjie/org-scope` ships with a `ResolvedScope.legacyMode` flag that means "no org units configured" so tenants without sub-orgs continue to work unchanged.

---

## 11. Anti-Patterns (must never happen)

1. A sub-org admin can see data from a peer sub-org without an explicit `cross_scope` binding.
2. The owner CANNOT see across sub-orgs (must always have holistic visibility) — if observed, scope resolution is broken.
3. A worker can mutate UI configuration — the UI evolution worker accepts a write from a non-admin scope.
4. A terminology override applied to one sub-org leaks to a peer sub-org.
5. Cross-tenant data leakage — root cause: a query missing `tenant_id` filter, RLS GUC unset, or a stale connection re-used across tenants.
6. A sub-org MD spends budget exceeding its scope quota — each scope has its own meter; a leak means the budget envelope check is missing `org_unit_id`.
7. The tenant-root pseudo-unit is materialised as an `org_units` row (it must remain implicit; the `NULL` parent is the canonical encoding).
8. A binding revocation does not propagate to active sessions — the auth middleware must consult `revoked_at` on every request, not just at login.

---

## 12. Phase 2 Implementation Map

1. **This wave (18X)** — spec doc + `packages/org-scope/` + migration `0026_org_scope_hierarchy.sql`. NO sibling package modifications.
2. **Per-sibling retrofit waves** — one wave per affected package (≈ 14 waves). Most can run in parallel because they share only this package as a dependency.
3. **Backfill migration** — adds `org_unit_id` columns to operational tables; defaults existing rows to the tenant-root sentinel. Future inserts must include an explicit `org_unit_id`. This is a single large migration because the trade-off of one big window outweighs 14 incremental migrations.
4. **UI work in owner-web + admin-web** — new screens for managing the org hierarchy, terminology overrides, and the multi-binding "switch context" picker. Lands AFTER C4-finisher.
5. **Manager / worker / buyer / customer apps** — read-state plumbing: terminology resolver in their label-render pipeline; tab visibility filter; floating chat scope resolver. One wave per app.

---

## 13. Open Questions / Decisions Deferred to Founder

1. **Default depth cap.** UX recommends ≤ 6. The schema supports unbounded. Should we enforce a soft cap at depth 8 with a config override?
2. **Whether `cross_scope` bindings should support write authority** in a future revision (currently read-only). Some founder use-cases ("Regional MD with write access in 2 districts") might want this.
3. **Whether the tenant-root pseudo-unit should be materialised** for query simplicity, with a `is_root boolean` flag to keep it implicit-from-the-app-side. Trades off schema cleanliness for query ergonomics.
4. **Terminology key namespacing.** Should we prefix keys per category (e.g. `org.unit`, `people.worker`) to avoid collisions between, say, `marketing.campaign` and `comms.campaign`? Current spec assumes flat keys; the catalogue is small enough.
5. **Multi-language support beyond en/sw.** Should the override row carry an arbitrary JSON `{lang_code: {singular, plural}}` rather than two hard-coded language pairs? Pilot is TZ (en/sw); expansion countries will need DRC (fr), KE (en/sw), etc.

These five questions are tracked in the founder backlog and do not block the current wave from shipping.

---

*End of ORG_HIERARCHY_TERMINOLOGY_SPEC.md.*

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
