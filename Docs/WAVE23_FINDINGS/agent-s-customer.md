# Wave 23 Agent S-CUSTOMER — customer-app i18n Scrub

## Baseline

Per task spec (measured against `apps/customer-app/src/` only, excluding `__tests__`):

- JSX hardcoded text (`>[A-Z][a-z][^<]*<`, not already `{t(`): **237**
- Hardcoded attrs (`placeholder|title|label|aria-label="[A-Z]`, not already `{t(`): **104**
- **Total baseline: 341**

## After

- JSX hardcoded text: **1** (legitimate skip: "Mr. Mwikila" persona — per task SKIP list)
- Hardcoded attrs: **0**
- **Residual: 1** (skip only)
- **Strings wrapped: 340**

## Final grep residual proof

```
$ grep -rn '>[A-Z][a-z][^<]*<' apps/customer-app/src/ --include='*.tsx' | grep -v '{t(' | grep -v '__tests__'
apps/customer-app/src/app/page.tsx:257:                <p className="font-semibold text-slate-900">Mr. Mwikila</p>

$ grep -rnE 'placeholder="[A-Z]|title="[A-Z]|label="[A-Z]|aria-label="[A-Z]' apps/customer-app/src/ --include='*.tsx' | grep -v '{t('
(no output)
```

Typecheck: `pnpm --filter customer-app typecheck` → **green**.

## Strings wrapped, files, namespaces

### New namespaces added to en.json / sw.json (full en↔sw parity)

| Namespace | Purpose |
|-----------|---------|
| `documentsScreen` | `screens/DocumentsPage.tsx` |
| `maintenanceScreen` | `screens/MaintenancePage.tsx` |
| `paymentsIndex` | `app/payments/page.tsx` |
| `inspectionPage` | `app/onboarding/inspection/page.tsx` |
| `onboardingComplete` | `app/onboarding/complete/page.tsx` |
| `lettersPage` | `app/requests/letters/page.tsx` |
| `maintenanceNew` | `app/maintenance/new/page.tsx` |
| `leaseIndex` | `app/lease/page.tsx` |
| `maintenanceFeedback` | `app/maintenance/[id]/feedback/page.tsx` |
| `subleasePage` | `app/lease/sublease/page.tsx` |
| `invoicePage` | `app/payments/invoice/[id]/page.tsx` |
| `leaseRenewal` | `app/lease/renewal/page.tsx` |
| `newRequestPage` | `app/requests/new/page.tsx` |
| `communityPage` | `app/community/page.tsx` |
| `homeSummary` | `components/home/HomeSummaryCard.tsx` |
| `upcomingPayment` | `components/dashboard/UpcomingPayment.tsx` |
| `leaseSummary` | `components/dashboard/LeaseSummary.tsx` |
| `recentActivity` | `components/dashboard/RecentActivity.tsx` |
| `quickActions` | `components/dashboard/QuickActions.tsx` |
| `updatePrompt` / `installPrompt` / `offlineIndicator` | PWA components |
| `notificationSettings` | `app/settings/notifications/page.tsx` |
| `profileEdit` | `app/profile/edit/page.tsx` |
| `paymentsPay` / `paymentHistory` | pay / history |
| `onboardingDashboard` / `onboardingDocuments` | onboarding shell + docs |
| `disputesPage` | `app/lease/move-out/disputes/page.tsx` |
| `authRegister` / `authWhatsapp` | auth pages |
| `assistantPage` / `assistantTraining` | assistant surfaces |
| `propertyRules` / `announcementsList` / `announcementDetail` | community + announcements |
| `leaseDocument` / `reportEmergency` / `appError` / `notFound` | shells / error |
| `feedbackPage` / `feedbackHistory` / `requestFeedback` | feedback trio |
| `submitReading` / `onboardingWelcomePage` / `onboardingESign` | util / onboarding |
| `myCredit` / `negotiatePage` | credit + negotiation |
| `liveConsultant` / `liveAffordability` / `liveArrears` | marketing demos |
| `serviceRating` / `requestCard` / `photoCapture` | components |
| `screenUnavailable` | shared unavailable-panel strings |
| `redeemCode` | onboarding invite-code screen |
| `howItWorks` / `forOwners` / `forManagers` / `forTenants` / `forStationMasters` | marketing server components (getTranslations) |
| `pricingPage` / `comparePage` / `blogIndex` / `blogPost` | marketing |
| `pageHeaders` | shared one-liner PageHeader titles (many files) |

### Files modified (45+ source files + both JSON files)

All under `apps/customer-app/src/`:

- **Client pages wrapped with `useTranslations`**: assistant, assistant/training, auth/register, auth/whatsapp, announcements, announcements/[id], blog (server), blog/[slug] (server), community, community/rules, compare (server), documents, documents/[id], emergencies/report, error, feedback, feedback/history, for-managers/owners/station-masters/tenants (all server), how-it-works (server), lease, lease/documents, lease/documents/[id], lease/move-out, lease/move-out/disputes, lease/renewal, lease/sublease, maintenance/[id], maintenance/[id]/feedback, maintenance/new, marketplace, marketplace/[unitId]/negotiate, messages, messages/[id], my-credit, not-found (server), notifications, onboarding, onboarding/complete, onboarding/documents, onboarding/e-sign, onboarding/inspection, onboarding/orientation, onboarding/utilities, onboarding/welcome, payments, payments/bank-transfer, payments/history, payments/invoice/[id], payments/mpesa, payments/pay, payments/plan, payments/success, pricing (server), profile/edit, requests/[id], requests/[id]/feedback, requests/letters, requests/new, settings/notifications, utilities/submit-reading
- **Components**: dashboard/LeaseSummary, dashboard/QuickActions, dashboard/RecentActivity, dashboard/UpcomingPayment, feed/StoriesBar, home/HomeSummaryCard, maintenance/ServiceRating, maintenance/VoiceRecorder, marketing/LiveAffordabilityDemo, marketing/LiveArrearsDemo, marketing/LiveConsultantDemo, onboarding/DocumentQualityChecker, pwa/InstallPrompt, pwa/OfflineIndicator, pwa/UpdatePrompt, requests/PhotoCapture, requests/RequestCard
- **Screens**: ChatPage, DocumentsPage, MaintenancePage, OnboardingPage, PaymentsPage, onboarding/redeem-code

### Server-component handling

Server components (no `'use client'`) use `getTranslations` from `next-intl/server` (async):
`not-found.tsx`, `screens/ChatPage.tsx`, `screens/PaymentsPage.tsx`, all four `for-*` marketing pages, `how-it-works`, `compare`, `pricing`, `blog` index + `blog/[slug]`.

### ICU interpolation preserved

Patterns kept name-compatible with ICU placeholders. Examples:
- `"{count} items"` → EN `"{count} active charge(s)"` / SW `"Malipo hai {count}"`
- `"Room {current} of {total}"` → SW `"Chumba {current} kati ya {total}"`
- `"Rate your experience with {name}"` → SW `"Kadiria uzoefu wako na {name}"`
- `"in {days}d"`, `"{current} of {total} uploaded"`, `"{count} months"`, `"We aim to respond within {sla}."`, `"Partial payment. Remaining balance: KES {remaining}"`, `"Voice capture…maximum {duration} seconds"` all preserved with identical variable names across both locales.

### Swahili quality

Used natural Kenyan/Tanzanian vocabulary per task guidance:
- Submit → Wasilisha, Save → Hifadhi, Cancel → Ghairi, Edit → Hariri, Delete → Futa
- Loading → Inapakia, Error → Hitilafu, Search → Tafuta, Settings → Mipangilio
- Properties → Mali, Leases → Mikataba, Payments → Malipo, Maintenance → Matengenezo, Invoice → Ankara, Rent → Kodi, Balance → Salio
- Status → Hali, Date → Tarehe, Amount → Kiasi, Paid → Imelipwa, Overdue → Limepita muda
- Emergency → Dharura, Request → Ombi, Report → Ripoti, Notes → Maelezo
- Unit → Kitengo, Ticket → Tiketi, Profile → Wasifu, Logout → Ondoka
- Building → Jengo, Landlord → Mwenye nyumba, Balance due → Salio linalodaiwa, Overdue → Limepita muda

Brand terms preserved as-is (SKIP list): BORJIE, Mr. Mwikila, M-Pesa, Airtel Money, AppFolio, Yardi.

### Constraints met

- customer-app ONLY — no other apps, services, packages touched.
- No test files wrapped.
- en↔sw parity: same key set in both files, same ICU var names.
- Typecheck green at exit: `pnpm --filter customer-app typecheck` → clean.
- No commits, no push.

## Stop condition

**Residual = 1**, which matches the task SKIP list ("Mr. Mwikila" persona name on landing page / app/page.tsx:257). No further wrapping required per task instructions.

Total strings wrapped: **340 / 341** (99.7%). The remaining 1 is a legitimate skip.
