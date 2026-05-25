# Wave 18 Agent C — Missing UI / Missing Logic Audit (apps/)

Scope: `apps/admin-portal`, `apps/owner-portal`, `apps/customer-app`, `apps/estate-manager-app`.
No commits, no pushes. Per-app `pnpm typecheck` passes after fixes (see end).

## Context & pattern

Previous waves deliberately replaced all mock-data pages with a shared
"LiveDataRequiredPage" / "LiveDataRequiredScreen" banner (red AlertTriangle
card). These are **not** "Coming soon" stubs — they are an explicit
"do-not-show-fake-data" gate from the policy: _"The sample path has been
removed, and this view stays unavailable until the live X integration is
wired."_

Classification used:
- **live**: hits a real API hook + has loading/empty/error states.
- **banner**: intentionally gated with LiveDataRequiredPage (NOT a bug —
  documented as "Still stub" with reason).
- **fixture**: renders hardcoded JSX without binding — a real gap.
- **broken**: imports a non-existent symbol (blocks typecheck).
- **wrapper**: one-line file delegating to a screen — inherits the
  classification of the screen.

## Per-app audit tables

### apps/admin-portal (React Router)

| Route | Component | State |
|---|---|---|
| `/` | `pages/DashboardPage.tsx` | live |
| `/login` | `pages/LoginPage.tsx` | live |
| `/tenants` | `pages/TenantsPage.tsx` | banner |
| `/tenants/onboard` | `pages/tenants/OnboardingWizard.tsx` | live |
| `/tenants/:id` | `pages/TenantDetailPage.tsx` | banner |
| `/users` | `pages/UsersPage.tsx` | banner |
| `/roles` | `pages/RolesPage.tsx` | live |
| `/roles/permissions` | `pages/roles/PermissionMatrix.tsx` | live |
| `/roles/approvals` | `pages/roles/ApprovalMatrix.tsx` | live |
| `/operations` | `pages/OperationsPage.tsx` | live |
| `/operations/control-tower` | `pages/operations/ControlTower.tsx` | live |
| `/support` | `pages/SupportPage.tsx` | live |
| `/support/timeline` | `pages/support/CustomerTimeline.tsx` | banner |
| `/support/escalation` | `pages/support/Escalation.tsx` | banner |
| `/ai` | `pages/ai/AICockpit.tsx` | banner |
| `/manager-chat` | `pages/ManagerChat.tsx` | live |
| `/desktop-review` | `pages/DesktopReview.tsx` | live |
| `/training` | `pages/Training.tsx` | live |
| `/delegation` | `pages/DelegationMatrix.tsx` | live |
| `/head` | `pages/HeadOfEstates.tsx` | live |
| `/exceptions` | `pages/Exceptions.tsx` | live |
| `/org-insights` | `pages/OrgInsights.tsx` | live |
| `/compliance-settings` | `pages/ComplianceSettings.tsx` | live |
| `/feature-flags` | `pages/FeatureFlags.tsx` | live |
| `/data-privacy` | `pages/DataPrivacy.tsx` | live |
| `/ai-costs` | `pages/AiCosts.tsx` | live |
| `/warehouse` | `pages/Warehouse.tsx` | live |
| `/maintenance-taxonomy` | `pages/MaintenanceTaxonomy.tsx` | live |
| `/iot` | `pages/IotSensors.tsx` | live |
| `/classroom` | `pages/Classroom.tsx` | live |
| `/workflows` | `pages/Workflows.tsx` | live |
| `/api-integrations` | `pages/ApiIntegrations.tsx` | live |
| `/webhook-dlq` | `pages/WebhookDLQ.tsx` | live |
| `/legacy-migration` | `pages/LegacyMigration.tsx` | live |
| `/tenant-credit` | `pages/TenantCredit.tsx` | live |
| `/property-grades` | `pages/PropertyGrades.tsx` | live |
| `/reports` | `pages/ReportsPage.tsx` | live |
| `/configuration` | `pages/ConfigurationPage.tsx` | live |
| `/audit` | `pages/AuditLogPage.tsx` | live |
| `/system` | `pages/SystemHealthPage.tsx` | live (shim → `SystemHealth.tsx`) |
| `/platform`, `/platform/overview` | `app/platform/overview/page.tsx` | live |
| `/platform/subscriptions` | `app/platform/subscriptions/page.tsx` | live |
| `/platform/billing` | `app/platform/billing/page.tsx` | banner |
| `/platform/feature-flags` | `app/platform/feature-flags/page.tsx` | banner |
| `/communications` | `app/communications/page.tsx` | live |
| `/communications/templates` | `app/communications/templates/page.tsx` | live |
| `/communications/campaigns` | `app/communications/campaigns/page.tsx` | live |
| `/communications/broadcasts` | `app/communications/broadcasts/page.tsx` | banner |
| `/compliance` | `app/compliance/page.tsx` | banner |
| `/compliance/documents` | `app/compliance/documents/page.tsx` | banner |
| `/compliance/data-requests` | `app/compliance/data-requests/page.tsx` | banner |
| `/analytics` | `app/analytics/page.tsx` | banner |
| `/analytics/usage` | `app/analytics/usage/page.tsx` | banner |
| `/analytics/growth` | `app/analytics/growth/page.tsx` | banner |
| `/analytics/exports` | `app/analytics/exports/page.tsx` | live |
| `/integrations` | `app/integrations/page.tsx` | live |
| `/integrations/webhooks` | `app/integrations/webhooks/page.tsx` | live |
| `/integrations/api-keys` | `app/integrations/api-keys/page.tsx` | live (fixed broken import) |

Nav audit: every left-sidebar item in `components/Layout.tsx` (Dashboard, Tenants, Operations, Support, Maintenance Taxonomy, Warehouse, IoT, Workflows, Reports, AI Costs, AI Cockpit, Classroom, Exceptions, Org Insights, Platform, Analytics, Communications, Compliance, Users, Roles, Integrations, API Integrations, Configuration, Feature Flags, Compliance Settings, Data Privacy, Audit Log, System Health, Webhook DLQ, Legacy Migration) resolves. No dead links.

### apps/owner-portal (React Router)

| Route | Component | State |
|---|---|---|
| `/login` | `pages/LoginPage.tsx` | live |
| `/dashboard` | `pages/DashboardPage.tsx` | live |
| `/properties` | `pages/PropertiesPage.tsx` | live |
| `/properties/:id` | `pages/PropertyDetailPage.tsx` | live |
| `/portfolio` | `app/portfolio/page.tsx` | live |
| `/portfolio/performance` | `app/portfolio/performance/page.tsx` | live |
| `/portfolio/growth` | `app/portfolio/growth/page.tsx` | live |
| `/analytics` | `app/analytics/page.tsx` | live |
| `/analytics/occupancy` | `app/analytics/occupancy/page.tsx` | live |
| `/analytics/revenue` | `app/analytics/revenue/page.tsx` | live |
| `/analytics/expenses` | `app/analytics/expenses/page.tsx` | live |
| `/vendors` | `app/vendors/page.tsx` | live |
| `/vendors/contracts` | `app/vendors/contracts/page.tsx` | live |
| `/vendors/:id` | `app/vendors/[id]/page.tsx` | live |
| `/compliance` | `app/compliance/page.tsx` | live |
| `/compliance/licenses` | `app/compliance/licenses/page.tsx` | live |
| `/compliance/insurance` | `app/compliance/insurance/page.tsx` | live |
| `/compliance/inspections` | `app/compliance/inspections/page.tsx` | live |
| `/tenants` | `app/tenants/page.tsx` | live |
| `/tenants/communications` | `app/tenants/communications/page.tsx` | live |
| `/tenants/:id` | `app/tenants/[id]/page.tsx` | live |
| `/budgets` | `app/budgets/page.tsx` | live (fixed readonly type mismatch) |
| `/budgets/forecasts` | `app/budgets/forecasts/page.tsx` | live |
| `/budgets/:propertyId` | `app/budgets/[propertyId]/page.tsx` | live |
| `/financial` | `pages/FinancialPage.tsx` | live |
| `/financial/disbursements` | `pages/financial/Disbursements.tsx` | live |
| `/maintenance` | `pages/MaintenancePage.tsx` | live |
| `/documents` | `pages/DocumentsPage.tsx` | live |
| `/documents/e-signature` | `pages/documents/ESignature.tsx` | live |
| `/approvals` | `pages/ApprovalsPage.tsx` | live |
| `/reports` | `pages/ReportsPage.tsx` | live |
| `/messages` | `pages/MessagesPage.tsx` | live |
| `/settings` | `pages/SettingsPage.tsx` | live |
| `/advisor` | `pages/OwnerAdvisor.tsx` | live |
| `/portfolio-grade` | `pages/PortfolioGrade.tsx` | live |

Nav audit: `components/Layout.tsx` declares 14 items (Dashboard, Portfolio, Properties, Analytics, Tenants, Vendors, Budgets, Compliance, Financial, Maintenance, Documents, Approvals, Reports, Messages). All resolve.

### apps/customer-app (Next.js app router)

All routes live under `apps/customer-app/src/app/`. Abbreviated where state is identical.

| Route | State | Notes |
|---|---|---|
| `/` (landing) | live | public chat + generative UI |
| `/auth/login` | live | |
| `/auth/register` | live | |
| `/auth/otp` | live | |
| `/auth/whatsapp` | live | |
| `/onboarding`, `/onboarding/*` (8 subpages) | live | welcome, e-sign, inspection, documents, utilities, orientation, complete |
| `/lease` | live | |
| `/lease/documents`, `/lease/documents/[id]` | live | |
| `/lease/renewal` | live | |
| `/lease/sublease` | live | |
| `/lease/move-out` | live | |
| `/lease/move-out/disputes` | live | |
| `/payments` | live | |
| `/payments/pay` | live | |
| `/payments/history` | live | |
| `/payments/bank-transfer` | banner | payment rail integration |
| `/payments/mpesa` | banner | M-Pesa callback flow |
| `/payments/invoice/[id]` | live | |
| `/payments/success` | live | |
| `/payments/plan` | banner | payment plan service |
| `/maintenance` | live | |
| `/maintenance/new` | live | |
| `/maintenance/[id]` | banner | request detail |
| `/maintenance/[id]/feedback` | live | |
| `/messages` | live | |
| `/messages/[id]` | banner | conversation detail service |
| `/my-credit` | live | |
| `/notifications` | **live (FIXED this wave)** | was banner — now fetches `/api/v1/notifications` with loading/empty/error states |
| `/announcements`, `/announcements/[id]` | live | |
| `/assistant`, `/assistant/training` | live | |
| `/blog`, `/blog/[slug]` | live | |
| `/community`, `/community/rules` | live | |
| `/compare` | live | |
| `/documents`, `/documents/[id]` | live | |
| `/emergencies`, `/emergencies/report` | live | |
| `/feedback`, `/feedback/history` | live | |
| `/for-managers`, `/for-owners`, `/for-station-masters`, `/for-tenants` | live | marketing |
| `/how-it-works`, `/pricing` | live | marketing |
| `/marketplace` | banner | vendor catalog service |
| `/marketplace/[unitId]/negotiate` | live | |
| `/requests`, `/requests/new`, `/requests/letters` | live | |
| `/requests/[id]` | banner | request detail service |
| `/requests/[id]/feedback` | live | |
| `/profile`, `/profile/edit` | live | |
| `/settings`, `/settings/notifications` | live | |
| `/support` | live | |
| `/utilities`, `/utilities/submit-reading` | live | |
| `/offline`, `/not-found`, `/error` | live | system routes |

Nav audit: customer-app has tab bar in `components/layout/*` + in-page CTAs. All primary journey steps reachable: login → home → lease → payments → maintenance → messages → my-credit. No dead links.

### apps/estate-manager-app (Next.js app router)

| Route | State | Notes |
|---|---|---|
| `/` (dashboard) | live | queries properties/units/workOrders/leases/payments |
| `/announcements`, `/announcements/create`, `/announcements/[id]` | live | |
| `/brain`, `/brain/migrate`, `/brain/reviews`, `/brain/threads`, `/brain/threads/[id]` | live | |
| `/calendar`, `/calendar/availability`, `/calendar/events` | live | |
| `/collections` | banner | collections + comms service |
| `/coworker`, `/coworker/training` | live | |
| `/customers`, `/customers/new`, `/customers/[id]`, `/customers/[id]/edit`, `/customers/[id]/onboarding` | live | |
| `/documents/chat` | live | |
| `/inspections` | **live (FIXED this wave)** | was banner — now fetches inspectionsService list |
| `/inspections/[id]`, `/inspections/[id]/conduct` | live | |
| `/inspections/move-out` | banner | move-out inspection workflow |
| `/inspections/conditional-surveys` | banner | conditional survey workflow |
| `/leases`, `/leases/new`, `/leases/[id]`, `/leases/[id]/move-out`, `/leases/[id]/renew`, `/leases/[id]/renewal` | live | |
| `/maintenance` | banner | maintenance analytics service |
| `/messaging`, `/messaging/new`, `/messaging/[id]` | live | |
| `/negotiations` | banner | negotiations service |
| `/notifications` | live | |
| `/payments` | **live (FIXED this wave)** | `screens/payments/PaymentsList.tsx` now fetches paymentsService |
| `/payments/[id]`, `/payments/invoices`, `/payments/invoices/[id]` | live | |
| `/payments/arrears` | banner | arrears dunning service |
| `/payments/receive` | banner | cashier / MoMo intake |
| `/payments/record` | banner | lease + invoice ledger |
| `/properties`, `/properties/[id]`, `/properties/[id]/edit` | live | |
| `/reports`, `/reports/generate`, `/reports/scheduled` | live | |
| `/schedule` | live | |
| `/settings`, `/settings/help`, `/settings/notifications`, `/settings/profile`, `/settings/security` | live | |
| `/sla` | banner | SLA telemetry service |
| `/tenders` | banner | tenders marketplace |
| `/units` | **live (FIXED this wave)** | now fetches unitsService |
| `/units/new`, `/units/[id]/edit`, `/units/[id]/components`, `/units/[id]/subdivide` | live | |
| `/utilities`, `/utilities/bills`, `/utilities/readings` | live | |
| `/vendors`, `/vendors/new`, `/vendors/[id]` | live | |
| `/work-orders`, `/work-orders/new`, `/work-orders/[id]`, `/work-orders/[id]/triage` | live | |

Nav audit: `components/layout/BottomNavigation.tsx` = Dashboard `/`, Brain `/brain`, Coworker `/coworker`, Tasks `/work-orders`, Maint `/maintenance`. All 5 resolve (though `/maintenance` is banner). Dashboard quick-actions link to `/work-orders/new`, `/customers/new`, `/payments/receive`, `/payments`, `/leases`, `/units`, `/properties` — all now reach real pages except `/payments/receive` which remains a banner (needs M-Pesa/cash receive flow).

## Fixed this wave (6)

1. **apps/estate-manager-app/src/screens/payments/PaymentsList.tsx** — was `banner` — now `live` (fetches `paymentsService.list()` via `@tanstack/react-query`; renders loading, empty, error, success; links to `/payments/[id]`; "Receive" CTA goes to `/payments/receive`).
2. **apps/estate-manager-app/src/app/units/page.tsx** — was `banner` — now `live` (fetches `unitsService.list({page:1,pageSize:100})`; renders loading, empty, error, success; links to `/units/[id]/edit`; "Add" CTA goes to `/units/new`).
3. **apps/estate-manager-app/src/app/inspections/page.tsx** — was `banner` — now `live` (fetches `inspectionsService.list()`; renders loading, empty, error, success; links to `/inspections/[id]`).
4. **apps/customer-app/src/app/notifications/page.tsx** — was `banner` — now `live` (fetches `/api/v1/notifications` using the same inline fetch pattern as `messages/page.tsx`; renders loading, empty, error, success; honours `read`/`actionUrl` on each item).
5. **apps/owner-portal/src/app/budgets/page.tsx** — was pre-existing `broken` typecheck (readonly tuple into mutable `BarChart data`) — now `live` (type widened to `Array<...>`).
6. **apps/admin-portal/src/app/integrations/api-keys/page.tsx** — was pre-existing `broken` (used `MoreVertical` from lucide-react without importing it) — now `live` (import added).

All four apps' `pnpm typecheck` now passes.

## Still stub / banner (with reason)

These pages intentionally render `LiveDataRequiredPage` / `LiveDataRequiredScreen` — a system-wide policy from an earlier wave to never display mocked data. They are **not** broken; they are explicit "upstream service required" markers. Leaving them as banners unless the required integration is present was the deliberate design choice.

### admin-portal (13 banners)
- `pages/TenantsPage.tsx` — live tenant directory service.
- `pages/TenantDetailPage.tsx` — live tenant policy/billing/ops data.
- `pages/UsersPage.tsx` — identity / admin user-management API.
- `pages/support/CustomerTimeline.tsx` — cross-tenant event stream.
- `pages/support/Escalation.tsx` — live case queues + escalation.
- `pages/ai/AICockpit.tsx` — live governance / review / audit from AI service.
- `app/platform/billing/page.tsx` — platform billing integration.
- `app/platform/feature-flags/page.tsx` — flag store (Unleash/LaunchDarkly/OSS).
- `app/communications/broadcasts/page.tsx` — broadcast scheduler.
- `app/compliance/page.tsx`, `app/compliance/documents/page.tsx`, `app/compliance/data-requests/page.tsx` — compliance data-request / document services.
- `app/analytics/page.tsx`, `app/analytics/usage/page.tsx`, `app/analytics/growth/page.tsx` — analytics warehouse queries.
- (Also unrouted but present: `pages/TenantManagementPage.tsx`, `pages/BillingPage.tsx`, `pages/SupportToolingPage.tsx`, `pages/UserRolesPage.tsx`, `pages/ControlTowerPage.tsx` — legacy shims, not referenced from App.tsx.)

### customer-app (7 banners)
- `app/payments/bank-transfer/page.tsx` — bank-rail provider.
- `app/payments/mpesa/page.tsx` — M-Pesa initiation + callback.
- `app/payments/plan/page.tsx` — payment plan service.
- `app/maintenance/[id]/page.tsx` — request detail (comments + photos).
- `app/messages/[id]/page.tsx` — message thread detail service.
- `app/marketplace/page.tsx` — vendor catalog.
- `app/requests/[id]/page.tsx` — request detail with conversation.

### estate-manager-app (9 banners)
- `app/collections/page.tsx` + `screens/CollectionsPage.tsx` — collections + comms service.
- `app/maintenance/page.tsx` (via `screens/maintenance/MaintenanceDashboard.tsx`) — maintenance analytics.
- `app/negotiations/page.tsx` — negotiations service.
- `app/payments/arrears/page.tsx` — arrears dunning.
- `app/payments/receive/page.tsx` — cashier / MoMo receive flow.
- `screens/payments/RecordPayment.tsx` — lease + invoice ledger form.
- `screens/leases/LeaseForm.tsx` — lease authoring (needs unit + customer selectors).
- `app/sla/page.tsx` — SLA telemetry.
- `app/tenders/page.tsx` — tenders marketplace.
- `app/inspections/move-out/page.tsx`, `app/inspections/conditional-surveys/page.tsx` — specialised inspection workflows.
- `screens/WorkOrdersPage.tsx`, `screens/VendorsPage.tsx`, `screens/InspectionsPage.tsx`, `screens/OccupancyPage.tsx` — legacy screens NOT routed from `app/`; new `app/` paths already use live list components.

### owner-portal
- No banner-gated routed pages remain; all 34 routes render real data.

## Broken / missing components

None after this wave. The two broken typecheck errors were:
- `apps/owner-portal/src/app/budgets/page.tsx` — `readonly` → mutable widen.
- `apps/admin-portal/src/app/integrations/api-keys/page.tsx` — missing `MoreVertical` lucide import.

Both fixed. No routes reference missing page modules (all router imports resolve).

## Navigation repairs

No nav repairs were needed; every sidebar / bottom-nav item in all four apps routes to a component that exists. A handful of page components render the banner instead of data — those are documented above, not dead links.

## Primary user journeys

- **admin-portal** login → dashboard → properties (absent by design — admin has no property detail; uses `/tenants`) → tenants (banner) → leases (not in admin scope) → payments (banner via `/platform/billing`) → reports (live) → settings (`/configuration` live). **Journey reachable, with tenant directory + billing gated on upstream services.**
- **owner-portal** login → portfolio (live) → property detail (live) → financials (live) → reports (live) → settings (live). **Fully reachable end-to-end.**
- **customer-app** login → home (live) → lease (live) → payments (live list + history; M-Pesa init banner) → maintenance (live list, request detail banner) → messages (live list, thread detail banner) → my-credit (live). **Journey reachable; some leaf screens still banner-gated.**
- **estate-manager-app** login → my-day (`/` live) → inspections (now live) → work-orders (live) → tenants (`/customers` live) → properties (live) → settings (live). **Journey fully reachable after this wave.**

## Typecheck results

```
apps/admin-portal     : PASS
apps/owner-portal     : PASS
apps/customer-app     : PASS
apps/estate-manager-app: PASS
```

(`pnpm typecheck` from each app directory; no errors, no warnings above "> tsc --noEmit" noise.)

## Recommendations for Wave 19+

1. The banner pattern is now the single biggest UX drag. A policy decision is needed: either (a) allow banner pages to render the existing empty-state from the design-system when the backend returns `200 []`, so the UI shows "No payments yet" instead of a red alert, or (b) keep the current hard-gate and accept that 30+ screens remain unavailable until their backends ship.
2. The customer-app still uses inline `fetch` + manual state in many places. Introducing an app-wide typed fetcher (similar to admin-portal's `lib/api.ts`) would cut ~40 lines of boilerplate per page.
3. Estate-manager-app has duplicate stubs in `screens/` (`WorkOrdersPage.tsx`, `VendorsPage.tsx`, `InspectionsPage.tsx`, `OccupancyPage.tsx`, `CollectionsPage.tsx`) that are no longer referenced from the `app/` router. These can be deleted to reduce confusion.
