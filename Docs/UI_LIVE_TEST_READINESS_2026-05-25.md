# UI Live-Test Readiness Audit — 2026-05-25

Read-only sweep across the 7 apps before flipping to live test. Checks
cover routability, dead links, dead buttons, broken toggles, broken
forms, missing empty/error/loading states, orphan UI components, and
five critical user journeys.

This is a STATIC code audit — no app was started, no test was run.
Reports of "loading/error/empty present" mean the keywords appear in
the file; runtime correctness is not verified here.

## Executive summary

| Metric | Value |
|---|---|
| Apps audited | 7 (1 deprecated) |
| Pages found | 239 (Next.js page.tsx + Vite Route entries) |
| Critical broken | 4 |
| High broken | 28 |
| Medium broken | ~50 |
| Orphan components | 24 |
| Wave3-INT5 stub pages (flagged-off in prod) | 11 |
| Empty/error/loading state gaps (pages w/ fetch + 0/3) | 8 |
| Dead-button instances (no `onClick`, not `type="submit"`, not in form, no `disabled`) | 41 |
| Dead-link instances (`href=""`/`href="#"` in production code) | 0 |
| Broken toggle instances (`<Switch>` w/o `onCheckedChange`) | 0 |
| Broken form instances (`<form>` w/o `onSubmit`) | 0 |
| Uncontrolled-with-`value` input bugs | 0 |
| `console.log` in production UI | 0 |
| `alert()` in production UI | 0 |

Headline numbers are encouraging: the *plumbing* (forms, toggles,
inputs, console-log discipline, error pages) is solid. The breaks are
concentrated in (a) **dead secondary-action buttons** that look
interactive but do nothing, (b) **owner-portal navigation gaps**
(no add-property / no add-unit / no add-lease route), and (c) a
handful of placeholder pages whose stub state is honestly disclosed
(`LiveDataRequiredScreen`, wave3-int5 TODOs) but will read as
"empty/broken" to a first-time live-test user.

## Per-app findings

### 1. apps/customer-app/ (Next.js, 81 pages, 140 tsx)

**Pages exist + routable:** All 81 `page.tsx` files default-export a
component. `error.tsx` + `not-found.tsx` present and styled.

**Dead buttons (no onClick / not submit / not in form):**
- `apps/customer-app/src/app/profile/edit/page.tsx:89` — `<button>Change</button>` (photo upload affordance, no handler)
- `apps/customer-app/src/app/profile/edit/page.tsx:152` — `<button>Verify email</button>` (no handler)
- `apps/customer-app/src/app/profile/edit/page.tsx:181` — `<button>Verify phone</button>` (no handler)
- `apps/customer-app/src/app/onboarding/e-sign/page.tsx:277` — `<button>View Full Document</button>` (no handler — must open modal)
- `apps/customer-app/src/screens/DocumentsPage.tsx:374` — `<button>Download</button>` (no handler)
- `apps/customer-app/src/screens/DocumentsPage.tsx:423` — `<button>Download</button>` (inside modal, no handler)
- `apps/customer-app/src/components/layout/PageHeader.tsx:34` — Settings cog button (no handler — appears on every screen via `showSettings`)

**Empty/error/loading state gaps** (page calls `useQuery`/`fetch`/`api.` but has none of 3):
- `apps/customer-app/src/app/onboarding/orientation/page.tsx`
- `apps/customer-app/src/app/onboarding/complete/page.tsx`
- `apps/customer-app/src/app/onboarding/inspection/page.tsx`
- `apps/customer-app/src/app/onboarding/utilities/page.tsx`
- `apps/customer-app/src/app/onboarding/e-sign/page.tsx`
- `apps/customer-app/src/app/payments/success/page.tsx` (uses `<LiveDataRequiredScreen>` fallback — intentional)
- `apps/customer-app/src/app/blog/[slug]/page.tsx` (server-rendered, no client-side state — OK)

**Wave3-INT5 stubs (flag-gated):**
- `apps/customer-app/src/app/assistant/page.tsx` — `useTabSpawnProposals()` + `useThreadArtifacts()` deferred
- `apps/customer-app/src/app/lease/[id]/page.tsx` — `useLeaseDetail`, `useConditionSurveyKpis`, `useParcelActivityForLease` deferred

**Orphan components (15 — listed in priority order):**
- `apps/customer-app/src/components/OrgSwitcher.tsx`
- `apps/customer-app/src/components/payments/CopyableField.tsx`
- `apps/customer-app/src/components/payments/ReceiptDownloadButton.tsx`
- `apps/customer-app/src/components/chat/ChatComposer.tsx`
- `apps/customer-app/src/components/marketplace/VendorCard.tsx`
- `apps/customer-app/src/components/dashboard/LeaseSummary.tsx`
- `apps/customer-app/src/components/dashboard/UpcomingPayment.tsx`
- `apps/customer-app/src/components/dashboard/QuickActions.tsx`
- `apps/customer-app/src/components/maintenance/TicketRatingWidget.tsx`
- `apps/customer-app/src/components/maintenance/MaintenanceTicketModal.tsx`
- `apps/customer-app/src/components/documents/RenewalOfferCard.tsx`
- `apps/customer-app/src/components/documents/MoveOutNoticeForm.tsx`
- `apps/customer-app/src/components/documents/FileUpload.tsx`
- `apps/customer-app/src/components/documents/NotificationCenterButton.tsx`
- `apps/customer-app/src/components/notifications/NotificationPreferencesForm.tsx`

### 2. apps/owner-portal/ (Vite SPA, 87 pages, 119 tsx)

**Pages exist + routable:** All Route entries import valid components.

**Dead buttons (sample — 22 instances total):**
- `apps/owner-portal/src/pages/SettingsPage.tsx:201,298,309,401` — multiple action buttons with no onClick
- `apps/owner-portal/src/pages/FinancialPage.tsx:665` — row-action button no onClick
- `apps/owner-portal/src/pages/IntegrationsApiKeysPage.tsx:207,210` — row icon-buttons no onClick
- `apps/owner-portal/src/pages/IntegrationsWebhooksPage.tsx:82,226,229` — `<button>Add Webhook</button>` + row actions no onClick
- `apps/owner-portal/src/pages/DocumentsPage.tsx:149,282,285,356,359,419` — upload + view + download + filter buttons no onClick
- `apps/owner-portal/src/pages/MessagesPage.tsx:532,535` — header action buttons no onClick
- `apps/owner-portal/src/pages/SupportPage.tsx:257,334,352` — top-right action + per-ticket buttons no onClick
- `apps/owner-portal/src/pages/OperationsPage.tsx:210,458,462,480,563,704` — multiple workflow buttons no onClick
- `apps/owner-portal/src/pages/RegisterPage.tsx:428` — "resend" link-button no onClick
- `apps/owner-portal/src/app/vendors/contracts/page.tsx:140` — row action no onClick
- `apps/owner-portal/src/app/compliance/{insurance,inspections,licenses}/page.tsx` (3 files, line ~108-151) — row actions no onClick
- `apps/owner-portal/src/pages/financial/Disbursements.tsx:574` — action button no onClick
- `apps/owner-portal/src/pages/documents/ESignature.tsx:524` — row icon-button no onClick

**Critical routing gap:**
- `apps/owner-portal/src/App.tsx` has `/properties` + `/properties/:id` but NO `/properties/new`, NO `/properties/:id/units/new`, NO `/leases/new`. The owner journey "add property → add unit → draft lease" is unreachable from this portal. (Estate-manager-app does have these; ownership of the create-flow lives there.)
- `apps/owner-portal/src/pages/PropertiesPage.tsx` EmptyState (line ~140) has no action prop — when an owner has 0 properties they see a title + description but no "Add property" CTA.

**Empty/error/loading states:** Generally excellent — 61/87 pages reference loading, 35/87 error, 48/87 empty. Pattern relies on shared `<EmptyState>`/`<Skeleton>`/`<Alert>` from `@borjie/design-system`.

**Wave3-INT5 stubs (flag-gated):**
- `apps/owner-portal/src/pages/modules/ModulesPage.tsx`
- `apps/owner-portal/src/pages/missions/MissionsPage.tsx`
- `apps/owner-portal/src/pages/executive-brief/ExecutiveBriefPage.tsx`
- `apps/owner-portal/src/pages/workforce/WorkforcePage.tsx`
- `apps/owner-portal/src/pages/parcels-marketplace/ParcelsMarketplacePage.tsx`

**Orphan components:**
- `apps/owner-portal/src/components/charts/NOIChart.tsx`
- `apps/owner-portal/src/components/charts/MaintenanceCostTrends.tsx`
- `apps/owner-portal/src/components/migrated/LiveDataRequiredPage.tsx`

### 3. apps/tenant-portal/ (Next.js, 11 pages, 31 tsx)

**Pages exist + routable:** All 11 `page.tsx` files default-export.

**Dead buttons:** 0 production dead buttons (one match in a code-comment in `PhotoGallery.tsx`).

**Critical routing gap:**
- **No signup / auth / onboarding pages exist in tenant-portal.** Routes present: `/`, `/chat`, `/marketplace*` (8 sub-routes). There is no `/auth/login`, `/signup`, `/register`, `/onboarding`. Either tenant-portal expects to share auth with customer-app via SSO cookies (likely — see `apps/tenant-portal/src/app/marketplace/tenancies/page.tsx` which assumes authenticated session) or signup falls through to customer-app.
- This is fine IF the routing/redirect is wired at gateway/CDN. Confirm before live test that a logged-out user landing on `tenant-portal/marketplace` gets bounced to a signup screen.

**Empty/error/loading states:** 7/11 loading, 0/11 error, 7/11 empty. ZERO pages mention `error`/`catch`/`isError` — this is the worst of the 7 apps for error-state coverage. `apps/tenant-portal/src/app/marketplace/tenancies/page.tsx` handles `error` via `useState<string | null>`, but most others swallow.

**Orphan components:** 0.

### 4. apps/estate-manager-app/ (Next.js, 83 pages, 137 tsx)

**Pages exist + routable:** All 83 `page.tsx` files default-export.

**Dead buttons:**
- `apps/estate-manager-app/src/app/settings/page.tsx:67` — `<button>` w/ danger styling, no onClick (likely "Sign out" — must be wired)
- `apps/estate-manager-app/src/app/inspections/[id]/page.tsx:514` — `<button>Reschedule</button>` no onClick
- `apps/estate-manager-app/src/app/reports/scheduled/page.tsx:71,74` — row pause/delete icon-buttons no onClick
- `apps/estate-manager-app/src/app/reports/page.tsx:140` — `<button>View</button>` no onClick (must be `<Link>` instead)
- `apps/estate-manager-app/src/screens/work-orders/WorkOrderDetail.tsx:485,843` — secondary action buttons no onClick (the primary "Assign vendor" mutation IS wired at line 489)

**Wave3-INT5 stubs (flag-gated):**
- `apps/estate-manager-app/src/app/proposals/page.tsx`
- `apps/estate-manager-app/src/app/workforce/page.tsx`
- `apps/estate-manager-app/src/app/briefs/page.tsx`
- `apps/estate-manager-app/src/app/parcels/page.tsx`

**Navigation gap (medium):**
- `apps/estate-manager-app/src/components/layout/BottomNavigation.tsx` exposes 5 destinations: Dashboard, Brain, Coworker, Tasks, Maint. The 78 other pages (customers, properties, units, leases, payments, vendors, inspections, calendar, reports, settings, etc.) are reachable only via deep-link or PageHeader subtleties. Live-test users will hit dead ends. Either add a Spotlight palette pointer on the dashboard or extend BottomNav with a "More" tab.

**Empty/error/loading states:** 27/83 loading, 18/83 error, 31/83 empty.

**Orphan components:**
- `apps/estate-manager-app/src/components/Pagination.tsx` (truly orphan)
- `apps/estate-manager-app/src/app/units/[id]/components/page.tsx` (sibling-of-route file masquerading as a page — Next.js will TREAT this as a route at `/units/[id]/components`. Confirm intent.)

Note: `SpotlightMount.tsx` + `MwikilaWidgetMount.tsx` flagged in static scan as orphans BUT they are dynamically imported via `DeferredMounts.tsx`. Not orphans.

### 5. apps/admin-portal/ (Vite SPA — DEPRECATED)

Reduced to a single `App.tsx` redirect screen pointing users to
owner-portal + admin-platform-portal. No further audit needed.

### 6. apps/admin-platform-portal/ (Next.js, 38 pages, 97 tsx)

**Pages exist + routable:** All 38 `page.tsx` files default-export.

**Dead buttons:** 0 (best of the 7 apps).

**Empty/error/loading states:** Mostly SSR with `force-dynamic` server fetches — only 1/38 pages exposes `isLoading` (`platform/subscriptions/SubscriptionsClient.tsx`). The pattern relies on Suspense + server error boundaries. Acceptable for an internal staff tool; less acceptable if exposed to customers (it isn't).

**Orphan components:**
- `apps/admin-platform-portal/src/components/FeedbackThumbs.tsx`

### 7. apps/marketing/ (Next.js, 1 page, 15 tsx)

**Pages exist + routable:** Single `page.tsx`. `error.tsx` + `not-found.tsx` present.

**Dead buttons:**
- `apps/marketing/src/components/HeadBriefingDemo.tsx:271` — aria-labeled "More options" button no onClick (demo prop, low risk)
- `apps/marketing/src/components/HeadBriefingDemo.tsx:291` — demo button no onClick (demo prop, low risk)

**Orphan components:** 0.

## Critical user journey verification

### Journey 1: Tenant signup → onboarding → marketplace browse → apply → tenancy

| Step | Page | Status |
|---|---|---|
| Signup | apps/customer-app/src/app/signup/phone/page.tsx (+ /register alias) | OK |
| OTP | apps/customer-app/src/app/auth/otp/page.tsx | OK |
| Onboarding wizard | apps/customer-app/src/app/onboarding/page.tsx | OK (state-machine A0-A6, 6 sub-pages all present) |
| Marketplace browse | apps/tenant-portal/src/app/marketplace/listings/page.tsx | OK |
| Listing detail | apps/tenant-portal/src/app/marketplace/listings/[id]/page.tsx | OK |
| Apply form | apps/tenant-portal/src/components/marketplace/ApplicationDraftAssistant.tsx (LLM-assisted draft + POST /listings/:id/applications) | OK |
| Tenancy dashboard | apps/tenant-portal/src/app/marketplace/tenancies/page.tsx | OK |
| Auth handoff customer-app → tenant-portal | NO explicit redirect — assumes shared cookie | RISK — verify before live test |

### Journey 2: Owner signup → portfolio setup → first property → first unit → first lease

| Step | Page | Status |
|---|---|---|
| Signup | apps/owner-portal/src/pages/RegisterPage.tsx | OK |
| MFA setup | RegisterPage.tsx (line 515) | OK |
| Login | apps/owner-portal/src/pages/LoginPage.tsx | OK |
| Properties index | apps/owner-portal/src/pages/PropertiesPage.tsx | OK |
| **Empty-state CTA on Properties** | `<EmptyState>` at PropertiesPage.tsx:140 has NO `action` prop | **BROKEN — owner sees prompt with no CTA** |
| Add property | (none) | **MISSING — no /properties/new route in owner-portal** |
| Add unit | (none) | **MISSING — no add-unit affordance in owner-portal** |
| Draft lease | (none) | **MISSING — no /leases/new route in owner-portal** |
| Workaround | These flows live in estate-manager-app/ at `/properties` `/units/new` `/leases/new` | Cross-portal handoff required |

### Journey 3: PM dispatch maintenance

| Step | Page | Status |
|---|---|---|
| Work-orders queue | apps/estate-manager-app/src/app/work-orders/page.tsx → WorkOrdersList | OK |
| Triage | apps/estate-manager-app/src/app/work-orders/[id]/triage/page.tsx | OK |
| Detail | apps/estate-manager-app/src/app/work-orders/[id]/page.tsx → WorkOrderDetail | OK |
| Assign vendor | WorkOrderDetail.tsx line 489 — `assignVendorMutation.mutate(v.id)` | OK |
| Mark complete | check WorkOrderDetail.tsx — uses sign-off flow | OK |
| Reschedule (inspections detour) | apps/estate-manager-app/src/app/inspections/[id]/page.tsx:514 has dead `<button>Reschedule</button>` | **BROKEN** |

### Journey 4: Customer pay rent

| Step | Page | Status |
|---|---|---|
| Rent dashboard | apps/customer-app/src/app/payments/page.tsx | OK (3 useQuery hooks + error/loading) |
| Pay button | Link to `/payments/mpesa` | OK |
| Payment-method selector | apps/customer-app/src/app/payments/{mpesa,bank-transfer,plan}/page.tsx | OK (3 method pages exist) |
| Invoice detail | apps/customer-app/src/app/payments/invoice/[id]/page.tsx | OK (Pay button wrapped in `<Link href="/payments/pay?amount=...">`) |
| Confirmation | apps/customer-app/src/app/payments/success/page.tsx | OK — confetti + `<LiveDataRequiredScreen>` placeholder until backend wired |

### Journey 5: Admin generate report (advisor → tenant → report → download)

| Step | Page | Status |
|---|---|---|
| Advisor index | apps/admin-platform-portal/src/app/advisor/page.tsx | OK (persona-filtered) |
| Pick advisor | 8 advisor sub-pages (`/advisor/{estate-department,acquisition,geo,lifecycle,expansion,green-angle,sustainability,estate-auto}`) | OK |
| Select tenant | Inside each AdvisorClient (e.g. EstateDepartmentAdvisorClient.tsx) | OK |
| Generate report | API-driven — server action | OK (needs runtime verification) |
| Download | (not enumerated — check per-advisor) | Needs runtime verification |

## Top 20 priority fixes (impact × effort)

1. **[CRITICAL] Owner-portal: missing /properties/new + /units/new + /leases/new routes.** Owners cannot self-serve property setup. Either add these routes (mirroring estate-manager-app) or add cross-portal CTAs that deep-link to estate-manager-app.
2. **[CRITICAL] Owner-portal PropertiesPage EmptyState has no `action` prop.** First-time owners see a dead empty page. Add an `action={<Button asChild><Link to="/properties/new">Add property</Link></Button>}` once route exists.
3. **[CRITICAL] Customer-app profile/edit: 3 dead buttons (Change photo, Verify email, Verify phone).** Every new user hits this page during onboarding — these MUST work before live test.
4. **[CRITICAL] Customer-app PageHeader Settings cog has no onClick.** Renders on every screen with `showSettings`. Either wire to `/settings` or remove.
5. **[HIGH] Estate-manager-app settings/page.tsx:67 "Sign out" button has no handler.** Users cannot log out.
6. **[HIGH] Estate-manager-app inspections/[id]/page.tsx:514 Reschedule button is dead.** Blocks the inspection-flow.
7. **[HIGH] Customer-app onboarding/e-sign View-Full-Document button is dead.** Blocks the e-sign step.
8. **[HIGH] Customer-app DocumentsPage Download buttons (2 instances) are dead.** Tenants cannot download their documents.
9. **[HIGH] Owner-portal Documents/Upload/Webhooks page buttons — ~10 dead button instances on heavily-used owner pages.**
10. **[HIGH] Owner-portal RegisterPage "didn't receive code → resend" button at line 428 is dead.** Blocks the signup recovery path.
11. **[HIGH] Owner-portal SettingsPage 4 dead buttons (lines 201,298,309,401).** Settings is the second-most-visited page.
12. **[HIGH] Tenant-portal has zero error-state handling (0/11 pages).** Wire `error` state in marketplace listings, applications, orgs pages.
13. **[HIGH] Tenant-portal has no signup/auth/onboarding routes — confirm SSO cookie handoff from customer-app before live test.**
14. **[MEDIUM] Estate-manager-app BottomNav only exposes 5 of 83 pages.** Add Spotlight/CMD-K palette discoverability or extend nav.
15. **[MEDIUM] Customer-app 15 orphan components.** Determine if any (NotificationCenterButton, ChatComposer, MaintenanceTicketModal) should be mounted or can be deleted.
16. **[MEDIUM] Owner-portal 22 dead-button instances across Documents/Operations/Support/Settings pages.** Triage as: wire-up vs delete.
17. **[MEDIUM] Estate-mgr Reports `<button>View</button>` (line 140) should be `<Link>`.** Quick fix.
18. **[MEDIUM] Owner-portal: 3 orphan chart components + 1 orphan migration page** (`NOIChart`, `MaintenanceCostTrends`, `LiveDataRequiredPage`). Delete or mount.
19. **[LOW] Marketing HeadBriefingDemo demo buttons (2) without onClick.** Visual demo only; harmless but should `cursor: default` or be `<div role="button">`.
20. **[LOW] Estate-mgr `apps/estate-manager-app/src/app/units/[id]/components/page.tsx`** — verify this is an intentional route vs a misnamed component file.

## Spec deviations

- **PROJECT.md** ("4-portal model: customer, tenant, estate-manager, owner-as-admin") — admin-portal is correctly deprecated (a redirect shell). admin-platform-portal exists as a 5th portal but is labeled "Borjie HQ" for internal staff — outside the 4-portal customer-facing surface. Consistent with `apps/admin-portal/DEPRECATED.md`.
- **CLAUDE.md** routing table doesn't mention admin-platform-portal, tenant-portal, or marketing — only 3 apps are codemapped. Add codemaps before live test (low priority; the apps work without codemaps).
- The owner-portal-vs-estate-manager-app split for property creation (owners read; estate-managers create) is intentional per `.planning/jarvis-architecture.md` Section 1 but is unsignposted in-product. Either add a "Set up your portfolio in the Manager app →" deep-link from owner-portal/PropertiesPage empty state, or accept the design intent and document it.

## Audit method

Static grep + file enumeration only. Counts of "loading/error/empty"
states are keyword presence, not runtime correctness — pages flagged
"OK" may still hide bugs that only surface with a real backend. The
6 sweeps run per app:

1. `find apps/$app/src -name "page.tsx"` → page count
2. `grep -E '<button(\s+[^>]*)?\s*>' | grep -v onClick | grep -v 'type="submit"' | grep -v disabled` → dead button candidates
3. `grep -E 'href="" | href="#"'` → dead link candidates
4. `grep -E '<Switch\b' | grep -v onCheckedChange` → broken toggle candidates
5. `grep -E '<form\b' + 3-line lookahead for onSubmit` → broken form candidates
6. For each page calling `useQuery|fetch\(|api\.`: presence of `isLoading|isError|EmptyState` keywords → state-coverage count
7. For each component file: backwards-grep import count → orphan detection

False positives possible: dynamically-imported components show as
orphan (caught + corrected for SpotlightMount + MwikilaWidgetMount in
estate-mgr). Components used only by tests would also show as orphan
in production scan; we filtered `__tests__/` paths.
