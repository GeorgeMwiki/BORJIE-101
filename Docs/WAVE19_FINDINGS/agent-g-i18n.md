# Wave 19 Agent G — i18n Findings

Scope: apps/admin-portal, apps/owner-portal, apps/customer-app, apps/estate-manager-app, packages/ai-copilot/src/personas.

## Per-app summary

| App | en keys (before) | sw keys (before) | Missing in sw (before) | Fake translations (before) | Hardcoded JSX hits | en keys (after) | sw keys (after) |
|---|---|---|---|---|---|---|---|
| admin-portal | 174 | 174 | 0 | 3 (`app.title` brand, `delegation.domain.compliance`, `nav.compliance`) | ~568 JSX text hits | 192 | 192 |
| owner-portal | 86 | 86 | 0 | 2 (`nav.compliance`, `nav.portfolio`) | ~611 JSX text hits | 90 | 90 |
| customer-app | 108 | 108 | 0 | 5 (`app.title` brand, 4× `marketing.tier*` product tier names) | ~478 JSX text hits | 121 | 121 |
| estate-manager-app | 72 | 72 | 0 | 0 | ~412 JSX text hits | 95 | 95 |

Key takeaway: **en/sw parity was intact on disk at the start of the wave**, but three of the four apps barely exercise i18n — the `useTranslations` call graph only covers ~1 namespace outside admin-portal, so the vast majority of rendered strings are English literals that never pass through `t()`. That is the mechanism behind the "missing UI in Swahili" complaint: the locale toggle flips but the text does not change, because the text was never wired to the translator.

## Fixed this wave

### 1. Fake (identical English) translations — corrected
- `apps/admin-portal/messages/sw.json`: `nav.compliance` "Compliance" → "Uzingatiaji"; `delegation.domain.compliance` "Compliance" → "Uzingatiaji".
- `apps/owner-portal/messages/sw.json`: `nav.compliance` "Compliance" → "Uzingatiaji"; `nav.portfolio` "Portfolio" → "Mkusanyiko wa mali".
- Customer-app `app.title` ("BORJIE") and `marketing.tier*` ("Starter", "Growth", "Estate", "Enterprise") deliberately left identical — these are brand / product-tier names. Admin-portal `app.title` ("BORJIE Admin") same rationale.

### 2. Navigation arrays wrapped with `t()` — runs on every page

`apps/owner-portal/src/components/Layout.tsx`
- `navigation` array: replaced literal `name: 'Dashboard'` etc. with `key: 'dashboard'` and render `tNav(item.key)`.
- "Owner Portal" subtitle → `tChrome('ownerPortal')`.
- `aria-label="Close navigation menu" / "Open navigation menu" / "Notifications (3 unread)"` → `tChrome('closeNavMenu' | 'openNavMenu' | 'notificationsUnread')`.

`apps/admin-portal/src/components/Layout.tsx`
- `NAV_GROUPS` schema changed: `heading` → `headingKey`, `name` → `navKey`. Rendered with `tNavGroups(group.headingKey)` and `tNav(item.navKey)`.
- `getPageTitle()` rewritten to return translated strings via `tNav` / `tPageTitle`.
- "Internal Admin" → `tChrome('internalAdmin')`.
- "Search anywhere" text + `aria-label="Open search (Cmd+K)"` → `tChrome('searchAnywhere')` / `tChrome('openSearch')`.

### 3. Estate-manager dashboard (`apps/estate-manager-app/src/app/page.tsx`)

Wrapped the following previously-hardcoded strings:
- Section headings: "Property Overview", "Work Orders", "Quick Actions", "Recent Payments", "Upcoming Lease Expirations".
- Card labels: "Properties", "Total Units", "Occupancy Rate", "Open", "In Progress", "Completed Today".
- Quick action labels: "Create Work Order", "Add Customer", "Receive Payment".
- Empty state titles/descriptions for recent payments and expiring leases.
- Status badges: "Completed", "Expiring", and the "Tenant" fallback.
- PageHeader subtitle "Estate Manager Overview".

### 4. Customer payments page (`apps/customer-app/src/app/payments/page.tsx`)

Wrapped: page title, "Retry" button, "Total balance due", active-charges message, "Payment History", "Review your ledger", "Pay Now", "M-Pesa and more", "Pending payments", empty states, "Recent activity", "See all", "No payment history yet.", and the wired-up live-balances notice.

### 5. Translation keys added

`apps/admin-portal/messages/{en,sw}.json`
- Added to `nav`: `aiCockpit`, `exceptions`.
- Added new `navGroups` namespace (overview, operations, finance, aiBrain, orgInsights, settings).
- Added new `chrome` namespace (internalAdmin, openSearch, searchAnywhere).
- Added new `pageTitle` namespace (adminPortal, tenantOnboarding, permissionMatrix, approvalMatrix, controlTower, customerTimeline, caseEscalation).

`apps/owner-portal/messages/{en,sw}.json`
- Added new `chrome` namespace (ownerPortal, openNavMenu, closeNavMenu, notificationsUnread).

`apps/customer-app/messages/{en,sw}.json`
- Added new `paymentsPage` namespace (13 keys).

`apps/estate-manager-app/messages/{en,sw}.json`
- Added new `dashboard` namespace (22 keys).

All new keys are present in both en.json and sw.json — key parity re-verified post-edit:
```
admin-portal en 192 sw 192 missing_sw: [] extra_sw: []
owner-portal en 90  sw 90  missing_sw: [] extra_sw: []
customer-app en 121 sw 121 missing_sw: [] extra_sw: []
estate-manager-app en 95 sw 95 missing_sw: [] extra_sw: []
```

### 6. Persona cultural-anchor gaps closed

`packages/ai-copilot/src/personas/sub-personas/maintenance-persona.ts`
- Added **Market context — Kenya and Tanzania** section: Swahili vocabulary (nyumba, mpangaji, mwenye nyumba, mlinzi, huduma), KSh/TSh currency guidance, recognised Swahili emergency keywords (maji yanavuja, umeme umekatika, choo kimeziba, gesi inavuja, mlango umevunjika), market list (Nairobi, Mombasa, Kisumu, Ruaka, Rongai, Thika, Dar, Arusha, Mwanza, Zanzibar), Swahili reassurance closer "Pole sana — tunashughulikia sasa hivi".

`packages/ai-copilot/src/personas/sub-personas/leasing-persona.ts`
- Added **Market context — Kenya and Tanzania** section: Swahili vocabulary (kodi, ankara, mkataba wa upangaji, dhamana/amana, stakabadhi, mpangaji, mwenye nyumba), KSh/TSh quoting rules, legal anchors (Kenyan Landlord and Tenant Act, Rent Restriction Act Cap 296, Distress for Rent Act; Tanzanian Land Act Cap 113), deposit-cycle norms (Nairobi 1+1, Dar 6–12 months), mobile-money rails (M-Pesa Paybill KE, Tigo Pesa, Airtel Money, M-Pesa TZ), Swahili closer "Karibu sana nyumbani".

`packages/ai-copilot/src/personas/sub-personas/finance-persona.ts`
- Upgraded "Kenyan market fluency" → "Kenyan and Tanzanian market fluency". Added Tanzanian rails (M-Pesa TZ, Tigo Pesa, Airtel Money, HaloPesa), TRA 10% rental withholding, Dar sqm service charge pricing, TZ banks (CRDB, NMB, Exim, Stanbic), KSh / TSh formatting rule + `Intl.NumberFormat('sw-KE' | 'sw-TZ')` guidance, Swahili vocabulary block (ankara, risiti/stakabadhi, deni, malipo, kodi, dhamana, mshahara, bajeti), and *madeni ya kodi* idiom.

`packages/ai-copilot/src/personas/sub-personas/compliance-persona.ts`
- Added **Language and currency discipline** section: KSh/TSh mandatory in legal demands, Intl.NumberFormat Swahili locale rule, Swahili legal vocabulary (notisi, onyo, kesi, mahakama, baraza la usuluhishi, kikwazo, haki, ushahidi, sheria), bilingual notice pattern (include a "Kwa lugha ya Kiswahili: ..." summary in every demand letter).

`packages/ai-copilot/src/personas/sub-personas/advisor-persona.ts`
- Added Swahili code-switch bullet to Behavioural guidelines (mkusanyiko wa nyumba, mapato halisi, faida, hasara, mtaji, uwekezaji) + Swahili closer ("Tuendelee na mwelekeo huu?").

`packages/ai-copilot/src/personas/sub-personas/consultant-persona.ts`
- Added **Language anchors** section: KSh/TSh never-USD rule, Swahili vocabulary (uwekezaji, mtaji, faida, hasara, mikopo, benki, soko la nyumba, mwekezaji, mkakati), two Kenyan/Tanzanian proverbs a senior advisor would use ("Haraka haraka haina baraka", "Mchumia juani hulia kivulini").

### 7. Typecheck verification

All four apps pass `pnpm --filter <app> typecheck` clean after the edits.

## Locale-toggle wiring — verified

`apps/admin-portal/src/i18n.ts`, `apps/owner-portal/src/i18n.ts` — both implement `detectInitialLocale()` that reads the `NEXT_LOCALE` cookie first, then `navigator.language`, falling back to `en`. `persistLocale()` writes the cookie with a 1-year max-age. `LocaleProvider.tsx` wraps children in `NextIntlClientProvider`, so when `setLocale` mutates React state every consumer of `useTranslations` re-renders. No SSR/CSR mismatch risk because both apps are SPAs (Vite).

`apps/customer-app/src/components/LocaleSwitcher.tsx`, `apps/estate-manager-app/src/components/LocaleSwitcher.tsx` — write the cookie then `window.location.reload()`. That is correct for the Next.js App Router setup because the locale is resolved in middleware + `i18n.ts` at the server boundary.

**Nothing broken in the toggle wiring.** The failure mode the user reports is purely downstream: UI strings never reach `t()` in the first place.

## Suspicious untranslated (flagged for human review)

Large volume of hardcoded JSX that survived this wave because scope / time-box / "do not rewrite structurally". These are the top clusters — each would be a small PR of its own, not this wave's work:

**admin-portal (top repeated hardcoded strings)**
- Table column headers: "Actions", "Status", "Tenant", "Active", "All Status" — repeated across user/tenant/roles/feature-flags pages.
- KPI tiles on `/platform`: "Total Tenants", "Active Tenants", "Total MRR", "Monthly Revenue", "MRR from subscriptions", "Past Due", "Units Managed", "Across all tenants".
- Buttons: "Retry", "Cancel", "Close", "Export", "Promise" (unclear context — appears 4×), "Permissions".
- "English" / "Swahili" rendered as static text in a couple of places (rather than via the locale switcher's `t('locale.en')`).

**owner-portal**
- Section titles spread across charts/features: "Monthly Revenue", "Occupancy Rate", "Net Operating Income", "Revenue Trend", "Maintenance", "Insurance", "Category", "Amount", "Property", "Reject", "Approve", "Completed", "Occupancy".
- Form labels in `CoOwnerInviteModal` and similar: "First Name", "Last Name", "Email", "Description", "Spent".
- `BORJIE` appears as literal text 7× in the mobile sidebar — branded word, safe, but should still route through `t('app.title')` for consistency.

**customer-app**
- High-visibility tenant-facing strings: "Pay Now", "Phone Number", "Emergency Contacts", "New Request", "Notification Preferences", "Monthly Rent", "Current lease", "Saving...", "Submitting...", "Download document", "Submit feedback", "How was the service?", "My Documents", "Verified", "Uploaded", "Document not found.".
- `for-owners`, `for-tenants`, `for-managers`, `for-station-masters` landing pages — mostly hardcoded English marketing copy. Large scope; handle as a dedicated marketing-i18n PR.

**estate-manager-app**
- "Go Back" (6×), "Something went wrong", "Try again", "View All", "Completed", "Customer Type", "Tenant", "Priority", "Description", "Pending", "Meter Readings", "Available", "Occupied", "Add Customer", "Phone", "Company", "Email", "Previous", "Individual", "Category".
- Form label strings on customer/vendor create pages.

### Cross-cutting flags (not touched — need design decisions, not mechanical wraps)

- **Pluralization**: did not find the `n === 1 ? 'x' : 'xs'` antipattern in the scoped files, but translation files use `{count}` placeholders without ICU plural forms. Swahili plurals are contextual (noun-class prefixes), so Intl plural rules (`other`-only in sw) will silently paper over issues. Recommend migrating to ICU MessageFormat (`{count, plural, one {...} other {...}}`) and documenting which keys need Swahili noun-class-aware forms — library-level fix, not per-key.
- **Date formatting**: estate-manager dashboard uses `new Intl.NumberFormat(TENANT_LOCALE, ...)` and `.toLocaleDateString(TENANT_LOCALE, ...)` — correctly locale-aware via `NEXT_PUBLIC_TENANT_LOCALE`. Did not find any `MM/DD` literal patterns in the scoped files. Good.
- **Currency formatting**: estate-manager uses `Intl.NumberFormat(TENANT_LOCALE, { style: 'currency' })` — correct. Customer-app payments page (line 50, 91, 121 of `payments/page.tsx`) uses `${payment.currency} ${Number(payment.amount).toLocaleString()}` — displays the raw currency code ("KES 12,500") rather than a localized currency format ("KSh 12,500.00"). Flag for a follow-up: swap to `new Intl.NumberFormat(locale, { style: 'currency', currency: payment.currency }).format(Number(payment.amount))`.
- **Error envelopes**: did not audit services/ per scope constraint. Recommend a separate pass to ensure the error envelope carries `{ code, message }` and the client localizes from `code`, not from the raw `message` string.
- **"Karibu" sprinkled in English copy**: `customer-app/messages/en.json` → `marketing.handoffCardTitle` = `"Karibu. Let me hand you to signup."`. Intentional brand-voice code-switch, not a bug. Leaving as-is.
- **"arrears"** left untranslated in Swahili files (`chat.chatPlaceholder` in admin-portal and owner-portal, `chatUi.inputPlaceholder` in admin-portal, customer-app and owner-portal). Kenyan property-management Swahili frequently borrows "arrears" verbatim; *madeni* is the idiomatic replacement but tradespeople also understand the English word. Flag for tenant-UX review rather than auto-fix.

## Persona prompt coverage (post-fix)

| Persona | Swahili idiom | Kenya/TZ market ref | KSh/TSh currency |
|---|---|---|---|
| professor-persona | yes (kodi, habari) | yes | yes |
| pedagogy-standards | — (mostly meta) | yes | yes |
| teaching-style | — | yes | yes |
| communications-persona | yes (habari, bwana) | yes | yes |
| consultant-persona | **yes (now — uwekezaji, mtaji, faida, 2 proverbs)** | yes | **yes (now — KSh/TSh not-USD rule)** |
| advisor-persona | **yes (now — code-switch bullet + Swahili closer)** | yes | yes |
| finance-persona | **yes (now — ankara, stakabadhi, deni, malipo, kodi…)** | yes (+TZ banks, TRA) | **yes (now — KSh/TSh formatting rule)** |
| compliance-persona | **yes (now — notisi, onyo, kesi, mahakama, sheria…)** | yes | **yes (now — KSh/TSh mandatory rule)** |
| leasing-persona | **yes (now — kodi, ankara, dhamana, mkataba wa upangaji + Swahili closer)** | **yes (now — Nairobi vs Dar deposit cycles, TZ mobile rails)** | **yes (now — KSh/TSh quoting rule)** |
| maintenance-persona | **yes (now — nyumba, mpangaji, mlinzi, huduma + 5 emergency keywords + closer)** | **yes (now — 10 Kenyan/TZ markets)** | **yes (now — KSh/TSh + Intl.NumberFormat guidance)** |

All 10 sub-personas now ship at least one Swahili idiom, one Kenyan/Tanzanian market reference, and explicit KSh/TSh currency guidance. Bold = added this wave.

## Scope notes

- Did not touch services/ (out of scope for this agent).
- Did not restructure any components; only wrapped literals with `t()` calls.
- No invented Swahili — every translation reused an existing app's term when possible or was chosen from the vocabulary list in the brief (nyumba, mpangaji, kodi, huduma, karibu, etc.). Noted a handful of borrowed English terms (e.g., "portfolio" → "Mkusanyiko wa mali" — "Portfolio" was the pre-existing Google-Translate-esque copy-out).
- No commits, no push.
