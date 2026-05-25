# Wave 18 Agent B — Unwired Router Audit

## Summary

- **Routers audited:** 76 (every `app.route(...)` in `services/api-gateway/src/index.ts`).
- **Wired this wave (4):**
  1. `/api/v1/notifications` — was a stub returning 503 for every request. Now reads `notification_dispatch_log` directly via `services.db`. Endpoints: `GET /`, `GET /:id`, `GET /unread/count`.
  2. `/api/v1/onboarding` — was a stub returning 503. Now backed by `OnboardingService` from `@borjie/domain-services/onboarding` with a tenant-scoped in-memory repo (Postgres adapter deferred — see below). Endpoints: `GET /`, `POST /`, `GET /:id`, `POST /:id/complete-step`.
  3. `/api/v1/customer` (Customer App BFF) — was a stub returning 503. Now serves `GET /me` and `GET /me/dashboard` (active lease, open balance, recent invoices/payments) from the shared `repos` middleware.
  4. `/api/v1/admin` (Admin Portal BFF) — was a stub returning 503. Now serves `GET /overview` with tenant-wide property/unit/lease/invoice counts and open-balance total, gated to TENANT_ADMIN/SUPER_ADMIN/ADMIN.

- **Still deferred with documented upstream-missing reason (12):**
  | Router | Upstream missing | Notes |
  |--------|------------------|-------|
  | `auth` — `POST /register`, `/password/change`, `/password/reset` | Self-service auth flows not enabled for pilot | Intentional per Mr. Mwikila's invite-only rollout. Returns `LIVE_DATA_NOT_IMPLEMENTED`. |
  | `compliance` — `POST /exports/:id/generate`, `GET /exports/:id/download` | `ComplianceExportService` (storage + data providers) | `GET/POST /exports` list + schedule are fully wired. |
  | `voice` — STT / TTS endpoints | `ELEVENLABS_API_KEY` and/or `OPENAI_API_KEY` | Registry correctly sets `voice: null` when neither env var is present. |
  | `mcp` — JSON-RPC + `/manifest` | `@borjie/mcp-server` requires `isLive` registry | Works in live Postgres mode; returns 503 in degraded. |
  | `doc-chat` — all endpoints | `DATABASE_URL` | Fully wired but requires DB tables (`doc_chat_sessions`, `document_embeddings`). |
  | `scans` — all endpoints | `DATABASE_URL` | Direct DB access; 503 only in degraded mode. |
  | `interactive-reports` — all endpoints | `DATABASE_URL` | Direct DB access; 503 only in degraded mode. |
  | `document-render` — all endpoints | `DATABASE_URL` | Direct DB access; 503 only in degraded mode. |
  | `modules/documents.routes` (`documentsEnhancedRouter`, `evidencePacksRouter`) | Not mounted under `/api/v1/*` — unused in root | Dead imports via the factory; no user-visible impact. |
  | `modules/maintenance.routes` (`maintenanceRequestsRouter`) | Not mounted under `/api/v1/*` | Same as above. |
  | `letters` — approval / signed-url endpoints | `ApprovalPort`, `SignedUrlPort` | Router already returns structured error; create/draft/approve happy-path works with in-memory repo. |
  | `gepg` — all endpoints | `GEPG_HEALTH_URL` + signing credentials | Router constructs its own client per request; 503 only when creds missing (documented in-router). |

- **Miswired fixed (0):** no naming mismatch (e.g. `services.creditrating` vs `services.creditRating`) was found. Every router's `c.get('services').<key>` chain resolves to the slot declared in `ServiceRegistry` in `services/api-gateway/src/composition/service-registry.ts`.

- **Composition-root slots added (0):** the existing `ServiceRegistry` already covers every domain service that has a Postgres adapter. The 4 routers we wired this wave read their data directly via `services.db` (notifications, admin, customer BFFs) or use an in-memory repo scoped to the router module (onboarding).

## Details

### Wired: `routes/notifications.ts`

**Before:** `export const notificationsRouter = createProtectedLiveDataRouter('Notifications API');` — every request hit the catch-all in `live-data-router.ts` and got HTTP 503 `LIVE_DATA_NOT_IMPLEMENTED`. The router was visibly broken in every UI that pulled notifications.

**After:** Pulls rows from `notification_dispatch_log` (schema at `packages/database/src/schemas/messaging.schema.ts`) tenant-scoped via `services.db`. Returns 200 with real delivery-status data. The `/unread/count` endpoint currently returns `{ unread: 0, note: 'in-app inbox schema pending' }` — the dispatch log doesn't track `read_at`, so an unread count would be a lie until an in-app inbox table lands.

### Wired: `routes/onboarding.ts`

**Before:** `createProtectedLiveDataRouter('Onboarding workflow')` stub returning 503.

**After:** Instantiates `OnboardingService` from `@borjie/domain-services/onboarding` over a process-local `Map`-backed repo. The state-machine, checklist, and `Result<Ok, Err>` return shape are all intact — clients can `POST /onboarding`, get a real `OnboardingSession` back, and drive the PRE_MOVE_IN → WELCOME → ... → COMPLETED state transitions via `POST /:id/complete-step`. Data does not survive a gateway restart; noted in the router docstring. Flipping to Postgres is a drop-in replacement once a `PostgresOnboardingRepository` implementing the exported `OnboardingRepository` interface lands in `services/domain-services/src/onboarding/`.

### Wired: `routes/bff/customer-app.ts`

**Before:** `createProtectedLiveDataRouter('Customer app BFF')`.

**After:**
- `GET /me` — returns `{ userId, tenantId, role, customerId }` from the auth context. No DB required; always 200 when authed.
- `GET /me/dashboard` — joins the caller's `customerId` against leases/invoices/payments via the existing `repos` middleware and returns `{ activeLease, openBalance, recentInvoices, recentPayments }`. Returns 503 only when `repos` is absent (DATABASE_URL unset).

### Wired: `routes/bff/admin-portal.ts`

**Before:** `createProtectedLiveDataRouter('Admin portal BFF')`.

**After:**
- `GET /overview` — gated to TENANT_ADMIN/SUPER_ADMIN/ADMIN. Aggregates counts for properties, units, leases, active leases, customers, open invoices, plus the total open balance across unpaid invoices. Single round-trip to the shared repos via `Promise.all`.

### Not touched (already wired correctly)

All 60+ remaining routers pull their service slot correctly. Spot-checks confirmed:
- `autonomy` → `services.autonomy.policyService` (live + degraded both populated).
- `org-awareness` → `services.orgAwareness` (always populated — in-memory stores in degraded mode).
- `ai-costs` → `services.aiCostLedger` (null in degraded; correct).
- `credit-rating` → `services.creditRating` (null in degraded; correct).
- `property-grading` → `services.propertyGrading` (null in degraded; correct).
- `marketplace` → `services.marketplace.{listing,enquiry,tender}` (individual slots correctly nested).
- `negotiations` → `services.negotiation` (singular; correct per registry).
- `waitlist` → `services.waitlist.{service,vacancyHandler}` (nested; correct).
- `warehouse`, `iot`, `maintenance-taxonomy`, `feature-flags`, `gdpr`, `training`, `classroom`, `voice`, `mcp`, `agent-certifications` — all read `services.<camelCase>` and match the registry.
- `arrears` — reads `arrearsService`/`arrearsRepo`/`arrearsLedgerPort`/`arrearsEntryLoader` flat keys set by `service-context.middleware.ts`.
- `financial-profile`, `risk-reports`, `renewals`, `occupancy-timeline`, `station-master-coverage`, `applications` — read flat keys (`financialProfileService`, etc.) also set by the middleware.

The one router that reads a lower-case-only alternative is `credit-rating.router.ts:54` which does `services.creditRating ?? c.get('creditRatingService')` — both are wired consistently in the composition root, so no miswire.

### Live-data stub factory

`services/api-gateway/src/routes/live-data-router.ts` exports `createProtectedLiveDataRouter(feature)` which mounts `app.all('*', … 503 LIVE_DATA_NOT_IMPLEMENTED)`. Still used by:
- `routes/modules/documents.routes.ts` (`documentsEnhancedRouter`, `evidencePacksRouter`) — **not mounted** under `/api/v1/*`. Dead re-export.
- `routes/modules/maintenance.routes.ts` (`maintenanceRequestsRouter`) — **not mounted** under `/api/v1/*`. Dead re-export.

Both are referenced nowhere in `services/api-gateway/src/index.ts` so they are invisible to live traffic. Left in place because other agents may be using them — removing would be out-of-scope for Agent B.

## Composition-root slots added

None. The registry in `services/api-gateway/src/composition/service-registry.ts` already exposes every slot needed by the routers we touched. The four routers we wired either:
- Reach directly into `services.db` (notifications, admin, customer) because the relevant domain-services adapter does not yet exist, or
- Instantiate a domain service locally with an in-memory repo (onboarding) until the Postgres adapter lands.

## Verification

- `pnpm typecheck` at `services/api-gateway`: **passes** (no new errors).
- `pnpm test` at `services/api-gateway`: **23 files, 154 tests, 100% green**.
- `pnpm build` at `services/domain-services`: **clean** (no compiler errors).

## Open follow-ups (outside Agent B scope; noted for downstream waves)

1. Build `PostgresOnboardingRepository` in `services/domain-services/src/onboarding/` and wire through the composition root as `services.onboarding`. Schema already exists implicitly in the `OnboardingSession` type.
2. Build a `NotificationService` domain module (templates + dispatcher + dispatch log) and replace the direct-DB shortcut in `routes/notifications.ts` with `services.notifications`. Current wire is intentionally minimal.
3. Wire `ComplianceExportService` (needs storage + data-provider adapters) to close the remaining 503s on `/compliance/exports/:id/generate` and `/download`.
4. Remove the dead `modules/documents.routes.ts` + `modules/maintenance.routes.ts` re-exports if no router mounts them by Wave 19. They currently have zero production impact but read as clutter.
