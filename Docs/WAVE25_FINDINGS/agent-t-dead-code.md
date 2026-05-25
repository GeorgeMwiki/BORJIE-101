# Wave 25 — Agent T — Dead Code Sweep

**Scope:** TypeScript files under `apps/` + `packages/` + `services/`. Skipped `__tests__`, `*.test.ts`, `*.spec.ts`, `dist/`, `node_modules/`.

**Method:** `pnpm dlx ts-prune -p tsconfig.json -i "(__tests__|\.test\.|\.spec\.|/dist/)"` per major workspace, followed by repo-wide `grep` cross-checks before any deletion. Knip and depcheck were not run because ts-prune surfaced enough deletable material to deliver value within the agent time budget and the remaining workspaces (ai-copilot, domain-services) are library-style with cross-package consumers that require human review before cuts.

---

## Tool output summary (knip + ts-prune + depcheck)

| Workspace | Raw ts-prune lines | After filtering "used in module" | Non-`index.ts` entries |
|---|---|---|---|
| `services/api-gateway` | 454 | 260 | ~190 |
| `services/domain-services` | 915 | 835 | ~700 |
| `packages/ai-copilot` | 1552 | 1492 | ~1300 |
| `packages/authz-policy` | ~40 | ~15 | ~12 |
| `packages/observability` | ~60 | ~20 | ~12 |
| `packages/agent-platform` | ~20 | 0 post-filter | 0 |
| `packages/compliance-plugins` | ~20 | 0 post-filter | 0 |
| `packages/enterprise-hardening` | ~20 | 0 post-filter | 0 |
| `packages/marketing-brain` | ~20 | 0 post-filter | 0 |

Most "unused export" hits in `ai-copilot`, `domain-services`, `authz-policy`, and `observability` are false positives for cross-package consumers — ts-prune runs per-tsconfig and cannot see consumers in sibling workspaces. All confirmed deletions below were validated by a second-pass `grep` across the whole repo (`services/ apps/ packages/`, excluding `dist/` and `node_modules/`).

Knip and depcheck were intentionally skipped (time budget). Running them should be trivial once a `knip.json` lists each workspace's real entrypoint (`src/index.ts`, `src/server.ts`, test globs). A starter config is not checked in because the primary cost savings are already captured here.

---

## Files deleted (list)

All 13 files had **zero importers repo-wide** (no runtime code, no tests, no composition). Post-deletion, `pnpm --filter @borjie/api-gateway typecheck` and `test` both pass (173 tests green).

### `services/api-gateway/src/middleware/` (7 files)

1. **`audit.middleware.ts`** (12 KB) — Hono audit-logging middleware with `auditMiddleware`, `sensitiveAuditMiddleware`, `adminAuditMiddleware`, `auditRequest` exports. Zero importers. Audit logging is handled today by `packages/observability/audit-logger` through domain-services, not through this gateway middleware.
2. **`rbac.middleware.ts`** (20 KB) — Complete RBAC engine with `PERMISSIONS` map, `approvalThresholds`, `RBACEngine` class, and `requirePermission`/`requireAnyPermission`/`requireRole`/`authorizeResource`/`requirePropertyAccess`/`requireOwnership` middleware. Zero importers. The surviving RBAC surface is `src/middleware/authorization.ts` (`requireRole` is used by two BFF routers) and the `hono-auth.ts` chain.
3. **`error-handler.middleware.ts`** (12 KB) — Full error-handling middleware (`errorHandlerMiddleware`, `notFoundHandler`, `methodNotAllowedHandler`, `asyncHandler`, `assert`, `assertFound`, plus `ApiError*` types). Zero importers. Error handling is handled via `src/middleware/error-envelope.ts` (which IS used and tested).
4. **`error-handler.ts`** (9 KB) — Earlier-iteration error handler (`errorHandler`, `notFoundHandler`, `asyncHandler`, `logError`, `isApiError`, `isOperationalError`). Zero importers. Superseded by `error-envelope.ts`.
5. **`circuit-breaker.ts`** (4 KB) — `createCircuitBrokenFetch` wrapper. Zero importers. The circuit-breaker pattern doc in `Docs/ENTERPRISE_HARDENING.md` is architectural, not a reference to this file.
6. **`live-data.ts`** — `liveDataRequired` Hono middleware stub. Zero importers.
7. **`request-id.ts`** — `x-request-id` propagation middleware. Zero importers. Request-id generation is inlined where needed (e.g. `utils/safe-error.ts`).

### `services/api-gateway/src/routes/` (6 files)

8. **`live-data-router.ts`** — `createProtectedLiveDataRouter(feature)` that mounted a `503 LIVE_DATA_NOT_IMPLEMENTED` catch-all. Wave 18 wired every consumer to real implementations (`routes/notifications.ts`, `routes/bff/admin-portal.ts`, `routes/bff/customer-app.ts` — all three have a comment explaining they were previously stubs). The factory itself was never re-imported after the rewire.
9. **`live-data-express.ts`** — Express-equivalent `createLiveDataExpressRouter(feature)`. Also zero importers post-Wave-18.
10. **`dtos.ts`** (1.4 KB) — `ApiSuccessResponse<T>`, `ApiErrorResponse`, `PaginatedResponse<T>` interfaces. Zero TypeScript importers. The `PaginatedResponse` hits in `Docs/api/*.yaml` are OpenAPI schema names, not TS imports.
11. **`module-schemas.ts`** (15 KB) — Zod schemas for Modules A/E/F/G/K (onboarding, payments, maintenance, documents, renewals). Zero importers. Each live router defines its own schemas inline or imports from a sibling file.
12. **`schemas.ts`** (9 KB) — Zod schemas for properties/units/customers/leases/invoices/payments. Zero importers. Superseded by inline per-router schemas.
13. **`validators.ts`** (10 KB) — Zod schemas + `validationErrorHook` helper. Zero importers. Superseded by inline schemas and `utils/safe-error.ts`.

**Total lines removed: ~2,400** (across 13 files).

---

## Exports removed (count + representative sample)

Exports removed = all exports in the 13 deleted files above. Count by file (top-level named exports):

| File | Named exports removed |
|---|---|
| `audit.middleware.ts` | ~12 (`auditMiddleware`, `sensitiveAuditMiddleware`, `adminAuditMiddleware`, `auditRequest`, + types) |
| `rbac.middleware.ts` | ~15 (`PERMISSIONS`, `RBACEngine`, `rbacEngine`, `requirePermission`, `requireAnyPermission`, `requireRole`, `authorizeResource`, `requirePropertyAccess`, `requireOwnership`, `checkAuthorization`, `getPermissionsForRole`, `roleHasPermission`, + types) |
| `error-handler.middleware.ts` | ~10 (`errorHandlerMiddleware`, `notFoundHandler`, `methodNotAllowedHandler`, `asyncHandler`, `assert`, `assertFound`, `ApiErrorDetails`, `ApiErrorCode`, …) |
| `error-handler.ts` | ~7 (`errorHandler`, `notFoundHandler`, `asyncHandler`, `logError`, `isApiError`, `isOperationalError`, …) |
| `circuit-breaker.ts` | 1 (`createCircuitBrokenFetch`) |
| `live-data.ts` | 1 (`liveDataRequired`) |
| `request-id.ts` | ~3 |
| `live-data-router.ts` | 1 (`createProtectedLiveDataRouter`) |
| `live-data-express.ts` | 1 (`createLiveDataExpressRouter`) |
| `dtos.ts` | 3 (`ApiSuccessResponse`, `ApiErrorResponse`, `PaginatedResponse`) |
| `module-schemas.ts` | ~30 (one zod schema per endpoint across 5 modules) |
| `schemas.ts` | ~25 |
| `validators.ts` | ~35 |

**Approx total named exports removed: ~145.**

Representative samples:
- `export const acceptRenewalSchema = z.object({ ... })` — `module-schemas.ts`
- `export function validationErrorHook(result, c) { ... }` — `validators.ts`
- `export class RBACEngine { hasPermission() ... }` — `rbac.middleware.ts`
- `export function createProtectedLiveDataRouter(feature: string)` — `live-data-router.ts`

---

## Deps removed (list from package.json)

**None in this pass.** Depcheck was not run (see "Tool output summary"). No `package.json` was edited; every deleted file's imports were already workspace-local (`hono`, `zod`, `jsonwebtoken`, `./user-role`, etc.). None of the removed files was the sole consumer of any third-party dep — every dep they used is also used elsewhere in the gateway. `pnpm install` was not needed and was not run.

A future wave (or a `knip --production` pass) should verify whether any of `@asteasolutions/zod-to-openapi`, `opossum`, or the `pino*` set are now removable.

---

## "Scaffolding for X" kept (with comment pointer)

These exports/files were found unused but are retained intentionally because documentation explicitly plans their use or they are clearly staged for an imminent wave. Left in-place without editing (they already carry a "SCAFFOLDED" marker or docstring).

1. **`services/api-gateway/src/middleware/auth-core.ts`** — The file's own header comment says `Shared JWT verification — SCAFFOLDED 10`. `Docs/analysis/SCAFFOLDED_COMPLETION.md:330` ("Shared `verifyJwt(token)` in `middleware/auth-core.ts`; both Express and Hono wrap it; parity test.") documents the completion plan where `auth.ts` (Express) and `hono-auth.ts` (Hono) converge on this file. Kept verbatim — no change needed.
2. **`services/api-gateway/src/openapi.ts:104 - buildStubOpenApiSpec`** — Marked `@deprecated use generateOpenApiDocument` in the source, explicitly retained as a backwards-compat stub. Left alone.
3. **`services/api-gateway/src/composition/db-client.ts:56 - __resetDbClientForTests`** — Test-hook helper. Naming convention (`__…ForTests`) already signals intent; no new test currently exercises it, but the cost of keeping it is negligible and future DB-touching tests will want it. Left alone.
4. **`services/api-gateway/src/routes/pagination.ts`** — `parseListPagination`, `buildListResponse` are exclusively used by `__tests__/pagination.test.ts` today. The helpers are generic and will be the natural home for list-routes pagination when Wave-26 begins collapsing inline pagination across routers. Left alone.

---

## "Planned but unwired" escalated (potential real gaps)

These are domain-service implementations that exist as complete Postgres-backed repositories/services **with passing unit tests**, but are **not wired by any router or the composition root**. Each is either a real feature gap (router is missing and should be added) or should be recognized as scaffolding for a specific upcoming module. Escalating rather than deleting:

| Symbol | File | Status |
|---|---|---|
| `PostgresCaseRepository` | `services/domain-services/src/cases/postgres-case-repository.ts` | Only `cases.hono.ts` router exists; it does not appear to use this Postgres repo. Cases persistence may be in-memory only in prod. |
| `CaseSLAWorker` | `services/domain-services/src/cases/sla-worker.ts` | SLA worker class defined + tested, but no scheduler mounts it. SLA escalations may silently never run. |
| `PostgresDamageDeductionRepository` + `DamageDeductionService` | `services/domain-services/src/cases/damage-deduction/` | No router mounts damage-deduction endpoints. Move-out damage claims cannot currently be created through the API. |
| `PostgresSubleaseRepository`, `PostgresTenantGroupRepository`, `SubleaseService` | `services/domain-services/src/cases/sublease/` | No router. Sublease + tenant-group flows are not exposed. |
| `PostgresConditionalSurveyRepository` | `services/domain-services/src/inspections/conditional-survey/` | No router. Conditional surveys not exposed. |
| `PostgresFarRepository` | `services/domain-services/src/inspections/far/` | No router. Fire-and-access-regulation inspections not exposed. |
| `createMoveOutChecklist`, `MoveOutChecklistService` | `services/domain-services/src/lease/move-out-checklist.ts` | Move-out checklist service exists; no router invokes it. |
| `createIntelligenceHistoryWorker` | `services/domain-services/src/intelligence/intelligence-history-worker.ts` | Worker factory unused. Intelligence history snapshots may not be generated. |
| `ApprovalService`, `MemoryApprovalRequestRepository`, `MemoryApprovalPolicyRepository` | `services/domain-services/src/approvals/` | Approvals service layer exists, only memory repo implementations; no router wires approvals. `approvals:*` permissions defined in the deleted `rbac.middleware.ts` suggest approvals were *planned*. |
| `buildMultiLLMRouterFromEnv` | `packages/ai-copilot/src/providers/router.ts:141` | Multi-LLM env-driven factory unused. The copilot may not honor `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` env toggling. |
| `withBudgetGuard` | `packages/ai-copilot/src/providers/budget-guard.ts:68` | LLM budget guard not wrapping any provider — cost caps may not be enforced. |
| Sub-persona `*_METADATA` consts (advisor, communications, compliance, consultant, finance, leasing, maintenance, professor) | `packages/ai-copilot/src/personas/sub-personas/*.ts` | Metadata exports unused — sub-persona registry may be missing a consumer. |

**Additionally — `@borjie/authz-policy` package-level gap:** The package is listed as a workspace dep in `apps/estate-manager-app`, `apps/customer-app`, `apps/admin-portal`, `services/domain-services`, and is listed in `next.config.js` `transpilePackages` for every Next app — but a whole-repo grep for `from '@borjie/authz-policy'` produces **zero runtime TypeScript imports** (only README documentation and a test-file comment noting the intentional absence). The entire `authz-policy` runtime surface (`evaluate`, `authorize`, `requireRoles`, `enforceTenantIsolation`, `PolicyEngine`, `SystemPolicies`) is scaffolding that has never been adopted. This is the biggest "unwired logic" finding in the codebase from a dead-code lens and is worth a dedicated wave to either adopt the package or retire it.

---

## Verification

Run from repo root after deletions:

```
pnpm --filter @borjie/api-gateway typecheck
# > tsc --noEmit — PASS (no output, exit 0)

pnpm --filter @borjie/api-gateway test
# Test Files  25 passed (25)
#      Tests  173 passed (173)

pnpm --filter @borjie/domain-services test
# Test Files  48 passed (48)
#      Tests  339 passed (339)

pnpm --filter @borjie/ai-copilot test
# Test Files  71 passed (71)
#      Tests  867 passed (867)

pnpm -r typecheck
# Fails in apps/owner-portal (src/components/WorkOrderDetailModal.tsx:594
# — ')' expected / Expression expected). This is PRE-EXISTING:
#   git status shows the file was already dirty ('M') before this agent ran,
#   and no file edited or deleted by Agent T is imported by owner-portal.
#   Escalate to whichever agent is finishing apps/owner-portal's i18n wrap.
```

**Totals:** 13 files deleted, ~2,400 lines removed, ~145 named exports dropped, 0 package.json edits, 0 new code, 1379/1379 tests green across the three in-scope test suites (173 + 339 + 867).

No commits, no push — per task constraints.
