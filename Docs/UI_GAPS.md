# UI Gap Audit — Wave 15

Status of every `/api/v1/*` router versus UI coverage across the four user-facing apps.

Legend:
- [x] full UI built (list + write actions where relevant)
- [~] partial UI (read-only OR single-action only)
- [ ] no UI yet — rationale recorded below

## Admin portal (`apps/admin-portal`) — React-Router + Vite + next-intl

| Endpoint family | UI page | Status |
|---|---|---|
| `/exceptions` | `pages/Exceptions.tsx` (Wave 13) — verified | [x] |
| `/autonomy/*` | `pages/DelegationMatrix.tsx` (Wave 13) — verified | [x] |
| `/audit/autonomous-actions` | `pages/AuditLogPage.tsx` — rewired to live endpoint, hardcoded mock feed deleted | [x] |
| `/org/*` (bottlenecks / improvements / process-stats) | `pages/OrgInsights.tsx` | [x] |
| `/training/*` | `pages/Training.tsx` (Wave 13) — verified | [x] |
| `/compliance-plugins` | `pages/ComplianceSettings.tsx` | [x] |
| `/feature-flags` | `pages/FeatureFlags.tsx` (live toggle, no static list) | [x] |
| `/gdpr/*` | `pages/DataPrivacy.tsx` (lodge + lookup + execute) | [x] |
| `/ai-costs/*` | `pages/AiCosts.tsx` (summary + budget + entries) | [x] |
| `/warehouse/*` | `pages/Warehouse.tsx` (list + create + movement history) | [x] |
| `/maintenance-taxonomy/*` | `pages/MaintenanceTaxonomy.tsx` | [x] |
| `/iot/*` | `pages/IotSensors.tsx` (sensors + anomalies ack/resolve) | [x] |
| `/lpms/*` | `pages/LegacyMigration.tsx` (upload → preview → commit) | [x] |
| `/classroom/*` | `pages/Classroom.tsx` (create session + mastery heatmap) | [x] |
| `/workflows/*` | `pages/Workflows.tsx` (catalog + run + advance) | [x] |
| `/agent-certifications` | `pages/ApiIntegrations.tsx` (issue + list + revoke) | [x] |
| `/webhooks/dead-letters` | `pages/WebhookDLQ.tsx` (list + inspect + replay) | [x] |
| `/metrics` | `pages/SystemHealth.tsx` + `SystemHealthPage.tsx` (Wave 13) — verified | [x] |
| `/health/deep` | Shown on `SystemHealthPage.tsx`; dedicated compact card still pending | [~] |
| `/desktop-review` queues | `pages/DesktopReview.tsx` — stub `fetchPanelData` replaced with real fan-out to `/arrears`, `/cases`, `/operations/approvals`, `/org/bottlenecks` | [x] |

### Admin-portal gaps tracked
1. **System health `/health/deep` compact card**: the existing SystemHealth page already renders deep health inline. A standalone one-line summary card for the dashboard header was considered but intentionally deferred — the data is already visible on the SystemHealth route linked from the sidebar and a duplicate card would violate DRY. Route coverage: complete.

## Customer app (`apps/customer-app`) — Next.js 15 App Router

| Surface | Route | Status |
|---|---|---|
| Rent payment receipts list | `src/app/payments/history/page.tsx` — already real (uses `api.payments.getHistory`) | [x] |
| Maintenance request submission + photos | `src/app/maintenance/new/page.tsx` — **rewritten** from stub to a real `POST /cases` flow with up-to-5 photo data-URL uploads | [x] |
| Lease renewal offer viewer | `src/app/lease/renewal/page.tsx` — **rewritten** from stub; fetches `/renewals/active`, accept/decline/counter | [x] |
| Tenant ↔ manager messages list | `src/app/messages/page.tsx` — **rewritten** from stub; lists `/messaging/threads` with unread counts | [x] |
| Messages thread detail | `src/app/messages/[id]/page.tsx` — pre-existing | [x] |
| My documents (contracts, receipts, notices) | `src/app/lease/documents/page.tsx` exists | [~] |
| Mr. Mwikila widget | `packages/chat-ui` widget (Wave 12) mounts on every page | [x] |

### Customer-app gaps tracked
1. **Receipt PDF download**: `GET /payments/history` returns rows but no per-receipt PDF link yet — when the server exposes `/payments/:id/receipt.pdf` the existing row can gain a download button. No UI change needed today because the field is absent upstream.
2. **Document upload (tenant-side)**: tenants can read documents but not upload ID scans / proof of payment without going through the maintenance flow. Backend exposes `/scans` but schema mismatch with customer-app constraints — left for a follow-up where a dedicated `ScanUpload` component can be designed alongside the server validator.

## Owner portal (`apps/owner-portal`) — React-Router + Vite

| Surface | Route | Status |
|---|---|---|
| Portfolio health overview | `src/pages/DashboardPage.tsx` + `src/app/portfolio/page.tsx` — real data via `usePortfolioSummary` / `useProperties` | [x] |
| Monthly statements list | `src/pages/ReportsPage.tsx` — real, hits `/reports` | [x] |
| Property list with occupancy / arrears | `src/pages/PropertiesPage.tsx` + `PropertyDetailPage.tsx` — real | [x] |
| Owner Advisor (AI) | `src/pages/OwnerAdvisor.tsx` — real | [x] |

### Owner-portal gaps tracked
None introduced by this wave — the owner-portal surface was the most mature at audit time. Specific features like "download statement as PDF" depend on server-side export endpoints that are tracked in `Docs/TODO_BACKLOG.md`.

## Estate manager app (`apps/estate-manager-app`) — Next.js 15 App Router

| Surface | Route | Status |
|---|---|---|
| My team's tasks today | `src/app/page.tsx` dashboard + `src/screens/work-orders/` | [x] |
| Maintenance case triage inbox | `src/app/maintenance/page.tsx` → `MaintenanceDashboard` — real | [x] |
| Vendor dispatch queue | `src/app/vendors/page.tsx` + `src/screens/vendors/` — real | [x] |
| Today's inspections | `src/app/inspections/page.tsx` → `InspectionsPage` — real | [x] |
| Coworker / Brain / Schedule / SLA / Tenders | All exist under `src/app/` — real | [x] |

### Estate-manager-app gaps tracked
None net new. Deeper "collections" + "negotiations" workflows are already scaffolded and live.

## Cross-cutting notes
- **No mock data shipped**: every new admin page short-circuits to an empty state when the endpoint returns `success:false` or `data:[]`. No hardcoded records.
- **Tenant isolation**: every `fetch` relies on the JWT in localStorage; server routers stamp tenantId from auth context — never the payload.
- **i18n**: admin-portal nav strings added to EN + SW (`messages/en.json`, `sw.json`). Page bodies use literal English suited to operator role; Swahili keys can be layered on demand without template changes.
- **Mr. Mwikila widget**: untouched (Wave 12), remains mounted through `MwikilaWidgetMount`.
