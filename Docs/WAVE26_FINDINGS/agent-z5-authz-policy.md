# Wave 26 Agent Z5 — authz-policy: Wire or Remove?

## Investigation: what authz-policy actually is

`packages/authz-policy/` (v0.1.0) is a substantial, working library — **not a stub**:

- `src/rbac.engine.ts` (274 LoC): full `RbacEngine` with role inheritance,
  permission matching, wildcard `manage`/`*` actions, and condition evaluation
  (`ownLease`, `ownPayments`, `sameProperty`, `sameTenant`). Ships 6 default
  roles (super-admin, property-owner, property-manager, caretaker, tenant,
  accountant).
- `src/abac.engine.ts` (426 LoC): XACML-style `AbacEngine` with 15 operators
  (`equals`, `contains`, `in`, `startsWith`, `matches`, etc.), priority-based
  rule combining (`denyOverrides` / `allowOverrides` / `firstApplicable`),
  target matching, environment attributes (time-based rules).
- `src/policy-engine.ts` (302 LoC): alternate `PolicyEngine` with caching
  (60s TTL) and tenant isolation hard-check.
- `src/middleware.ts` + `src/middleware/authorization-middleware.ts`:
  framework-agnostic `authorize()` factory, `requireRoles()`, `enforceTenantIsolation()`,
  `assertAuthorized()` guard.
- `src/engine/tenant-isolation.ts` (with tests): AsyncLocalStorage-based
  tenant context guard — 30 passing tests total across the package.
- `src/jwt.service.ts`: HS256/RS256 JWT sign/verify with refresh-token rotation.
- `src/system-roles.ts`, `src/decorators.ts`, `src/domain-models.d.ts`.

The `dist/` is built and current; `pnpm typecheck` passes clean.

Wave 25 Agent T was correct that zero runtime `from '@borjie/authz-policy'`
imports existed anywhere in the repo before this wave, despite the package
being listed as a workspace dep in 4 consumers (api-gateway, domain-services,
customer-app, estate-manager-app). The gateway had built its own parallel
RBAC+ABAC engine in `services/api-gateway/src/middleware/authorization.ts`
(~880 LoC with approval thresholds + time rules — a superset), and the two
Next.js apps never needed authz client-side.

## Decision: WIRE (partial adoption) + prune stale deps

Per the task's default stance — "if the package has a real design and some
non-trivial code, ADOPT it rather than delete" — the package is demonstrably
non-trivial (1000+ LoC of live code with 30 passing tests). Deleting it
would throw away a working RBAC+ABAC implementation that the product will
need for row-level rules (ownership of leases, property-scoped manager
access, tenant-owned invoices) as the customer-app matures.

However, the apps and domain-services declared it without actually using it
— pure stale scaffolding. Those deps are removed.

**Plan:**
1. Create a thin `requireCapability(action, resource)` Hono middleware in
   the gateway that delegates to `RbacEngine` from `@borjie/authz-policy`.
2. Map the gateway's ALL_CAPS `UserRole` enum to the kebab-case roles
   shipped in the package's default matrix.
3. Layer `requireCapability` on top of existing `requireRole` on 5 real
   production endpoints (leases POST/DELETE, properties POST/DELETE,
   invoices POST). `requireRole` stays as the coarse first gate.
4. Remove the dep from the 3 workspaces that never imported it.

## Execution

### Files created

- `services/api-gateway/src/middleware/capability-gate.ts` (115 LoC)
  — `requireCapability(action, resource)` middleware + `hasCapability()`
  programmatic check + `capabilityEngine` singleton export. `@ts-nocheck`
  applied to match the Hono v4 workaround used in `hono-auth.ts` and
  `authorization.ts` (hono-dev/hono#3891 — status-code literal union widening).
- `services/api-gateway/src/middleware/__tests__/capability-gate.test.ts`
  (5 tests — allow TENANT_ADMIN creates lease, deny RESIDENT creates property,
  401 on missing auth, `hasCapability` true for PM/invoice, false for
  MAINTENANCE_STAFF/lease).

### Endpoints retrofitted (5 production code paths)

All keep `staffOnly` as the coarse gate and add `requireCapability` as the
fine-grained gate:

| File | Endpoint | Capability |
|---|---|---|
| `services/api-gateway/src/routes/leases.ts` | `POST /` | `create`/`lease` |
| `services/api-gateway/src/routes/leases.ts` | `DELETE /:id` | `delete`/`lease` |
| `services/api-gateway/src/routes/properties.ts` | `POST /` | `create`/`property` |
| `services/api-gateway/src/routes/properties.ts` | `DELETE /:id` | `delete`/`property` |
| `services/api-gateway/src/routes/invoices.ts` | `POST /` | `create`/`invoice` |

### Deps removed (stale scaffolding)

| Workspace | Change |
|---|---|
| `apps/customer-app/package.json` | drop `@borjie/authz-policy` |
| `apps/customer-app/next.config.js` | remove from `transpilePackages` |
| `apps/estate-manager-app/package.json` | drop `@borjie/authz-policy` |
| `apps/estate-manager-app/next.config.js` | remove from `transpilePackages` + `optimizePackageImports` |
| `services/domain-services/package.json` | drop `@borjie/authz-policy` |

Net: 4 declared deps → 1 (api-gateway, now actually used).

## Verification

### Typecheck

```
pnpm --filter @borjie/authz-policy typecheck
→ clean

pnpm --filter @borjie/api-gateway typecheck
→ 0 errors in files I touched.
  14 pre-existing errors in service-registry.ts / move-out-repository.ts /
  cases-sla-supervisor.ts / intelligence-history-wiring.ts — all domain-services
  dist drift unrelated to authz-policy. Confirmed by grepping for
  "authz-policy|capability-gate" in the error output: zero matches.
```

### Tests

```
pnpm --filter @borjie/authz-policy test
→ 2 files, 30 tests passed (permission-resolver, tenant-isolation)

pnpm --filter @borjie/api-gateway test
→ 26 files, 178 tests passed
  - New capability-gate.test.ts: 5/5 green (105ms)
  - Existing role-gate.test.ts: 8/8 still green (5.16s)
  - No regressions anywhere
```

### Install

```
pnpm install → Done in 22.1s. Only pre-existing opentelemetry peer-dep
warnings unrelated to this work. Lockfile updated cleanly.
```

## Stop condition check

- [x] `@borjie/authz-policy` is imported and used in at least 3 real
      production code paths → **5 endpoints** (leases POST/DELETE, properties
      POST/DELETE, invoices POST) + the `capability-gate.ts` middleware
      module itself.
- [x] Typecheck green for authz-policy and for files I touched in api-gateway.
- [x] Tests green (178 gateway tests + 30 authz-policy tests).

## Notes for future waves

- The gateway now has **two** authorization surfaces: the legacy
  `requirePermission(permission)` in `authorization.ts` (string-keyed
  `"resource:action"` from the in-gateway `PERMISSIONS` map) and the new
  `requireCapability(action, resource)` backed by `@borjie/authz-policy`.
  A future wave should consolidate these by migrating the `PERMISSIONS`
  matrix into `authz-policy` as a custom role config and deleting the
  duplicate engine in `authorization.ts`. That was out of scope here — the
  goal was adoption, not consolidation.
- `AbacEngine` (ABAC side of the package) is still unused. Good next target
  for a row-level rule like "PROPERTY_MANAGER can only mutate leases on
  properties in their `propertyAccess` list" — the engine already supports
  the required `in` / `contains` operators on `subject.propertyIds`.
- `JwtService` and `tenant-isolation` AsyncLocalStorage are also unused in
  the gateway which rolls its own in `hono-auth.ts` + `tenant-context.middleware.ts`.
  Candidates for a future consolidation wave.
