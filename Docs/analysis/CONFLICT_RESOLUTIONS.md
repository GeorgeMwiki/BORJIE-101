# CONFLICT_RESOLUTIONS.md — Amplification Specs

**Date:** 2026-04-18
**Project:** BORJIE101
**Source of truth:** `Docs/analysis/GAP_voice_vs_docs.md` — "Conflicts Requiring Founder Decision" (lines 738–773).
**Non-negotiable rule:** Amplify existing code. Never delete core logic without a replacement. Every field-level change is additive; deprecation happens via renamed accessors, never by dropping types.

---

## Executive Summary

Three founder-decision conflicts are resolved below. In each case the voice memo wins on direction, but the existing code is preserved and extended. The reconciliation tactic is consistent across all three:

1. **Conflict 1 — Admin L1-L4 hierarchy:** Treat the voice memo's hierarchy as an *authority-level attribute* layered on top of the existing 8 RBAC system roles (`packages/authz-policy/src/system-roles.ts`) and the 10 AI personas (`packages/ai-copilot/src/personas/personas.catalog.ts`). RBAC answers "what can this person do?". Authority-level answers "how far up the chain are they?". Personas answer "which AI hat do they wear?". Three orthogonal axes. No role is removed.
2. **Conflict 2 — Universal tenant app:** Introduce `TenantIdentity` (global, cross-org) as a new sibling of `User`. `OrgMembership` becomes the per-org join record with a special-code join flow. The existing `User` entity in `packages/domain-models/src/identity/user.ts` stays intact — it continues to represent the per-tenant principal for RBAC. The customer-app `AuthContext` is extended with an `activeOrgId` switch. Enterprise data isolation is preserved by continuing to scope all queries by `organizationId`; the tenant identity layer only federates *login*, not *data*.
3. **Conflict 3 — Elastic geo-hierarchy:** Add a new `GeoNode` tree entity and a per-org `GeoLabelType` enum. The existing `Address` struct in `packages/domain-models/src/property/property.ts` (lines 32–40) is kept as a street-level anchor. The existing `RegionConfig` in `packages/domain-models/src/common/region-config.ts` remains the country/currency/compliance registry — it is *not* a location hierarchy and must not be repurposed as one. Properties gain an optional `geoNodeId` alongside `address`.

---

## Conflict 1 — Admin L1-L4 Hierarchy

### 1.1 What the voice memo demands

From `Docs/analysis/GAP_voice_vs_docs.md`, lines 25–26 and 742–748:

> "Owner > Super Admin (≤2 per org) > Admin L1-L4 > Estate Manager > Station Master (tagged worker) > Other Workers (tagged)"
>
> "Admin (levels 1–4) — decreasing power/control top-down. No hard cap yet."

Founder intent:
- A single, ordered **chain of authority** from Owner to tagged worker.
- Super Admin capped at ≤2 per org (soft cap, not hard).
- Admin split into 4 levels of *decreasing power*, top-down.
- Station Master and Other Workers are worker-tag-driven, not separate roles.

### 1.2 What exists today

**`packages/authz-policy/src/system-roles.ts` (lines 13–26)** defines 8 flat roles:

```ts
SUPER_ADMIN, PLATFORM_SUPPORT,             // platform-level
TENANT_ADMIN, PROPERTY_MANAGER, OWNER,
ESTATE_MANAGER, ACCOUNTANT, CUSTOMER, VIEWER  // tenant-level
```

Each role has a `Policy` (lines 65–230) with resource-level permissions. `RolePolicyMap` (lines 252–262) binds role id → policy.

**`packages/domain-models/src/identity/user.ts` (lines 110–118)** models multi-org role assignment:

```ts
interface UserRoleAssignment {
  roleId: RoleId;
  organizationId: OrganizationId;
  assignedAt: ISOTimestamp;
  assignedBy: UserId;
  expiresAt: ISOTimestamp | null;
}
```

**`packages/ai-copilot/src/personas/personas.catalog.ts` (lines 377–388)** exports 10 personas: Estate Manager, 5 Juniors (Leasing, Maintenance, Finance, Compliance, Communications), Coworker, Migration Wizard, Tenant Assistant, Owner Advisor.

**Key observation:** The RBAC roles, the Persona catalog, and the voice-memo hierarchy are describing *three orthogonal things*:

| Axis | What it answers | Where it lives |
|---|---|---|
| RBAC role | "Which resources/actions is this person permitted to touch?" | `system-roles.ts` |
| Authority level | "How high up the chain of command is this person?" (approval routing, escalation, override authority) | **NEW** |
| Persona | "When the user talks to the AI, which specialist hat does the AI put on?" | `personas.catalog.ts` |

The voice memo's "Admin L1-L4" is an **authority-level** concept. It is NOT a replacement for RBAC roles and NOT a replacement for personas.

### 1.3 Reconciled design

Introduce an `AuthorityLevel` layer that every `UserRoleAssignment` carries. This preserves all 8 RBAC roles and all 10 personas untouched, and adds a sortable numeric tier that powers approval routing, escalation, and the "decreasing power top-down" semantics from the memo.

**New enum — `AuthorityLevel`** (new file `packages/domain-models/src/identity/authority-level.ts`):

```ts
export const AuthorityLevel = {
  OWNER:         { tier: 0,  maxPerOrg: null, canDeleteOrg: true  },
  SUPER_ADMIN:   { tier: 1,  maxPerOrg: 2,    canDeleteOrg: false }, // soft cap, configurable per org
  ADMIN_L1:      { tier: 10, maxPerOrg: null, canDeleteOrg: false },
  ADMIN_L2:      { tier: 20, maxPerOrg: null, canDeleteOrg: false },
  ADMIN_L3:      { tier: 30, maxPerOrg: null, canDeleteOrg: false },
  ADMIN_L4:      { tier: 40, maxPerOrg: null, canDeleteOrg: false },
  ESTATE_MANAGER:{ tier: 50, maxPerOrg: null, canDeleteOrg: false },
  STATION_MASTER:{ tier: 60, maxPerOrg: null, canDeleteOrg: false },
  WORKER:        { tier: 70, maxPerOrg: null, canDeleteOrg: false },
} as const;

export type AuthorityLevelId = keyof typeof AuthorityLevel;
```

Lower `tier` = higher authority. The non-contiguous spacing (0, 1, 10, 20…) leaves room for in-between tiers without renumbering.

**Amplify `UserRoleAssignment`** (extend — do not break — `packages/domain-models/src/identity/user.ts`, around lines 110–118):

```ts
interface UserRoleAssignment {
  roleId: RoleId;                     // existing, unchanged — RBAC policy key
  organizationId: OrganizationId;     // existing, unchanged
  assignedAt: ISOTimestamp;           // existing, unchanged
  assignedBy: UserId;                 // existing, unchanged
  expiresAt: ISOTimestamp | null;     // existing, unchanged

  // NEW — additive, optional for backwards compatibility
  authorityLevel?: AuthorityLevelId;  // null/undefined on legacy rows -> defaulted in migration
  workerTags?: readonly WorkerTag[];  // tags that route workflows to this user
}

interface WorkerTag {
  readonly key: string;    // e.g. "station-master", "surveyor", "plumber"
  readonly label: string;  // human-readable
  readonly teamScope: 'org' | 'geo-node' | 'property';
  readonly teamScopeId?: string;
}
```

**Mapping between RBAC role and default AuthorityLevel** (new constant inside `authority-level.ts`):

```ts
export const DEFAULT_AUTHORITY_FOR_ROLE: Record<SystemRole, AuthorityLevelId> = {
  [SystemRoles.SUPER_ADMIN]:       'SUPER_ADMIN',
  [SystemRoles.PLATFORM_SUPPORT]:  'ADMIN_L4',
  [SystemRoles.TENANT_ADMIN]:      'ADMIN_L1',
  [SystemRoles.PROPERTY_MANAGER]:  'ADMIN_L3',
  [SystemRoles.OWNER]:             'OWNER',
  [SystemRoles.ESTATE_MANAGER]:    'ESTATE_MANAGER',
  [SystemRoles.ACCOUNTANT]:        'ADMIN_L3',
  [SystemRoles.CUSTOMER]:          'WORKER',
  [SystemRoles.VIEWER]:            'WORKER',
};
```

**Persona binding:** The Persona catalog (`personas.catalog.ts`) stays as-is. The orchestrator's `bindPersona` (`persona.ts` lines 153–172) is extended to accept `authorityLevel` so the system prompt can say "you are acting for an ADMIN_L2 — escalate to Super Admin on HIGH risk". No persona template needs rewriting.

**Approval routing upgrade:**

```ts
function canApprove(user: UserWithRoles, orgId: OrgId, requiredTier: number): boolean {
  const assignment = user.roleAssignments.find(a => a.organizationId === orgId);
  const level = AuthorityLevel[assignment?.authorityLevel ?? DEFAULT_AUTHORITY_FOR_ROLE[assignment?.roleId]];
  return level.tier <= requiredTier;
}
```

**Super Admin cap (≤2 per org, configurable):** enforced at `UserRoleAssignment` write time by a new guard. Guard reads `org.settings.superAdminCap` (default 2) and rejects if count would exceed. Owners can raise the cap.

### 1.4 Migration path

- `authorityLevel` is optional on `UserRoleAssignment`. Existing rows continue to work.
- One-time backfill migration populates `authorityLevel = DEFAULT_AUTHORITY_FOR_ROLE[roleId]`.
- `workerTags` defaults to `[]`. No existing code reads it.
- `RolePolicyMap` and `SystemPolicies` in `system-roles.ts` stay byte-identical.
- `Persona` catalog stays byte-identical.
- JWT claims get an additive `authority_level` field; absence on a legacy token is treated as "derive from role".

### 1.5 File-level TODOs

| File | Change | Nature |
|---|---|---|
| `packages/domain-models/src/identity/authority-level.ts` | **CREATE.** Export `AuthorityLevel` map, `AuthorityLevelId` type, `DEFAULT_AUTHORITY_FOR_ROLE`, `compareAuthority(a, b)` helper, `WorkerTag` interface. | New |
| `packages/domain-models/src/identity/index.ts` | Re-export from `authority-level.ts`. | Additive |
| `packages/domain-models/src/identity/user.ts` (lines 110–118) | Add optional `authorityLevel?` and `workerTags?` to `UserRoleAssignment`. | Additive |
| `packages/authz-policy/src/system-roles.ts` | Keep untouched. | No change |
| `packages/authz-policy/src/jwt.service.ts` | Add optional `authority_level` claim. | Additive |
| `packages/authz-policy/src/abac.engine.ts` | New rule: `attribute.subject.authorityLevel.tier` can be referenced by ABAC policies. | Additive |
| `packages/ai-copilot/src/personas/persona.ts` (lines 139–148) | Add optional `authorityLevel?` to `PersonaBinding`. | Additive |
| `packages/ai-copilot/src/personas/persona.ts` (lines 153–172) | `bindPersona` accepts `authorityLevel`; propagates into system-prompt context. | Additive |
| `services/identity/.../migrations/NNNN-backfill-authority-level.sql` | **CREATE.** Backfill script. | New |
| `services/approval/.../routing.ts` | Read `authorityLevel.tier` when deciding the next approver. | Additive |

### 1.6 Acceptance criteria

1. Tenant admin can assign any existing RBAC role AND an orthogonal AuthorityLevel via admin UI.
2. A pre-migration user with role `PROPERTY_MANAGER` and no explicit `authorityLevel` is treated as `ADMIN_L3`.
3. Attempting a 3rd `SUPER_ADMIN` when `superAdminCap = 2` returns `SUPER_ADMIN_CAP_EXCEEDED`. Owner can raise cap.
4. `TenantAdminPolicy`, `PropertyManagerPolicy`, etc. still compile with identical output.
5. A `WorkerTag` with key `"station-master"`, `authorityLevel = STATION_MASTER`, `teamScope = 'geo-node'` is discoverable by workflow router when an app is filed within that geo-node.
6. Only `authorityLevel = OWNER` can call `org.delete()`. Super admins rejected with `INSUFFICIENT_AUTHORITY`.
7. All 10 personas load unchanged. `bindPersona` with no `authorityLevel` falls back to template default.

---

## Conflict 2 — Universal Tenant App

### 2.1 What the voice memo demands

From `GAP_voice_vs_docs.md` lines 199–217 and 754–760:

> "Tenant app is universal, not org-siloed. One download, access many organizations. Tenant can hold simultaneous tenancies across multiple orgs. To join the research client's portfolio, tenant receives/enters a special code from the estate."

Founder intent:
- One **app download**, one **tenant identity**, **many organizations**.
- Joining an org uses a **special code** (invite / redemption token) issued by that org.
- Org data isolation is NOT weakened — a tenant in both the demo-org and ACME must not see ACME data while scoped to the demo-org.

### 2.2 What exists today

**`packages/domain-models/src/identity/user.ts`** supports multi-org role assignment (line 142: `roleAssignments[]`, each with `organizationId`). However `User` extends `TenantScoped` — one `User` row per platform tenant. Two different landlords = two different rows.

**`apps/customer-app/src/contexts/AuthContext.tsx` (lines 1–60)** models a single `CustomerUser` with no `activeOrgId`. Phone normalization at line 57 hardcodes `"254"` (Kenya) — must become RegionConfig-driven.

### 2.3 Reconciled design

Split "customer" into two layers:

- **`TenantIdentity`** — global, cross-org identity keyed by phone + (optionally) email. Mobile app authenticates against this. NOT scoped to any landlord tenant.
- **`OrgMembership`** — per-org join record linking `TenantIdentity` to an organization via a redeemed special code. Role, lease, data scoping live here.

Existing `User` entity stays untouched. Continues to model landlord-staff users within a single tenant.

**New entities** (new file `packages/domain-models/src/identity/tenant-identity.ts`):

```ts
export type TenantIdentityId = Brand<string, 'TenantIdentityId'>;
export type OrgMembershipId = Brand<string, 'OrgMembershipId'>;
export type InviteCode = Brand<string, 'InviteCode'>;

/**
 * Cross-org identity. One per real human, regardless of landlord count.
 * Lives in a root identity service — NOT scoped to any BORJIE platform tenant.
 */
export interface TenantIdentity {
  readonly id: TenantIdentityId;
  readonly phoneNormalized: string;       // ITU-T E.164
  readonly phoneCountryCode: string;      // ISO3166-1 alpha-2
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly profile: UserProfile;
  readonly createdAt: ISOTimestamp;
  readonly lastActivityAt: ISOTimestamp | null;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
}

export interface OrgMembership {
  readonly id: OrgMembershipId;
  readonly tenantIdentityId: TenantIdentityId;
  readonly organizationId: OrganizationId;
  readonly platformTenantId: TenantId;
  readonly userId: UserId;                       // bridging row in per-tenant User table
  readonly joinedAt: ISOTimestamp;
  readonly joinedViaInviteCode: InviteCode | null;
  readonly status: 'ACTIVE' | 'LEFT' | 'BLOCKED';
  readonly nickname: string | null;
}

export interface InviteCodeRecord {
  readonly code: InviteCode;
  readonly organizationId: OrganizationId;
  readonly platformTenantId: TenantId;
  readonly issuedBy: UserId;
  readonly issuedAt: ISOTimestamp;
  readonly expiresAt: ISOTimestamp | null;
  readonly maxRedemptions: number | null;
  readonly redemptionsUsed: number;
  readonly defaultRoleId: RoleId;
  readonly attachmentHints?: {
    propertyId?: PropertyId;
    unitId?: UnitId;
  };
}
```

**Relationship to existing `User`** — for every `OrgMembership`, a shadow `User` row is created in the platform-tenant's user table. This preserves RBAC, auditing, session management, and multi-org `roleAssignments`. Data isolation remains unchanged — all queries still filter by `organizationId` through the same RBAC pipeline.

**App login flow:**

1. User installs app once. `AuthContext` authenticates against Identity service, receives `tenantIdentityId` + session JWT whose claims include `memberships: [{ orgMembershipId, organizationId, platformTenantId, userId, roleId }]`.
2. First launch shows list of memberships. Fresh install is empty; UI prompts "Enter invite code" or "Request access".
3. Tapping a membership (or redeeming a code) sets `activeOrgId`. All subsequent API calls carry `X-Org-Context: <organizationId>` and per-org scoped token.
4. Switching orgs re-requests scoped token. Invalidates cached org-data. API gateway enforces isolation.

**Special-code redemption:** Org admin generates `InviteCodeRecord` with optional `attachmentHints` (pre-bind to unit). Tenant enters code → API creates `OrgMembership` + shadow `User` + (optionally) attaches as pending lease applicant.

### 2.4 Migration path

- `User` table untouched. Existing customer rows become `OrgMembership` + synthesized `TenantIdentity` via backfill grouped by `phoneNormalized`.
- Rows across tenants sharing a phone merge into single `TenantIdentity` but `User` rows remain as separate `OrgMembership`s.
- `CustomerPolicy` continues governing in-org permissions.
- `AuthContext.tsx` keeps `CustomerUser` type but extends it. Existing screens default to first membership.
- Phone-normalization hard-code (AuthContext.tsx line 57) fixed by `normalizePhoneForCountry` from `region-config.ts` line 314.

### 2.5 File-level TODOs

| File | Change | Nature |
|---|---|---|
| `packages/domain-models/src/identity/tenant-identity.ts` | **CREATE.** `TenantIdentity`, `OrgMembership`, `InviteCodeRecord`. | New |
| `packages/domain-models/src/identity/index.ts` | Re-export. | Additive |
| `packages/domain-models/src/identity/user.ts` | Optionally add `originOrgMembershipId?: OrgMembershipId`. | Optional additive |
| `services/identity/src/tenant-identity.service.ts` | **CREATE.** Global TenantIdentity + phone OTP via `region-config.ts`. | New |
| `services/identity/src/invite-code.service.ts` | **CREATE.** Generates + redeems codes. TTL, max-redemptions, atomic redeem. | New |
| `services/identity/src/org-membership.service.ts` | **CREATE.** Bridges TenantIdentity ↔ User ↔ Org. Creates shadow User rows. | New |
| `apps/customer-app/src/contexts/AuthContext.tsx` (lines 5–27) | Amplify `CustomerUser` with `tenantIdentityId`, `memberships[]`, `activeOrgId`, `setActiveOrg()`, `redeemInviteCode(code)`. | Additive |
| `apps/customer-app/src/contexts/AuthContext.tsx` (line 57) | Replace hardcoded `"254"` with `normalizePhoneForCountry`. | Bug fix + amplify |
| `apps/customer-app/src/components/OrgSwitcher.tsx` | **CREATE.** Header dropdown with memberships + "Add organization". | New |
| `apps/customer-app/src/pages/onboarding/redeem-code.tsx` | **CREATE.** Code entry screen. | New |
| `packages/authz-policy/src/jwt.service.ts` | Add `memberships[]` and `active_org_id` claims. | Additive |
| `apps/customer-app/src/lib/api-client.ts` | Auto-inject `X-Org-Context: <activeOrgId>` on every request. | Additive |
| API gateway middleware | Reject data requests where `X-Org-Context` not in JWT `memberships[]`. | Enforcement |

### 2.6 Acceptance criteria

1. Single app install with phone `+255712345678` shows both the demo-org + ACME memberships, switches without re-login.
2. When scoped to the demo-org, `GET /units` returns ONLY demo-org units. Injecting unauthorized `X-Org-Context` returns `403 ORG_CONTEXT_NOT_IN_SESSION`.
3. Entering `ACME-A3F9` creates `OrgMembership` + shadow `User` + increments `redemptionsUsed`. Expired code returns `INVITE_CODE_EXPIRED`.
4. Pre-migration `CustomerUser` logs in with same phone and is seamlessly migrated to `TenantIdentity` + one `OrgMembership`. Lease/payments/history preserved.
5. `CustomerPolicy` grants same permissions to shadow user — no RBAC regression.
6. `normalizePhoneForCountry("0712345678", "TZ")` returns `"255712345678"`.
7. "Leave organization" flips `OrgMembership.status = LEFT`, deactivates (not deletes) shadow User. Re-redeem creates fresh membership.

---

## Conflict 3 — Elastic Geo-Hierarchy

### 3.1 What the voice memo demands

From `GAP_voice_vs_docs.md` lines 76–78, 131–139 and 764–773:

> "Elastic geo-hierarchy (CRITICAL) — Do NOT force a fixed region → district → village structure. the research client's convention: Districts contain Regions (counter-intuitive to global convention)."
>
> "Geofencing via Google Maps API — each node colored/outlined on map."
>
> "Street-level pin for each asset; interactive map view of all assets and all hierarchy levels."

Founder intent:
- Each org defines its **own label vocabulary** and **own nesting direction** (e.g. a public-sector estate client: Districts > Regions).
- Arbitrary depth (N-level nesting).
- Each node has a **polygon** on Google Maps; nodes are colored/outlined.
- Each asset has a street-level pin, optionally belongs to deepest leaf node.
- Assignments (e.g., Station Master responsible for all assets under Node X) work at any level.

### 3.2 What exists today

**`packages/domain-models/src/common/region-config.ts`** — despite the name, NOT a location hierarchy. Country/currency/compliance/mobile-money registry keyed by ISO3166-1 alpha-2. Must stay as-is in this role. Answers "what currency does TZ use?", not "what hierarchy does the client use?".

**`packages/domain-models/src/property/property.ts` (lines 32–40)** has fixed `Address`:

```ts
interface Address {
  street: string;
  city: string;
  county: string;           // hard-coded level
  postalCode: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
}
```

No support for org-defined hierarchy or N-deep nesting.

### 3.3 Reconciled design

Add a new bounded context for geography: per-org tree of `GeoNode`s with configurable labels and Google-Maps-friendly polygon storage. Existing `Address` stays as street-level anchor (directions, postal mail, fallback). New `Property.geoNodeId` references deepest geo-node.

`RegionConfig` stays sovereign over currency/tax/compliance — explicitly NOT the location hierarchy.

**New entities** (new file `packages/domain-models/src/geo/geo-node.ts`):

```ts
export type GeoNodeId = Brand<string, 'GeoNodeId'>;
export type GeoLabelTypeId = Brand<string, 'GeoLabelTypeId'>;

/**
 * Per-org classification of hierarchy levels.
 * Public-sector estate: [District, Region, Ward, Street]
 * Kenyan org: [County, Sub-county, Ward, Estate]
 * Levels are ordinal; depth is N, not fixed.
 */
export interface GeoLabelType {
  readonly id: GeoLabelTypeId;
  readonly organizationId: OrganizationId;
  readonly depth: number;                    // 0 = root children
  readonly singular: string;                 // "District"
  readonly plural: string;                   // "Districts"
  readonly color: string | null;
  readonly allowsPolygon: boolean;
}

/**
 * Tree node. parent/child = N-deep hierarchy. Parent null = root.
 */
export interface GeoNode {
  readonly id: GeoNodeId;
  readonly organizationId: OrganizationId;
  readonly parentId: GeoNodeId | null;
  readonly labelTypeId: GeoLabelTypeId;
  readonly name: string;
  readonly code: string | null;
  readonly polygon: GeoPolygon | null;       // GeoJSON
  readonly centroid: { lat: number; lng: number } | null;
  readonly colorOverride: string | null;
  readonly orderIndex: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export interface GeoPolygon {
  readonly type: 'Polygon' | 'MultiPolygon';
  readonly coordinates: readonly (readonly (readonly [number, number])[])[]
                      | readonly (readonly (readonly (readonly [number, number])[])[])[];
}

/**
 * Closure table — O(1) ancestor/descendant lookups.
 */
export interface GeoNodeClosure {
  readonly ancestorId: GeoNodeId;
  readonly descendantId: GeoNodeId;
  readonly depth: number;
}
```

**Amplify `Property`** (extend — do not break — `packages/domain-models/src/property/property.ts` lines 45–63):

```ts
interface Property extends EntityMetadata, SoftDeletable {
  // ALL existing fields preserved...
  readonly address: Address;               // keep — street-level + postal
  readonly geoNodeId?: GeoNodeId;          // NEW — deepest geo-node
  readonly pin?: { lat: number; lng: number };  // NEW — canonical street-level pin
}
```

**Inversion support (the research client's Districts > Regions):** nothing special needed — `GeoLabelType.depth` is ordinal, not semantic. the demo-org configures depth=0 → "District", depth=1 → "Region". Kenyan org configures depth=0 → "County", depth=1 → "Sub-county". No hardcoded "Region > District" anywhere.

**Google Maps integration:**
- `polygon` stored as GeoJSON (Maps-compatible). Render via `google.maps.Data`.
- Colors: `node.colorOverride ?? labelType.color ?? '#cccccc'`.
- Point-in-polygon via PostGIS `ST_Contains` when property pin set.
- Map UI has layer toggle per depth.

**Workforce assignment:**

```ts
export interface GeoAssignment {
  readonly id: Brand<string, 'GeoAssignmentId'>;
  readonly organizationId: OrganizationId;
  readonly geoNodeId: GeoNodeId;
  readonly userId?: UserId;
  readonly workerTagKey?: string;
  readonly responsibility: 'station_master' | 'surveyor' | 'manager' | 'worker';
  readonly inherits: boolean;   // cascades to descendants
}
```

### 3.4 Migration path

- `Address` untouched. Existing rows untouched.
- `geoNodeId` optional. Existing properties have `undefined` until admin classifies.
- demo-org one-time seed: create District/Region/Ward `GeoLabelType`s, import polygons from Tanzania open-data, auto-assign properties via `ST_Contains`.
- Unclassified properties stay with `geoNodeId = null`. Admin UI surfaces as "unclassified".
- `RegionConfig` continues as country/currency registry. Document (in geo-node.ts header AND region-config.ts header):

> "RegionConfig is country/currency/compliance only. It is NOT the location hierarchy. For hierarchy, see `packages/domain-models/src/geo/geo-node.ts`."

Existing reports joining on `address.county` continue working. New reports join `geoNodeId` via closure table.

### 3.5 File-level TODOs

| File | Change | Nature |
|---|---|---|
| `packages/domain-models/src/geo/geo-node.ts` | **CREATE.** `GeoLabelType`, `GeoNode`, `GeoPolygon`, `GeoNodeClosure`, `GeoAssignment`, helpers. | New |
| `packages/domain-models/src/geo/index.ts` | **CREATE.** Barrel. | New |
| `packages/domain-models/src/index.ts` | Export `./geo`. | Additive |
| `packages/domain-models/src/property/property.ts` (lines 45–63) | Add optional `geoNodeId?` and `pin?`. Keep `address` intact. | Additive |
| `packages/domain-models/src/common/region-config.ts` (header) | Clarifying comment: "NOT the location hierarchy." | Docs |
| `services/geo/src/geo-node.repository.ts` | **CREATE.** CRUD + closure-table + PostGIS ops. | New |
| `services/geo/src/geo-node.service.ts` | **CREATE.** `classifyProperty`, `pointInPolygon`, `getAssetsUnder`, `getAncestors`, `moveSubtree`. | New |
| `services/geo/migrations/NNNN-create-geo-tables.sql` | **CREATE.** Tables w/ PostGIS `geometry` + indexes. | New |
| `apps/admin-app/src/pages/settings/geo-hierarchy.tsx` | **CREATE.** UI for defining `GeoLabelType`s. | New |
| `apps/admin-app/src/pages/map/portfolio-map.tsx` | **CREATE.** Google Maps view with polygon layers, pins, drawing tools. | New |
| `apps/admin-app/src/components/geo-node-picker.tsx` | **CREATE.** Cascading dropdown (reads label depths dynamically). | New |
| `services/geo/src/geo-assignment.service.ts` | **CREATE.** Binds users/tags to nodes. Respects `inherits`. | New |
| `services/workflow/.../routing.ts` | Extend: `geo.findNearestStationMaster(propertyId)`. | Additive |

### 3.6 Acceptance criteria

1. demo-org admin creates label types [District (0), Region (1), Ward (2)]. Kenyan org in separate org creates [County (0), Sub-county (1), Ward (2)]. Coexist, no leak.
2. `GeoNode` "Kinondoni District" has 3 child "Regions" in the research client's tree; the word "region" never confused across orgs.
3. Property at `(-6.77, 39.26)` auto-classifies into deepest matching polygon via `ST_Contains` on save.
4. Moving "Region X" from District A to District B atomically updates `geo_node_closure`; `getDescendants(District A)` excludes moved subtree.
5. `GeoAssignment` with `inherits=true` at District level: `geo.findAssignees(propertyUnderDistrict, 'station_master')` returns assigned user/tag. With `inherits=false`, only direct children match.
6. `Address.county` still populates/displays; no report breaks. New reports filter by `geoNodeId`.
7. `RegionConfig` still authoritative for `currencyCode`, `vatRate`, `defaultTimezone`. Zero references from geo-hierarchy code path.
8. Portfolio map shows colored polygons per depth with layer toggles and street-level property pins.
9. Data isolation: research-client-scoped user cannot see Kenyan org's `GeoNode` records — all queries `WHERE organization_id = :ctx`.

---

## Cross-Cutting Amplification Principles

1. **Every new field is optional first.** Tighten to non-null only after backfill completes.
2. **Keep domain-model files as pure types.** Services enforce invariants.
3. **Each new concept gets its own subfolder** under `packages/domain-models/src/`.
4. **Document orthogonality at the top of each new file.** geo-node.ts says "NOT the country registry — see region-config.ts". authority-level.ts says "NOT an RBAC role — see system-roles.ts".
5. **Existing tests must continue to pass without changes.** All amplifications additive.
6. **New functionality gated behind feature flags per org** until rolled out.

---

## Delivery Sequencing Recommendation

| Wave | Work | Why first |
|---|---|---|
| Wave 1 | Conflict 1 — AuthorityLevel | Zero-risk, pure additive type. Unblocks approval-routing work. |
| Wave 2 | Conflict 3 — GeoNode | Depends on nothing else. Unblocks the research client's District-first hierarchy driving Station-Master routing. |
| Wave 3 | Conflict 2 — Universal tenant app | Largest surface change. Benefits from AuthorityLevel being in place. |

---

### Critical Files for Implementation

- `packages/authz-policy/src/system-roles.ts`
- `packages/domain-models/src/identity/user.ts`
- `packages/domain-models/src/property/property.ts`
- `packages/domain-models/src/common/region-config.ts`
- `apps/customer-app/src/contexts/AuthContext.tsx`
- `packages/ai-copilot/src/personas/personas.catalog.ts`
