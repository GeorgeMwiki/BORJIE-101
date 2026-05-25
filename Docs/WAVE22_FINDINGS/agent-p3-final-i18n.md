# Wave 22 Agent P3 — Final i18n Mass-Wrap Pass

## Truthful bottom line

**Target was ZERO. Final residual is NOT zero.** The remaining hardcoded-string
surface across the 4 apps totals **1,622 strings** (1,299 JSX-content + 323
HTML-attribute). A single agent pass cannot mass-wrap ~1,700 strings while
preserving typecheck, keeping en/sw parity, and producing natural Swahili —
each string requires 3–5 edits (source + en + sw + namespace plumbing), so a
true zero-drive would require 5,000+ edits.

This pass made a clean, verified dent in the most user-visible surfaces
(landing pages, subscriptions, webhooks, onboarding, announcement creation)
across all four apps, with 100 % typecheck on each. The per-app residuals
and what they actually contain are itemised below.

## Per-app residual counts (before → after this pass)

| App                 | JSX-content before | JSX-content after | Attr before | Attr after |
|---------------------|-------------------:|------------------:|------------:|-----------:|
| admin-portal        |                330 |               289 |          53 |         50 |
| owner-portal        |                441 |               430 |          39 |         39 |
| customer-app        |                258 |               237 |         104 |        104 |
| estate-manager-app  |                353 |               343 |         133 |        130 |
| **Totals**          |          **1,382** |         **1,299** |     **329** |    **323** |

Net strings wrapped this pass: **~89** (JSX + a few attrs).
Most high-traffic entry points (home screens, subscriptions list, webhooks
admin, customer-app onboarding wizard, estate-manager announcement composer)
are now fully i18n-clean.

## Strings wrapped this pass (explicit list)

### admin-portal (~48 strings, 4 files)
- `src/app/page.tsx` — 20 strings (entire landing page: cards, buttons)
- `src/app/platform/overview/page.tsx` — 14 strings (KPIs, charts, quick
  actions, "Active Tenants", "Platform Users", "Monthly Revenue",
  "Units Managed", "Revenue Trend", "Tenant Growth", "Quick Actions",
  "Subscriptions", "Billing", "Feature Flags", "View Tenants")
- `src/app/platform/subscriptions/page.tsx` — 21 strings (title, subtitle,
  stats, filters, table columns, empty state, error message, Retry, Manage)
- `src/app/integrations/webhooks/page.tsx` — 14 strings (title, subtitle,
  Add Webhook, stats, filters, error message, Retry)

### owner-portal (~11 strings, 1 file)
- `src/app/page.tsx` — 11 strings (welcome header, all 3 KPI cards,
  View All Properties)

### customer-app (~21 strings, 1 file)
- `src/screens/OnboardingPage.tsx` — 21 strings (header, step titles &
  descriptions via key-lookup map, welcome body, ID upload section,
  selfie flow, security note, inspection section, 3 tip cards, signature
  flow, terms agreement, nav buttons, "Completing…", "Complete Setup")

### estate-manager-app (~14 strings, 1 file)
- `src/app/announcements/create/page.tsx` — 14 strings (page title,
  form labels, placeholders, priority options, property select,
  expiry date label, pin-to-top, Cancel, Publish)

## New namespaces

### admin-portal (6 new)
- `adminHome` (20 keys)
- `platformOverview` (18 keys)
- `platformSubscriptions` (22 keys)
- `apiKeys` (3 keys)
- `webhooks` (12 keys)
- `integrationsPage` (1 key)

### owner-portal (1 new)
- `ownerHome` (11 keys)

### customer-app (1 new)
- `onboarding` (46 keys)

### estate-manager-app (1 new)
- `announcementsCreate` (15 keys)

## Final verification

### Typecheck exit codes (all zero)

| App                | `pnpm --filter <app> typecheck` |
|--------------------|---------------------------------|
| admin-portal       | 0 (pass)                        |
| owner-portal       | 0 (pass)                        |
| customer-app       | 0 (pass)                        |
| estate-manager-app | 0 (pass)                        |

### en/sw key parity (100 % identical per app)

| App                | en keys | sw keys | Parity |
|--------------------|--------:|--------:|:------:|
| admin-portal       |     589 |     589 | OK     |
| owner-portal       |     371 |     371 | OK     |
| customer-app       |     320 |     320 | OK     |
| estate-manager-app |     192 |     192 | OK     |

### Grep-enumeration residual proof (per app)

```
admin-portal: jsx=289 attrs=50
owner-portal: jsx=430 attrs=39
customer-app: jsx=237 attrs=104
estate-manager-app: jsx=343 attrs=130
```

These counts are live at session end (verified with the same grep
invocations in the task brief).

## Highest-concentration residual files (for follow-up Wave 23)

### admin-portal (top 8 files, 189 of 289 remaining JSX strings)
1. `src/pages/tenants/OnboardingWizard.tsx` — 87 strings (5-step wizard,
   large component with many unique labels)
2. `src/pages/roles/ApprovalMatrix.tsx` — 34 strings
3. `src/pages/SupportPage.tsx` — 16 strings
4. `src/pages/TenantCredit.tsx` — 15 strings
5. `src/pages/RolesPage.tsx` — 14 strings
6. `src/pages/ConfigurationPage.tsx` — 14 strings
7. `src/pages/ReportsPage.tsx` — 10 strings
8. `src/app/communications/campaigns/page.tsx` — 10 strings

### owner-portal (top 7 files, 196 of 430 remaining JSX strings)
1. `src/pages/FinancialPage.tsx` — 73 strings
2. `src/pages/RegisterPage.tsx` — 37 strings
3. `src/pages/financial/Disbursements.tsx` — 26 strings
4. `src/components/WorkOrderDetailModal.tsx` — 17 strings
5. `src/pages/DocumentsPage.tsx` — 14 strings
6. `src/components/CoOwnerInviteModal.tsx` — 13 strings
7. `src/app/tenants/[id]/page.tsx` — 13 strings

### customer-app (top 8 files, 99 of 237 remaining JSX strings)
1. `src/screens/DocumentsPage.tsx` — 13 strings
2. `src/screens/MaintenancePage.tsx` — 12 strings
3. `src/app/onboarding/inspection/page.tsx` — 12 strings
4. `src/app/onboarding/complete/page.tsx` — 11 strings
5. `src/app/requests/letters/page.tsx` — 10 strings
6. `src/app/payments/page.tsx` — 10 strings
7. `src/app/maintenance/new/page.tsx` — 10 strings
8. `src/app/lease/page.tsx` — 9 strings

### estate-manager-app (top 9 files, 168 of 343 remaining JSX strings)
1. `src/screens/work-orders/WorkOrderDetail.tsx` — 40 strings
2. `src/app/inspections/[id]/page.tsx` — 19 strings
3. `src/app/units/new/page.tsx` — 16 strings
4. `src/features/migration/MigrationWizard.tsx` — 15 strings
5. `src/screens/vendors/VendorForm.tsx` — 14 strings
6. `src/components/work-orders/DualSignOff.tsx` — 14 strings
7. `src/app/units/[id]/edit/page.tsx` — 14 strings
8. `src/app/properties/[id]/edit/page.tsx` — 14 strings
9. `src/screens/work-orders/WorkOrderTriage.tsx` — 11 strings

## Strings intentionally NOT wrapped (categories observed)

The grep residual includes a meaningful (but small) fraction of false
positives that should not be wrapped. Seen in spot checks:

- **Brand names**: "BORJIE", "Sunset Apartments", "Riverside Towers"
  (property-name demo fixtures — should be data-driven, not translated).
- **Language labels**: "English", "Swahili" inside locale-switcher
  dropdowns (these are auto-translated by intent — a Swahili user sees
  "English" to choose it, which is the accessibility-correct pattern).
- **Currency codes**: "KES", "USD", "UGX", "Ugandan Shilling (UGX)" —
  ISO codes should not be translated; the "(UGX)" form has a trailing
  English label that could be wrapped, low priority.
- **Technical identifiers**: "MRR", "KPI", "JSON", "DLQ", "SKU", "API",
  "URL", "IoT", "GePG".
- **Chart axis month tokens**: "Aug", "Sep", "Oct"… (these are data-
  values in `revenueData`/`tenantGrowthData` arrays, not UI strings;
  should be formatted via `Intl.DateTimeFormat` in a follow-up).
- **Lucide / recharts prop values**: `strokeDasharray="3 3"`,
  `stopColor="#8b5cf6"` — these are *not* user-visible; grep caught
  nothing here because the pattern filters for `>[A-Z][a-z]…<` content.

Specific common residuals still hitting the grep regex that are real
user-visible strings and SHOULD be wrapped in a follow-up wave:

- "Active" (5× — filter/status labels on various pages)
- "All Status", "Past Due", "Tenant", "Scheduled", "Running", "Failing",
  "Completed", "In Progress", "Open", "Inactive", "Trialing",
  "Platform", "Property Manager"
- "Last 7 days", "Last 30 days", "Last 90 days" (time-range filters)
- "No data." (empty-state messages)
- "Typing…", "Total Webhooks", "Total Units", "User Roles", "Units",
  "Users", "Unit", "Trigger", "Website", "Webhooks", "Weakest factor",
  "Value (JSON)", "Valid for (days)", "Visual editor for role-permission
  assignments", "Very poor (<450)", "You have unsaved changes"

## Recommended Wave 23 strategy

To reach actual zero, a subsequent pass should:

1. Create a shared `common` / `filters` / `statuses` namespace across
   apps (re-used strings: "Active", "All Status", "Past Due", etc.)
   so each literal is wrapped once and re-used.
2. Wrap the big per-page components individually with dedicated
   namespaces (OnboardingWizard, FinancialPage, WorkOrderDetail).
3. Tackle placeholder/title/aria-label attributes as a separate sweep
   (323 remaining across apps — these need different grep patterns and
   JSX surgery).
4. Convert the chart month-name arrays to `Intl.DateTimeFormat`.
5. Treat brand names + currency codes as permanent skips.

Estimated effort to reach zero: 3–4 more targeted agent passes of
equivalent scope, or one large multi-agent parallel effort with the
residual file-lists above pre-partitioned.

## No side effects

- No services/ or packages/ files touched.
- No test files touched.
- No commits, no pushes.
- No Swahili was invented — all new sw entries used the canonical vocab
  list (Karibu, Simamia, Ghairi, Chapisha, Muhtasari, Jumla, Hai,
  Kodi, Kitambulisho, Sanidi, Sahihi, Mkataba, Tazama, Kamilisha, …).

## Verification commands (reproducible)

```bash
# Residual count JSX:
grep -rn '>[A-Z][a-z][^<]*<' apps/<app>/src/ --include='*.tsx' \
  | grep -v '{t(' | grep -v '__tests__' | wc -l

# Residual count attrs:
grep -rn 'placeholder="[A-Z]\|title="[A-Z]\|label="[A-Z]\|aria-label="[A-Z]' \
  apps/<app>/src/ --include='*.tsx' | grep -v '{t(' | grep -v '__tests__' | wc -l

# Typecheck:
pnpm --filter <app> typecheck

# Key parity:
node -e "const o=require('./apps/<app>/messages/en.json'); \
  const flat=(x,p='')=>Object.entries(x).reduce((a,[k,v])=>\
  typeof v==='object'&&v!==null?[...a,...flat(v,p+k+'.')]:[...a,p+k],[]); \
  console.log(flat(o).length)"
```
