# Customer Geo Routing + Scope Login + Live-Test Discipline (Wave 18Z)

> **Status.** Specification + scaffold. Hot-path integration is staged behind
> sibling Wave 18Y (`packages/org-scope/`) and Wave 18V
> (`packages/agent-platform/junior-contract.ts`). This document is the
> contract every follow-up wave will wire against.
>
> **Three founder concerns codified.**
>
> 1. **No recorded stuff, no more mock data — we are going live.** Section A.
> 2. **Customers are MD-class within their own jurisdiction, routed to the
>    nearest district / office / station that can assist them.** Section B.
> 3. **Once a district exists, admins must pick their scope at login: general
>    admin, or a specific district.** Section C.

---

## Part A — Live-Test Discipline

### A.1 The discipline

Reads directly from the Master Brain manifesto: *"I cite or I stay silent."*
The natural extension for the rest of the system is — **every flow Mr.
Mwikila runs must touch real data, real LLMs, and real research APIs.** No
prerecorded outputs. No synthesized fixtures masquerading as real. No
in-memory stubs in runtime code. If the data does not exist yet, the system
asks for it, ingests it, or refuses; it does not invent.

This is not an aesthetic preference. The product is positioned as a 24/7
managing director that an owner trusts with mutation authority over the
business. A managing director that makes up data is worse than one that
admits uncertainty. The live-test discipline is the lint-time, build-time,
and CI-time enforcement of that promise.

### A.2 What's allowed

- **Unit-test fixtures in `__tests__/` directories.** These are explicit,
  scoped to tests, and never imported by runtime code. The
  test/runtime separation is the load-bearing distinction.
- **Storybook / component-test fixtures in `*.stories.*` files.** Stories
  are documentation surfaces — they may render with sample data so a
  designer can review the component shape. Stories are not shipped in the
  production bundle.
- **Type-only stubs in `*.test.ts` / `*.spec.ts` files.** Mocking external
  APIs in vitest is normal; the rule short-circuits on these paths.
- **Real seed data in Supabase that represents real-shaped records.** Seeds
  that exercise a tenant in staging are fine — they are real rows under
  real RLS, just bound to a non-production tenant.
- **Cached LLM responses that hash-verify the prompt.** Caching by prompt
  hash is honest replay (we have the receipt). What is forbidden is
  re-emitting a response divorced from its provenance.

### A.3 What's forbidden

- **`MOCK_*`, `FAKE_*`, `STUB_*`, `FIXTURE_*` named exports in `src/`**
  (outside `__tests__`). Hardcoded sample arrays returned by service
  methods in production code count.
- **`if (process.env.NODE_ENV === 'development') return mockResponse`
  style fallbacks** in runtime code. If a service has nothing to return,
  it returns nothing — it does not synthesize.
- **Imports of `*-mock.ts`, `*-mocks.ts`, `*-stub.ts`, `*-recorded.ts`,
  `*-fixture.ts` from non-test code.** These file-name conventions
  declare intent; the rule keys off the convention.
- **Pre-recorded LLM responses played back as if real.** A recorded
  response that does not hash-verify the prompt is fabricated output.
- **`recordedResponses`, `mockData`, `fakeRows`, `stubData` object
  literals in runtime code.** These names are reserved for tests.

### A.4 Enforcement mechanism

Three layers stack:

1. **ESLint rule `borjie/no-mock-data-in-runtime`** — scans `src/` files
   (skipping `__tests__/`, `*.test.*`, `*.stories.*`, `*.spec.*`,
   `e2e/`) for the forbidden patterns. Reports each violation with file
   path, line, the pattern that fired, and a suggested remediation.
2. **CI workflow `.github/workflows/live-test-discipline.yml`** — runs
   the rule as a fail-build step on every PR and on every push to
   `main`. A second step uses `grep` to catch import sites that the
   parser cannot reach (e.g. dynamic import strings).
3. **Audit script** — a follow-up `scripts/audit-mock-data.mjs` (Wave
   18Z-cleanup) enumerates every existing violation so we have a closed
   worklist before flipping the rule from `warn` to `error` repo-wide.

The existing brand-DNA rules (`borjie/no-non-token-style`,
`borjie/no-non-token-in-doc-template`) and the jurisdictional-literal
rule (`borjie/no-jurisdictional-literal`) already enforce other
"real-production" disciplines. This rule is the third leg of the
tripod: real-data discipline alongside real-brand and real-region.

### A.5 Known violations as of this wave

Quick `grep` audit finds these runtime mock-data sites:

- `apps/workforce-mobile/src/location/fence.ts:16` — `MOCK_SITES`
  exported from non-test code. Used by the geofence detector. **Wave
  18Z-cleanup item.** Replace with a real district/station feed from
  `packages/customer-geo-routing/`.
- `services/api-gateway/src/middleware/database.ts` — `USE_MOCK_DATA`
  env-gated mock-mode that still runs in non-production. The
  `EXPLICIT_MOCK_MODE` guard correctly refuses production but the
  gating mechanism contradicts the discipline. **Wave 18Z-cleanup
  item.** Replace with a `DATABASE_URL`-required failure mode (refuse
  to boot).
- `services/api-gateway/src/config/validate-env.ts` — declares the
  schema for the `USE_MOCK_DATA` env var. Removed when the gateway
  mock-mode is removed.
- BossNyumba: `apps/customer-app/src/lib/payments-data.ts` exports a
  `MOCK_PAYMENTS` array. **BN Wave 18Z-cleanup item.** Replace with a
  Supabase fetch.
- BossNyumba: `packages/market-intelligence/src/adapters/airbnb.ts`
  exports an `AIRBNB_MOCK_HEADER` constant — this is the name of an
  HTTP header used to flag a test request to the upstream Airbnb mock,
  not actual mock data. Keep, but the rule should not flag a `MOCK_`
  identifier that is a public string constant naming an HTTP header.
  Refined pattern: the rule flags `MOCK_/FAKE_/STUB_` only when the
  exported value is an array, object, or function — not when it is a
  plain string constant.

The rule's exact rejection set is tuned to surface the first three and
the BossNyumba payments hit, and to ignore the Airbnb header constant.

---

## Part B — Customer Geographic Routing

### B.1 The routing problem

A Borjie tenant — say, a mining company headquartered in Dar es Salaam
with regional offices in Arusha, Geita, and Mwanza — has multiple
`org_units` (districts, in the default terminology). Each district
serves a geographic territory. A customer (mineral buyer) signs up
from somewhere in Tanzania. Today the customer's floating chat would
land on Mr. Mwikila (tenant_root) regardless of where the customer
lives. That is wrong: a buyer in Dar es Salaam should be talking to
the Dar es Salaam office's MD instance and that office's juniors. A
buyer in Arusha should be talking to Arusha's. The customer is
"MD-class within their own jurisdiction" — the jurisdiction is the
district that serves them.

### B.2 The routing model

Each `org_unit` has a `service_area` describing the territory it
serves. Four shapes are supported, in increasing order of precision:

- **Administrative codes** — e.g. `TZ-DSM` (Dar es Salaam Region),
  `TZ-AR` (Arusha Region). Loosest; matches if the customer's declared
  region is in the list.
- **Postal codes** — e.g. `11101`, `11102`, ...; matches if the
  customer's postal code is in the list.
- **Station + radius** — a single point (the office) plus a radius in
  kilometres. Matches by haversine distance.
- **Polygon (GeoJSON)** — an arbitrary polygon. Matches by
  point-in-polygon.

A district may carry more than one of these — e.g. a polygon for the
strict territory + a fallback list of administrative codes for
customers whose coords are imprecise.

Each `service_area` also carries a `priority` integer used as a
tiebreaker when two districts both match.

### B.3 The customer's location

A customer's `customer_location` is a current snapshot. It records:

- The **source** — `gps` (most precise), `postal_code`,
  `self_declared`, or `admin_override`.
- **Coordinates** if known.
- **Postal code** if known.
- **Administrative code** if known.
- **City** as the loosest fallback.

The customer's location is stored versioned (the audit chain keeps
history). A customer that moves can re-route by updating their
location; the previous assignment is superseded.

### B.4 The resolver

On customer signup, or whenever the customer-app boots a session, the
routing engine runs `resolveCustomerDistrict`:

1. Read `customer_location` from the customer profile.
2. Pull all `org_unit_service_areas` for the tenant.
3. **Filter** to areas whose `service_area` *includes* the customer's
   location. Inclusion is the union of all four shapes — the customer
   matches an area if any of its declared shapes matches.
4. **Score** each match by distance, with priority as a tiebreaker
   when distances are equal or one of the candidates has no measurable
   distance (e.g. a postal-code-only area).
5. **Pick** the closest. Return a `CustomerDistrictAssignment` with
   the reasoning (`"closest district: Geita @ 12.3km"`) and an
   audit-chained hash.
6. If no area matches, return `assigned_org_unit_id = null` with
   `assignment_kind = 'manual_unassigned'` — the customer falls back
   to the tenant_root MD (Mr. Mwikila personally) and a notification
   fires to the owner: "Customer X is outside all district service
   areas — please assign manually."

### B.5 Overrides

Two override paths exist:

- **Customer override.** The customer says "I prefer to deal with
  Arusha office." A sticky preference is written; auto-routing is
  suppressed until the customer clears it.
- **Admin / owner override.** A high-value buyer is reassigned to a
  flagship district. The override carries an
  `assignment_kind = 'admin_override'` and an actor stamp. The owner
  can see every active override in the owner-portal.

Every override is appended to the audit chain alongside the auto-route
trail.

### B.6 The contract

```typescript
export interface CustomerLocation {
  readonly customer_id: string;
  readonly tenant_id: string;
  readonly source: 'gps' | 'postal_code' | 'self_declared' | 'admin_override';
  readonly coordinates?: { lat: number; lng: number };
  readonly postal_code?: string;
  readonly administrative_code?: string;   // e.g. TZ-DSM
  readonly city?: string;
  readonly recorded_at: string;
}

export type ServiceAreaKind =
  | 'polygon'
  | 'postal_codes'
  | 'station_radius'
  | 'administrative_codes';

export interface OrgUnitServiceArea {
  readonly org_unit_id: string;
  readonly tenant_id: string;
  readonly area_kind: ServiceAreaKind;
  readonly polygon?: GeoJsonPolygon;
  readonly postal_codes?: ReadonlyArray<string>;
  readonly station_coords?: { lat: number; lng: number };
  readonly station_radius_km?: number;
  readonly administrative_codes?: ReadonlyArray<string>;
  readonly priority: number;
}

export type AssignmentKind =
  | 'auto_geo'
  | 'customer_override'
  | 'admin_override'
  | 'manual_unassigned';

export interface CustomerDistrictAssignment {
  readonly customer_id: string;
  readonly tenant_id: string;
  readonly assigned_org_unit_id: string | null;  // null = tenant_root fallback
  readonly assignment_kind: AssignmentKind;
  readonly distance_km?: number;
  readonly reasoning: string;
  readonly assigned_at: string;
  readonly audit_hash: string;
}

export function resolveCustomerDistrict(
  customer: CustomerLocation,
  candidate_org_units: ReadonlyArray<OrgUnitServiceArea>,
): CustomerDistrictAssignment;
```

The implementation lives in
`packages/customer-geo-routing/src/routing/district-resolver.ts`.

### B.7 Anti-patterns

- Auto-route a customer to a district whose `service_area` *does not*
  include them ("nearest district" without inclusion check is wrong:
  the Mwanza office should not see Kenyan buyers).
- Override auto-routing silently — every reassignment writes an audit
  chain entry.
- Cache the assignment client-side beyond the session — moves and
  admin overrides must take effect on the next boot.

---

## Part C — Login-Time Scope Selection

### C.1 The login problem

A user holds one or more `user_scope_bindings` from the org-scope
package (Wave 18Y). A typical tenant-root admin holds only the
tenant-root binding. A district admin holds only that district. But
many real users hold *multiple* bindings:

- A regional director holds the tenant-root binding **and** every
  district's admin binding.
- A roving manager rotates across districts and accumulates several
  district bindings over time.

Today, with no scope selector, such a user is silently dropped into
the highest-tier scope they hold. That is opaque — they don't see
which scope they are operating in and may take an action in the wrong
context. The fix is to make the scope explicit at login.

### C.2 The login flow

```
After auth succeeds (JWT issued):
   │
   ▼
Look up user_scope_bindings (revoked rows excluded)
   │
   ▼
If 1 binding remains:    auto-select; proceed to home
If >1 binding remains:   present scope picker (always — never skip)
   │
   ▼
User picks: "General (all districts)" OR "Geita District" OR ...
   │
   ▼
Selected scope written to session as `active_scope_id`
   │
   ▼
Proceed to home with ResolvedScope already set on the request context
```

The picker is mandatory whenever the user holds more than one
binding. Skipping it would re-introduce the silent-default problem.

### C.3 The picker UX

For each binding, show:

- Scope display name — `"General (all districts)"` for tenant_root,
  the org_unit display name for any other scope.
- The user's **role** at that scope.
- The user's **authority tier max** at that scope.
- The **last-used** timestamp (so the picker is naturally sorted by
  recency).

Two preferences:

- **"Remember my choice for this session"** — default off. When on,
  the picker is skipped on subsequent boots within the same browser
  session.
- **"Set this as my default"** — recorded to `user_home_preferences`
  (Wave 18W); the picker pre-selects this scope and the user can
  proceed with one click.

### C.4 Mid-session scope switching

A scope switcher lives in the app chrome (top-right, next to the
persona header in HomeShell). It is always visible to users who hold
more than one binding. Clicking it:

- Drops a dropdown listing every active binding the user holds.
- Selecting a different scope writes the new `active_scope_id` into
  the session.
- Audit-chains the switch (`"user switched from district-A to
  district-B at 14:32:07Z"`).
- Hard-refreshes the in-process context (Mr. Mwikila scope, the
  visible junior set, the data filters). Open tabs receive a broadcast
  and re-resolve their context.
- In-flight requests are *not* cancelled — they are tagged with the
  *old* scope id so the audit trail reflects which scope each request
  ran under. New requests pick up the new scope.

### C.5 The session-scope record

A `session_scopes` row backs every authenticated session and is
read on every request:

```
{
  session_id,
  tenant_id,
  user_id,
  active_scope_id,                // null = tenant_root
  role_at_active_scope,
  authority_tier_max,
  switched_from_scope_id,         // populated on each switch
  switched_at,
  audit_hash,
  established_at,
  expires_at
}
```

The companion JWT/cookie carries the same fields, signed. The server
validates `active_scope_id` against `user_scope_bindings` on every
request — a binding revoked since session establishment immediately
fails the request and forces a re-pick.

### C.6 Anti-patterns

- Skip the scope picker for users with multiple bindings — would
  silently apply a default.
- Default the picker to the lowest-tier scope — must be the
  most-recently-used scope, with the highest-tier as a tiebreaker.
- Allow a scope switch to a scope the user no longer holds — revoked
  bindings caught.
- Leak data from scope A to scope B during a mid-session switch — the
  in-memory context (visible juniors, data filters, scoped Mr.
  Mwikila) must be hard-cleared on switch.
- Persist `active_scope_id` only in the JWT without the
  `session_scopes` row — a revoked binding mid-session would not be
  caught until token refresh.

---

## Part D — Schema

```sql
-- Customer geo location (current snapshot — history in audit chain)
CREATE TABLE customer_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL,
  tenant_id text NOT NULL,
  source text NOT NULL,                          -- gps|postal_code|self_declared|admin_override
  coordinates_lat numeric(9,6),
  coordinates_lng numeric(9,6),
  postal_code text,
  administrative_code text,
  city text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  audit_hash text NOT NULL
);
CREATE INDEX idx_cust_loc_tenant ON customer_locations(tenant_id);

-- Org unit service area
CREATE TABLE org_unit_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id uuid NOT NULL,
  tenant_id text NOT NULL,
  area_kind text NOT NULL,                       -- polygon|postal_codes|station_radius|administrative_codes
  polygon_geojson jsonb,
  postal_codes text[],
  station_lat numeric(9,6),
  station_lng numeric(9,6),
  station_radius_km numeric(8,2),
  administrative_codes text[],
  priority int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_osa_tenant ON org_unit_service_areas(tenant_id);

-- Customer district assignment (current)
CREATE TABLE customer_district_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL,
  tenant_id text NOT NULL,
  assigned_org_unit_id uuid,
  assignment_kind text NOT NULL,                 -- auto_geo|customer_override|admin_override|manual_unassigned
  distance_km numeric(8,2),
  reasoning text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  audit_hash text NOT NULL
);
CREATE INDEX idx_cda_active ON customer_district_assignments(tenant_id, customer_id) WHERE active = true;

-- Active session scope (per-session JWT/cookie companion)
CREATE TABLE session_scopes (
  session_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  active_scope_id uuid,                          -- null = tenant_root
  role_at_active_scope text NOT NULL,
  authority_tier_max smallint NOT NULL,
  switched_from_scope_id uuid,
  switched_at timestamptz,
  audit_hash text NOT NULL,
  established_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_sess_user ON session_scopes(tenant_id, user_id, expires_at DESC);

ALTER TABLE customer_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_locations
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE org_unit_service_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON org_unit_service_areas
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE customer_district_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_district_assignments
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE session_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON session_scopes
  USING (tenant_id = current_setting('app.tenant_id', true));
```

---

## Part E — Implementation Plan

### E.1 This wave (Wave 18Z spec + scaffold)

- Spec doc (this file) — ported to BossNyumba.
- `packages/customer-geo-routing/` — types, haversine, polygon
  containment, district resolver, session-scope builder, audit chain
  glue. Tests; typecheck clean; >= 70% coverage.
- ESLint rule `borjie/no-mock-data-in-runtime` + RuleTester unit
  tests. Wired into `eslint.config.mjs` as `warn` (will flip to
  `error` after Wave 18Z-cleanup).
- CI workflow `.github/workflows/live-test-discipline.yml`.
- Migration `0026_geo_routing_session_scopes.sql` + Drizzle schema +
  barrel export.

### E.2 Wave 18Z-impl (after C4 + 18V + 18Y land)

- Wire `resolveCustomerDistrict` into customer signup flow
  (`apps/buyer-mobile` for Borjie, `apps/customer-app` for BossNyumba).
- Wire the `ScopePicker` component into `apps/owner-web` and
  `apps/admin-web` login flow.
- Wire the scope-switcher into HomeShell chrome (right of the persona
  header).
- Backfill `customer_locations` from existing customer profiles where
  possible (city + administrative code at minimum).
- Run the live-test ESLint rule across the entire repo; fix the
  hits enumerated in §A.5.

### E.3 Wave 18Z-cleanup

- Remove `MOCK_SITES` from `apps/workforce-mobile/src/location/fence.ts`;
  replace with a real district feed.
- Remove `USE_MOCK_DATA` env mode from
  `services/api-gateway/src/middleware/database.ts`; refuse to boot
  without a `DATABASE_URL`.
- Remove the BossNyumba `MOCK_PAYMENTS` array; wire to Supabase.
- Flip `borjie/no-mock-data-in-runtime` from `warn` to `error`
  monorepo-wide.

---

## Open Questions

1. **Distance metric preference.** When the customer has both
   coordinates and a postal code, do we prefer haversine on coordinates
   or a postal-code lookup? Current resolver prefers coordinates.
   Confirm.
2. **Admin override expiry.** Does an admin override expire (e.g. 90
   days) or stay sticky until the admin clears it? Current spec: sticky
   until cleared. Confirm.
3. **Polygon caching.** Districts with large polygons (entire mining
   regions) — should we precompute a bounding box for fast rejection?
   Implementation detail; can defer.
4. **Cross-tenant geographic overlap.** If two tenants both serve Dar
   es Salaam, do they ever cross-pollinate customers? Answer: no —
   `customer_locations` and `org_unit_service_areas` are
   tenant-scoped, RLS-isolated. Just noting this is by design.
