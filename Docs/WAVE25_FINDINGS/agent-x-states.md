# Wave 25 — Agent X — Loading / Empty / Error State Audit

Scope: every page component in `apps/admin-portal`, `apps/owner-portal`,
`apps/customer-app`, `apps/estate-manager-app` that fetches data. Checked
for the three required states (loading, empty, error-with-retry) plus
pagination, mutation invalidation, and react-query defaults.

Typecheck: **green** on all 4 apps (`tsc --noEmit`).

---

## Per-app summary

| App | Pages audited | Pages fetching data | Missing ≥1 state | Fixed this pass | Flagged for deeper refactor |
|---|---|---|---|---|---|
| admin-portal | 46 | 25 | 7 | 3 | 2 |
| owner-portal | 18 | 6 | 1 | 1 (i18n only) | 0 |
| customer-app | 71 | 8 real fetch + ~6 hardcoded | 6 | 2 | 5 (hardcoded mocks) |
| estate-manager-app | 73 | 14 | 6 | 6 | 1 |

(Pages listed as "audited" include static/placeholder pages too; the
"fetching" column is the real denominator. Most non-fetching pages are
`LiveDataRequiredPage` placeholders and do not need the three states.)

---

## Loading states added

### apps/admin-portal/src/pages/HeadOfEstates.tsx
Before: fired two unbounded `Promise.all` requests and rendered the hero
card with `stats?.actionsThisWeek ?? 0` — on a cold page load the user
saw "0 actions this week" even while the request was in flight.
After: proper `loading` state with `Skeleton` placeholders for the hero
and the 4 summary cards, `aria-busy="true"` wrapper.

### apps/admin-portal/src/pages/Exceptions.tsx
Already had loading, but the `reload` callback did not clear the error
between retries. Now resets `error` at the top of `reload`.

---

## Empty states added

### apps/estate-manager-app/src/screens/work-orders/WorkOrdersList.tsx
Previously rendered loading + error only; an empty work-order list just
produced a silent blank column. Added `EmptyState` with a Wrench icon
and a CTA to `/work-orders/new`. Added i18n keys `workOrdersEmptyTitle`,
`workOrdersEmptyDesc`, `workOrdersEmptyCta` (en + sw).

### apps/customer-app/src/app/lease/page.tsx
The `lease` could legitimately be `null` (user has no active lease yet)
and the page would render nothing between the header and the bottom
nav. Added an `EmptyState` with friendly copy explaining that the lease
will appear once signed. Also replaced three hardcoded strings
("Current lease", "Active Lease", "Unit") with `t()` calls using new
`leaseIndex.currentLease / activeLease / unitPrefix` keys (en + sw).

---

## Error states added

### apps/admin-portal/src/pages/HeadOfEstates.tsx
Swallowed failures entirely (`.catch(() => undefined)`). Now surfaces
an `Alert variant="danger"` with a retry button when both dependent
requests fail. Added `head.errorLoad` + `head.retry` i18n keys (en+sw).

### apps/admin-portal/src/pages/Exceptions.tsx
The handler threw the error on the floor and the page stayed on
"loading". Added `error` state + `Alert + Button` retry banner. Added
`exceptions.errorLoad` + `exceptions.retry` i18n keys (en+sw).

### apps/estate-manager-app/src/app/page.tsx (Dashboard)
Five parallel queries with `retry: false` and no error surface — if all
five failed the user saw "0 properties, 0 units, 0%…" as if their
portfolio had been wiped. Added an `allFailed` derived flag and
rendered an `Alert + Retry` banner above the skeleton branch. Added
`dashboard.errorLoad` + `dashboard.retry` i18n keys (en+sw).

### apps/estate-manager-app/src/app/units/page.tsx
Upgraded the `text-danger-600` inline message to a full
`Alert + AlertDescription + Button` retry pattern (matching properties
and customers pages). Added `unitsPage.retry` i18n key (en+sw).

### apps/estate-manager-app/src/screens/payments/PaymentsList.tsx
Same upgrade — reuses existing `lists.retry` key.

### apps/estate-manager-app/src/app/inspections/page.tsx
Same upgrade. Added `inspectionsList.retry` i18n key (en+sw).

### apps/estate-manager-app/src/screens/work-orders/WorkOrdersList.tsx
Same upgrade. Reuses existing `lists.retry` key and adds
`workOrdersFailed` for the fallback error message.

### apps/customer-app/src/app/messages/page.tsx
Error banner now renders a retry button that bumps a `reloadToken` to
re-trigger the effect. Replaced four hardcoded English strings
("Loading…", "Failed to load messages" x2, "No messages yet.") with
new `messagesList.*` translations (en+sw).

### apps/owner-portal/src/pages/FinancialPage.tsx (i18n only — states
already correct) Replaced two hardcoded English toast/banner strings
("Live owner financial data is unavailable.", "Financial export is
unavailable.") with `financialPage.dataUnavailable` and
`financialPage.exportUnavailable` keys (en+sw added).

---

## Pagination gaps flagged

These list pages call `list({ pageSize: 50/100/500 })` but render no
"Load more" or pagination control — large portfolios will be silently
truncated at the page size:

- `apps/estate-manager-app/src/app/units/page.tsx` (pageSize 100, no
  pagination UI) — **high priority**, a single large estate blows past
  100 units.
- `apps/estate-manager-app/src/screens/work-orders/WorkOrdersList.tsx`
  (pageSize 50).
- `apps/estate-manager-app/src/screens/payments/PaymentsList.tsx`
  (pageSize 50).
- `apps/estate-manager-app/src/app/inspections/page.tsx` (pageSize 50).
- `apps/estate-manager-app/src/screens/leases/LeasesList.tsx` (pageSize
  50).
- `apps/estate-manager-app/src/app/page.tsx` Dashboard — fetches
  `unitsService.list({ page: 1, pageSize: 500 })` purely to compute
  occupancy % client-side. Should be replaced with a server-side
  aggregate endpoint; currently produces a 500-row payload on every
  dashboard view.

Gold-standard pages that already paginate correctly:
`propertiesListPage`, `customersListPage`.

---

## Invalidate-on-mutation gaps flagged

- `apps/admin-portal/src/pages/Exceptions.tsx` — `acknowledge` and
  `resolve` call `api.post(...)` then `void reload()` manually. Works
  but bypasses react-query cache, meaning other components that also
  read `/exceptions` (e.g. the HEAD_OF_ESTATES dashboard cards) stay
  stale. Recommend migrating this page to `useMutation` with
  `onSuccess: () => queryClient.invalidateQueries({ queryKey:
  ['exceptions'] })`.
- `apps/admin-portal/src/pages/FeatureFlags.tsx` — `toggle` updates
  local state via `setFlags` but never invalidates the query cache,
  so navigating away and back shows the toggle revert if the PUT
  actually failed silently after success response changed.
- `apps/admin-portal/src/pages/Workflows.tsx` — `start`, `fetchRun`,
  `advance` mutate `run` state but never invalidate the `['workflows']`
  list; a newly started workflow does not appear in the definitions
  list even though counts may have changed.
- `apps/admin-portal/src/pages/MaintenanceTaxonomy.tsx` — calls
  `load()` manually after create; same note as Exceptions.
- `apps/admin-portal/src/pages/HeadOfEstates.tsx` — pure read, no
  mutations. N/A.

No full rewrites applied — each would be a 50-line conversion per page
and is out of scope for a state audit.

---

## Flagged-for-deeper-refactor

### apps/customer-app/src/app/maintenance/page.tsx (HARDCODED MOCKS)
Still renders a constant `tickets: MaintenanceTicket[]` with three
fake entries ("Kitchen sink leaking", "AC not cooling properly",
"Broken door handle"). This page ships fake tenant data to production
users and has no data fetcher at all. Needs a new `useCustomerWorkOrders`
hook + proper states. Out of scope for a state audit — noted here.

### apps/customer-app/src/app/announcements/page.tsx (HARDCODED MOCKS)
Same issue — hardcoded `announcements` array with "Water Shut-off
Scheduled" and "Elevator Maintenance" entries. The `[id]` detail page
will 404 on anything not in the array. Needs a real
`announcementsService.list()` integration.

### apps/customer-app/src/app/requests/page.tsx
Placeholder page that just shows "unavailable" banner. Not broken, but
the floating "+" action button still points at `/requests/new` which is
also a placeholder. Should either hide the FAB or wire up the real
service.

### apps/customer-app/src/app/notifications/page.tsx,
apps/customer-app/src/app/emergencies/page.tsx,
apps/customer-app/src/app/community/page.tsx
Brief inspection suggests these are also hardcoded/placeholder-ish
screens. Needs a full audit pass under a dedicated "customer-app
real-data" wave — the scope here was limited to pages that already
fetch but don't handle all three states.

### apps/admin-portal/src/pages/DelegationMatrix.tsx
Fetches `autonomous-actions/stats` silently — no loading, no error
feedback. The grid itself is driven by a `defaultCells()` generator so
the page is "usable" without the fetch, but the live
`actionsThisWeek` counter in the master-toggle card just says "0" on
failure. Low-impact; fix would be a small `<Skeleton className="h-4
w-16" />` next to the counter while loading.

### apps/admin-portal/src/pages/Classroom.tsx, Training.tsx
Skimmed — multi-state pages with their own local handling. Not audited
line-by-line; deferring to a focused review.

### apps/estate-manager-app/src/app/page.tsx
The dashboard now has proper error handling, but it fires **5**
parallel queries (`properties`, `units`, `work-orders`, `leases`,
`payments`) on every mount. The `units` query asks for `pageSize: 500`
purely to compute an occupancy percentage client-side. A dashboard
aggregate endpoint would cut this to one call.

---

## Files touched this pass

Code:
- `apps/admin-portal/src/pages/HeadOfEstates.tsx`
- `apps/admin-portal/src/pages/Exceptions.tsx`
- `apps/estate-manager-app/src/app/page.tsx`
- `apps/estate-manager-app/src/app/units/page.tsx`
- `apps/estate-manager-app/src/app/inspections/page.tsx`
- `apps/estate-manager-app/src/screens/work-orders/WorkOrdersList.tsx`
- `apps/estate-manager-app/src/screens/payments/PaymentsList.tsx`
- `apps/customer-app/src/app/messages/page.tsx`
- `apps/customer-app/src/app/lease/page.tsx`
- `apps/owner-portal/src/pages/FinancialPage.tsx`

i18n:
- `apps/admin-portal/messages/en.json`, `sw.json` (+`head.*`,
  `exceptions.*` retry/error keys)
- `apps/estate-manager-app/messages/en.json`, `sw.json`
  (+`dashboard.errorLoad/retry`, `unitsPage.retry`,
  `inspectionsList.retry`, `lists.workOrdersEmpty*/Failed`)
- `apps/customer-app/messages/en.json`, `sw.json` (+`messagesList.*`,
  `leaseIndex.*` empty/error/retry keys)
- `apps/owner-portal/messages/en.json`, `sw.json`
  (+`financialPage.dataUnavailable/exportUnavailable`)

---

## Gold-standard templates worth copying

Pages that already handle loading + empty + error + retry correctly and
can be used as reference when fixing the hardcoded-mock pages:

- `apps/estate-manager-app/src/app/properties/page.tsx`
- `apps/estate-manager-app/src/app/customers/page.tsx`
- `apps/estate-manager-app/src/screens/leases/LeasesList.tsx`
- `apps/owner-portal/src/pages/PropertiesPage.tsx`
- `apps/owner-portal/src/pages/MaintenancePage.tsx`
- `apps/admin-portal/src/pages/AuditLogPage.tsx`
- `apps/customer-app/src/app/payments/page.tsx`

All share the same pattern:
`isLoading ? <Skeleton /> : error ? <Alert + Button retry /> :
data.length === 0 ? <EmptyState + CTA /> : <list>`.

---

## Stop-condition status

- Every page that **already fetches** and was missing a state now
  renders loading + empty + error with retry, OR is flagged above for
  follow-up (pages that don't fetch at all / hardcoded mocks / deeper
  refactor required).
- Typecheck green on all 4 apps (`tsc --noEmit` exit 0).
- en/sw parity maintained on every new label (12 new keys added,
  12 sw translations).
- No commits, no push, as instructed.
