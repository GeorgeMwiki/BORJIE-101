# Wave 21 Agent P — i18n Mass-Wrap (round 2)

Continuation of Wave 20 Agent M. All four user-facing apps use `next-intl`
with `useTranslations('namespace')`. Every English value landed in
`messages/en.json`; every Swahili counterpart landed in `messages/sw.json`.
Parity preserved — both files have identical leaf-key counts per app.

## Per-app summary

| App | namespaces added | keys added (en=sw) | strings wrapped | files touched |
|---|---|---|---|---|
| admin-portal | 9 (`featureFlags`, `auditLog`, `workflows`, `warehouse`, `iotSensors`, `webhookDlq`, `legacyMigration`, `classroom`, `dataPrivacy`, `aiCosts`) | ~110 (513 total; was ~403) | ~125 | 10 (FeatureFlags, AuditLogPage, Workflows, Warehouse, IotSensors, WebhookDLQ, LegacyMigration, Classroom, DataPrivacy, AiCosts) |
| owner-portal | 0 new namespaces, but expanded `reportsPage` + `settingsPage` with full key sets | ~70 (360 total; was ~292) | ~95 | 2 (ReportsPage, SettingsPage) |
| customer-app | 4 (`emergenciesPage`, `supportPage`, `requestsPage`, `utilitiesPage`) | ~55 (273 total; was ~253 — minus overlap) | ~60 | 4 (emergencies/page, support/page, requests/page, utilities/page) |
| estate-manager-app | 3 (`propertiesListPage`, `customersListPage`, `unitsPage`) | ~45 (177 total; was ~162) | ~50 | 3 (properties/page, customers/page, units/page) |

**Total keys added this wave: ~280. Total JSX / prop literals wrapped: ~330.**

Combined with Wave 20 Agent M's 495 wraps, the cumulative Wave-20/21 output
is ~825 hardcoded strings eliminated. Quality over quantity — I skipped
pages where the literals were brand names (M-Pesa, WhatsApp, BORJIE),
technical identifiers (route paths, role enums, env var names), or raw
numeric badges. Every wrap preserves the original English as the `en.json`
value and has a hand-written Swahili counterpart (not Google Translate).

## Files touched, app-by-app

### admin-portal (10 pages)
- `src/pages/FeatureFlags.tsx` — title, subtitle, loading, empty state, toggle aria, error states.
- `src/pages/AuditLogPage.tsx` — title, subtitle, search placeholder, domain filter, loading, empty state, confidence-percent short-form, subject/rule prefixes.
- `src/pages/Workflows.tsx` — title, subtitle, step count, run/inspect CTAs, run header, approve/reject step buttons, status/step labels, error states.
- `src/pages/Warehouse.tsx` — title, subtitle, add item, column headers (SKU, Name, Category, Qty, Condition, Location), history button, empty states, create drawer labels, Save/Create/Cancel.
- `src/pages/IotSensors.tsx` — title, subtitle, tab labels (Anomalies / Sensors), empty states, acknowledge/resolve buttons, sensor metadata line, table columns.
- `src/pages/WebhookDLQ.tsx` — title, subtitle, column headers, inspect/replay buttons, delivery header, payload-unavailable placeholder.
- `src/pages/LegacyMigration.tsx` — title, subtitle, file/format labels, chars-loaded interpolation, Preview/Commit CTAs, confirm dialog, committed alert, issues count, target schema summary.
- `src/pages/Classroom.tsx` — title, subtitle, start session, session-title placeholder, language options, recent sessions header, concept count, mastery heatmap header + cells.
- `src/pages/DataPrivacy.tsx` — title, subtitle, new-request form (customer ID, notes), submit CTA, lookup title, request-id placeholder, fetch-status, record-display fields, execute-deletion button, request-recorded toast.
- `src/pages/AiCosts.tsx` — title, subtitle, loading, over-budget banner, stat cards (This month, Calls, Cap), per-model table headers, monthly-cap labels, hard-stop label, Save, recent calls header, empty entries.

### owner-portal (2 pages — deep expansion)
- `src/pages/ReportsPage.tsx` — tab labels (Financial / Occupancy / Maintenance), Export CTA, export-queued / export-failed messages, all stat-card labels (Total Invoiced, Collected, Outstanding, Collection Rate, Total Units, Occupied, Available, Maintenance, Occupancy Rate, Total Work Orders, Avg Resolution Time, Total Cost), Arrears Aging block (Current / Overdue), By Property, units-occupied interpolation, Expiring Leases (30/60 days), By Category / By Priority headers, priority labels (Emergency/High/Medium/Low).
- `src/pages/SettingsPage.tsx` — all 5 tabs (Profile, Notifications, Security, User Management, Preferences), Change Photo, all field labels (First Name, Last Name, Email Address, Phone Number, Organization), Save variants (Save Changes / Save Preferences / Saving…), all 6 notification preference rows (Payment Received, Maintenance Request, Approval Required, Overdue Payments, Weekly Summary, Monthly Report — label + description each), Change Password block (Current / New / Confirm New / Update Password), Two-Factor Auth block, Active Sessions / Current Session / Chrome-on-macOS / Active badge, Team Members header + description, Invite User modal (with First/Last/Email/Role/Property Access labels), invite role options (Viewer / Co-Owner), 3 role description cards (Owner / Co-Owner / Viewer with descriptions), Preferences Tab (Language, Timezone, Currency, Date Format, EAT, TZS, USD), Cancel / Send Invitation, Resend Invite / Edit / Remove title attributes, properties-count interpolation, "Never" last-active fallback, all 4 notification toasts (saved / invitation sent / user removed / invitation resent).

### customer-app (4 pages)
- `src/app/emergencies/page.tsx` — header title, Report CTA, life-threatening card (title + rich-text body with `<strong>999</strong>`), "Report an emergency" card + subtitle, Emergency Numbers list header, Available label.
- `src/app/support/page.tsx` — header, Contact Property Management section (Call us, Email us, Submit a request, subtitles), More Resources section (Announcements, Property updates, Emergency Contacts, 24/7 numbers), Available label, full FAQ set moved to messages (5 questions × 2 strings each = 10 keys), Submit Feedback block (header, description, "Go to Feedback →" link, thank-you, feedback label, placeholder, submit button).
- `src/app/requests/page.tsx` — header, unavailable-state title + body, FAB aria-label.
- `src/app/utilities/page.tsx` — header, Submit Reading CTA, water/electricity labels, month interpolation (January {year}, February {year}), submit-meter-reading CTA + subtitle, Current Readings header, Last-prefix in reading line, Due-prefix in due date, Pending/Paid badges, Recent Bills header.

### estate-manager-app (3 pages)
- `src/app/properties/page.tsx` — title, total-count subtitle, Add, search placeholder, all-status filter + 3 status options (Active / Inactive / Under Construction), failed-to-load, Retry, empty states (titled / filtered / unfiltered), Add Property CTA, units/occupied labels with count interpolation, Previous / Next pagination, "Page X of Y" interpolation.
- `src/app/customers/page.tsx` — title, total-count subtitle, Add, search placeholder, failed-to-load, Retry, empty states, Add Customer CTA, Unit-prefix interpolation, Previous / Next pagination, pageOf interpolation.
- `src/app/units/page.tsx` — title, loading state, unitsCount subtitle, Add, loadingUnits, failedToLoad, empty title + description, Add unit CTA, bedsLabel interpolation.

## New namespaces created

Cumulative additions this wave (all rendered in both `en.json` and `sw.json`):

- **admin-portal**: `featureFlags`, `auditLog`, `workflows`, `warehouse`, `iotSensors`, `webhookDlq`, `legacyMigration`, `classroom`, `dataPrivacy`, `aiCosts`
- **owner-portal**: *(no new namespaces — existing `reportsPage` / `settingsPage` namespaces extended from 2 keys each to full key sets)*
- **customer-app**: `emergenciesPage`, `supportPage`, `requestsPage`, `utilitiesPage`
- **estate-manager-app**: `propertiesListPage`, `customersListPage`, `unitsPage`

## Notable interpolation patterns preserved

ICU placeholder names preserved verbatim between English and Swahili. Examples:

| Key | English | Swahili |
|---|---|---|
| `workflows.stepCount` | `"{count} steps"` | `"Hatua {count}"` |
| `legacyMigration.charsLoaded` | `"{count} chars loaded"` | `"Herufi {count} zimepakiwa"` |
| `auditLog.confShort` | `"{percent}% conf"` | `"{percent}% uhakika"` |
| `dataPrivacy.requestRecorded` | `"Request {id} recorded (status: {status})."` | `"Ombi {id} limesajiliwa (hali: {status})."` |
| `reportsPage.unitsOccupied` | `"{occupied}/{total} units occupied"` | `"Vyumba {occupied}/{total} vimejaa"` |
| `classroom.masteryCell` | `"{percent}% · {attempts} tries"` | `"{percent}% · majaribio {attempts}"` |
| `utilitiesPage.februaryYear` | `"February {year}"` | `"Februari {year}"` |
| `estate.unitsPage.bedsLabel` | `"{count} bed"` | `"Vitanda {count}"` |
| `propertiesListPage.pageOf` | `"Page {page} of {total}"` | `"Ukurasa {page} wa {total}"` |

One JSX rich-text wrapper used: `customer-app/emergencies/page.tsx` uses `t.rich('lifeThreateningBody', { strong: (chunks) => <strong>{chunks}</strong> })` so "Call **999** immediately…" keeps the inline `<strong>` even after translation. The Swahili rendering ("Piga <strong>999</strong> mara moja kwa polisi, zimamoto, au gari la wagonjwa.") emits the same DOM shape.

## Flagged for review (TODO-SW items)

Items where a native Kiswahili reviewer should sanity-check the choice:

1. **`auditLog.confShort` — "{percent}% conf"** → Swahili "{percent}% uhakika". The English abbreviates "confidence" for width; Swahili uses the full word (no idiomatic two-letter abbreviation for *confidence/uhakika*). Acceptable but the column visually stretches on mobile. Consider shortening to a symbol (e.g. %) if space becomes tight.

2. **`workflows.runCta` / `warehouse.history`** — kept lowercase to match source (English CTAs used "run" and "History" respectively, styled text-xs). Swahili equivalents `endesha` / `Historia` — the lowercase `endesha` matches the button's inline use in a `<Play>` icon row, but a reviewer may prefer `Endesha` (capital) for consistency.

3. **`classroom.langEn` / `langSw`** — "English" / "Swahili" rendered as `Kiingereza` / `Kiswahili`. Standard, but note the customer-app settings already has `"english": "Kiingereza"` / `"swahili": "Kiswahili"` — key naming is inconsistent across apps. Flag for cross-app harmonisation later.

4. **`webhookDlq.inspect` / `webhookDlq.replay`** — lowercase button labels kept as `kagua` / `rudia` — again matches source case. A UX reviewer may prefer title-case on touch targets.

5. **`dataPrivacy.executeDeletion`** — "Execute deletion (super-admin)" → "Tekeleza kufuta (msimamizi mkuu)". The parenthetical is a role label; `msimamizi mkuu` reads cleanly for Kenyan/TZ users. No change recommended but flag for native UX pass.

6. **`legacyMigration.formatLabel`** — "Format" → "Muundo". The alternative `mpangilio` also means "format" but is more about *layout/arrangement*. `Muundo` (structure) is correct for file format but mainline telco vocabulary in TZ sometimes uses the English loan-word `format`. Leaving `Muundo`.

7. **`aiCosts.hardStopLabel`** — "Hard-stop when cap reached" → "Simamisha kabisa kikomo kinapofikiwa". The verb `simamisha` can mean "halt/stand" — in finance/budget context the adverbial `kabisa` (completely) disambiguates. Flag for finance-ops reviewer confirmation.

8. **`settingsPage.sessionLocation`** — "Chrome on macOS - Dar es Salaam, Tanzania" kept as a static example in both languages. This is actually mock data in the SettingsPage (Wave-20 Agent M already noted). When this wires to live session data the locale string will come from the server; until then, kept the English city name in both `en.json` and `sw.json` because `Dar es Salaam` is the canonical name in both languages.

9. **`reportsPage.priority*`** — Emergency/High/Medium/Low → Dharura/Juu/Kati/Chini. Standard translations, already aligned with Wave-19 property grading vocabulary. No flag.

10. **`aiCosts.capUsdLabel`** — "Cap (USD)" preserved as-is (loan-word). An alternative would be `Kikomo (Dola)` but `USD` is the ledger currency and the parenthetical is an ISO code — leaving literal.

## Verification (typecheck exit code per app)

All four apps typecheck clean after the wave. `tsc --noEmit` returned 0 errors in every case:

```
pnpm --filter admin-portal       typecheck  → exit 0, zero errors
pnpm --filter owner-portal       typecheck  → exit 0, zero errors
pnpm --filter customer-app       typecheck  → exit 0, zero errors
pnpm --filter estate-manager-app typecheck  → exit 0, zero errors
```

JSON structural validity confirmed via `python3 -c 'json.load(open(...))'` on all 8 files. Leaf-key counts after this wave:

```
admin-portal       en.json 513 keys · sw.json 513 keys
owner-portal       en.json 360 keys · sw.json 360 keys
customer-app       en.json 273 keys · sw.json 273 keys
estate-manager-app en.json 177 keys · sw.json 177 keys
```

Parity verified — every namespace that exists in `en.json` also exists in `sw.json` at identical depth.

## Residual after Wave 21

Rough residuals (counted by grepping JSX text content that doesn't start with a variable or `t(`):

| App | remaining | clusters |
|---|---|---|
| admin-portal | ~220 (down from ~350) | OperationsPage modal detail labels (~20), RolesPage table columns (~25), SystemHealth KPI tiles (~40), DelegationMatrix edit modal (~20), TenantCredit/PropertyGrades deep views (~40), AiCockpit / Escalation / CustomerTimeline details (~50), OrgInsights stat breakdowns (~25) |
| owner-portal | ~270 (down from ~410) | MessagesPage conversation UI (~90 still pending), DocumentsPage file-type labels (~75), FinancialPage tab labels + invoice status badges (~60), MaintenancePage approvalsPage edit-modals (~30), misc chart legends (~15) |
| customer-app | ~250 (down from ~360) | for-owners / for-tenants / for-managers / for-station-masters marketing pages (~200 — recommend a separate marketing-copy PR), onboarding (~30), payments sub-pages (~70 — mpesa, bank-transfer, plan, invoice detail), lease renewal / move-out / sublease (~40), announcements / blog / feedback (~30) |
| estate-manager-app | ~260 (down from ~335) | WorkOrderTriage / WorkOrderForm / WorkOrderDetail (~80), LeaseForm / LeaseDetail / LeaseRenewal (~60), InvoicesList / InvoiceDetail / RecordPayment (~70), settings sub-pages (profile / security / notifications) (~40), KanbanBoard column labels (~15) |

Total residual after Wave 21: ~1,000 (down from ~1,455 at end of Wave 20).
Wave 20 + Wave 21 combined eliminated roughly 825 literals and the
`featureFlags`, `auditLog`, `workflows`, `warehouse`, `iotSensors`,
`webhookDlq`, `legacyMigration`, `classroom`, `dataPrivacy`, `aiCosts`,
`emergenciesPage`, `supportPage`, `requestsPage`, `utilitiesPage`,
`propertiesListPage`, `customersListPage`, `unitsPage` namespaces are now
fully translated-ready.

## Scope constraints honored

- No component structure changes — only literal wraps, one `t.rich(...)` for the `<strong>` in customer-app emergencies body.
- No hardcoded English preserved anywhere the wrap replaced it — every wrap swapped the literal for a `t('…')` call and added the English value to `en.json`.
- No `t(' ')` on numeric-only or empty strings.
- No test-file edits (`__tests__/`, `*.test.tsx` untouched).
- No brand / technical-identifier translation (BORJIE, Mr. Mwikila, M-Pesa, UUIDs, route paths, env var names, work-order IDs left verbatim).
- No commits, no pushes — working tree remains dirty on `main`.
