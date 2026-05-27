# FOUR-SURFACE AUDIT 2026-05-27

> WAVE-7 FOUR-SURFACE VERIFY. Audit of the four user-facing apps that
> ship at launch: `apps/owner-web`, `apps/admin-web`,
> `apps/workforce-mobile`, `apps/buyer-mobile`. Audit-only — no app
> source edited. (`apps/marketing` is the public marketing site and
> is explicitly out of scope per the wave brief.)

## Executive verdict per surface

| Surface | Verdict | One-liner |
|---|---|---|
| owner-web | GREEN | All routes shipped, forms validated, tests + typecheck pass, brand-locked. Two minor gaps: persona binding not wired via `@borjie/persona-runtime`, and `MapCanvas.tsx` uses raw map-feature hex colors. |
| admin-web | GREEN | Largest surface (62 routes incl. 25 internal); 12 test files / 147 tests pass; typecheck clean; strong tenantId discipline. One gap: no `<img alt="">` usage detected, but the app uses zero `<img>` tags (icons only). |
| workforce-mobile | RED | 37 of 47 `O-M-*` / `W-M-*` screens are placeholder shells (~22 LOC each) wrapping `PlaceholderList`. No test suite, no `test` script in package.json. No design-system tokens — uses a local `theme/colors.ts` with raw hex earth palette. Persona-runtime not bound. |
| buyer-mobile | YELLOW | Architecture is sound (api client, zod schemas, react-hook-form, i18n, theming) and core flows (login, KYC, marketplace, bids) are real. But no test suite, no design-system tokens (local `theme/colors.ts`), persona-runtime not bound, only 3 `accessibilityLabel` occurrences across the app. |

## Aggregate signal counts

| Surface | Routes | Buttons | Forms (zod) | Tests P/F | a11y signals | i18n hooks | persona | brand | tenant-iso |
|---|---|---|---|---|---|---|---|---|---|
| owner-web | 28 pages + 2 API | 27 `<button>` (39 total uses) | 6 (11 zod refs) | 3/0 | 19 aria-label, 3 main/nav | 95 lang-pack refs | NOT wired via runtime | 7 hex outside tokens (map only) | bearer token (Supabase JWT carries tenantId) |
| admin-web | 62 pages + 11 API | 84 `<button>` | 7 (5 zod refs) | 147/0 | 55 aria-label, 16 main/nav | 351 lang-pack refs | 2 prose refs ("Mr. Mwikila") | 1 hex outside tokens | 61 tenantId refs (strong) |
| workforce-mobile | 59 screens (47 are 20-30 LOC stubs) | 131 Pressable/Touch | 7 (forms/schemas, no top-level zod folder) | 0/0 (no test script) | 12 accessibilityLabel, 17 accessibilityRole, 0 hint | 31 t() refs | NOT wired | 21 hex (theme/colors.ts) | 2 tenantId refs |
| buyer-mobile | 13 screens | 62 Pressable/Touch | 7 (zod via `src/schemas/`) | 0/0 (no test script) | 3 accessibilityLabel, 3 accessibilityRole | 209 t() refs | NOT wired | 22 hex (theme/colors.ts) | 0 tenantId refs |

Test totals: **150 passing, 0 failing across web surfaces; mobile surfaces have no tests.**

Typecheck: all 4 surfaces pass `tsc --noEmit`.

---

## owner-web (detail)

Package: `@borjie/owner-web` · Port 3010 · Next.js 15 App Router · Tailwind · Supabase SSR

### Routes (28 page routes + 2 API routes)

```
/                              (page.tsx)
/sign-in
/(routes)/cockpit
/(routes)/community
/(routes)/compliance
/(routes)/documents
/(routes)/finance
/(routes)/fleet
/(routes)/fleet/maintenance
/(routes)/geology
/(routes)/group
/(routes)/inventory
/(routes)/licence
/(routes)/licences
/(routes)/lmbm
/(routes)/marketplace
/(routes)/master-brain
/(routes)/onboarding
/(routes)/people
/(routes)/portfolio-map
/(routes)/reports
/(routes)/safety
/(routes)/sales
/(routes)/settings
/(routes)/site-cockpit
/(routes)/sites
/(routes)/treasury

API: /api/owner-overview/snapshot, /api/perf/web-vitals
```

Two routes with overlapping concerns: `/(routes)/licence` (singular) and `/(routes)/licences` (plural). No stub routes found — all pages render real content.

**fix-recommend:** consolidate `/licence` and `/licences` into one canonical route (`/licences`) with detail view at `/licences/[id]`.

### Buttons

27 `<button>` declarations across the surface (39 total occurrences when counting JSX usages). No dead handlers (`onClick={() => {}}` or `onClick={noop}` patterns) found in source. Submit buttons in forms wire `type="submit"` correctly and toggle `disabled` on submission state.

### Forms (6, all wired)

| File | Validation | Submit | Error/Success |
|---|---|---|---|
| `src/app/sign-in/sign-in-form.tsx:8` | zod inline `SignInSchema` | `supabase.auth.signInWithPassword` | `role="alert"` rose error |
| `src/app/(routes)/onboarding/page.tsx:58` | `useForm + zodResolver(kybSchema)` | `useStartOnboarding/Advance/Complete` mutations | `setStepError` + UI banner |
| `src/components/master-brain/Composer.tsx` | uses `useForm` | sse stream wired | inline state |
| `src/components/documents/DocChatPane.tsx` | `useForm` | doc-chat fetch | inline |
| `src/components/fleet/NewMaintenanceModal.tsx` | `useForm` | api-client POST | inline |
| `src/components/reports/ReportForm.tsx` | `useForm` | report mutation | inline |

All forms validate with zod and report errors. No silent submits found.

### API wiring

Owner-web calls `api-gateway` via the local `src/lib/api-client.ts` fetch wrapper (no usage of `@borjie/api-sdk` or `@borjie/api-client` for owner-overview — it speaks raw to the gateway). The Supabase access token is forwarded as `Authorization: Bearer ...`. `API_BASE` resolves from `NEXT_PUBLIC_API_GATEWAY_URL` (default `http://localhost:3001`).

12 raw `fetch(...)` / `axios` call sites; 2 reference `@borjie/api-sdk`. No UI calling non-existent endpoints discovered in this audit.

**fix-recommend:** migrate owner-web call sites off the local `api-client.ts` shim onto `@borjie/api-sdk` so the typed contract is uniform across surfaces.

### Tests

`pnpm -F @borjie/owner-web test` → 1 test file, **3/3 passing** (`__tests__/report-player.test.tsx`). Coverage breadth is thin for a surface this large.

**fix-recommend:** add at least one test per top-level route (28 missing) and per form (5 missing). Wire Playwright for the cockpit happy path.

### a11y

`grep` heuristics — no `alt=` usages detected, but the surface uses lucide-react icons (not `<img>` tags), so this is acceptable. 19 `aria-label` occurrences cover icon-only buttons. 3 semantic `<main>` / `<nav>` tags. Skip-link present in root layout (`apps/owner-web/src/app/layout.tsx:31`).

**fix-recommend:** if any `<img>` is added later (e.g. user avatars), enforce `alt`.

### i18n

95 references to `@borjie/language-pack-*` / `useTranslation` / `t(...)`. The sign-in form is Swahili-first (literal Swahili strings: `"Weka anwani halali ya barua pepe"`, `"Ingia"`) — these strings are inline and not in the language pack.

**fix-recommend:** move the 4-5 hardcoded Swahili strings in `sign-in-form.tsx` into `@borjie/language-pack-sw` to keep the surface 100% pack-driven.

### Persona binding

`@borjie/persona-runtime` is **not imported** by owner-web. The cockpit screens reference `screen.persona` from `src/lib/screens.ts` (string label) but do not resolve a `Persona` object via the runtime. Persona binding for "Mr. Mwikila" is implicit, not enforced.

**fix-recommend:** wire `resolvePersonaBinding()` from `@borjie/persona-runtime` in the root layout and expose `useActivePersona()` to consumers.

### Brand lock

Uses `@borjie/design-system` (8 references including `Logomark`). Tailwind tokens via `tailwind.config.ts`. Raw hex codes found: 7 occurrences, all in `src/components/portfolio-map/MapCanvas.tsx` for Mapbox layer colors (licence, site, settlement, water, protected, road). These are not brand color violations but should still be tokenized.

**fix-recommend:** move map-feature colors to `@borjie/design-system/map-tokens` (or a `cockpit/map` sub-token group).

### Tenant isolation

Tenant identity flows through the Supabase JWT (each `Authorization: Bearer ...` carries the user's tenant claims, which the api-gateway resolves). Only 1 explicit `tenantId` reference in the codebase (`src/lib/types/cockpit.ts`). The api-gateway is the enforcement point — owner-web does not re-assert.

**fix-recommend:** add an `X-Tenant-ID` header (resolved from the session) for defense-in-depth on api-gateway middleware.

---

## admin-web (detail)

Package: `@borjie/admin-web` · Port 3020 · Next.js 15 · Tailwind · Supabase SSR · Largest surface

### Routes (62 page routes + 11 API routes)

Top-level: `/`, `/sign-in`, `/login`, `/ai-costs`, `/ask`, `/ask/[threadId]`, `/control-tower`, `/data-privacy`, `/decision-trace`, `/decision-trace/[id]`, `/feature-flags`, `/forecasts`, `/industry`, `/insights`, `/integrations`, `/jarvis`, `/legacy-migration`, `/mission-eval`, `/mission-eval/[scenarioId]`, `/persona-drift`, `/radar`, `/session-replay`, `/session-replay/[sessionId]`, `/system-health`, `/warehouse`, `/webhook-dlq`.

Internal (`/internal/*`): `ab-tests`, `analytics`, `audit-log`, `audit-pack`, `citations`, `compliance-queue`, `corpus`, `decision-log`, `flags`, `juniors`, `killswitch`, `marketplace`, `models`, `prompts`, `regulator-pipeline`, `rollback`, `slo`, `support`, `tenants`, `tenants/[id]`, `tenants/detail`.

Platform (`/platform/*`): `billing`, `feature-flags`, `overview`, `subscriptions`.

API routes: `/api/perf/web-vitals`, `/api/platform/budget`, `/api/platform/health`, `/api/platform/intelligence/thread`, `/api/platform/intelligence/thread/[threadId]`, `/api/platform/intelligence/thread/[threadId]/message`, `/api/platform/intelligence/threads`, `/api/platform/login`, `/api/platform/me`, `/api/platform/overview`.

No stub routes detected on inspection. Two `/tenants/...` routes overlap (`/internal/tenants/[id]` vs `/internal/tenants/detail`) — possible legacy.

**fix-recommend:** confirm whether `/internal/tenants/detail` is still wanted; otherwise prune.

### Buttons

84 `<button>` declarations. No dead handlers. Toggles and pagination wired to react-query mutations.

### Forms (7)

| File | Validation | Submit |
|---|---|---|
| `src/app/sign-in/sign-in-form.tsx` | zod inline | supabase auth |
| `src/app/login/LoginForm.tsx:13` | none (raw state) | `POST /api/platform/login` w/ CSRF |
| `src/app/decision-trace/page.tsx` | inline | query mutation |
| `src/app/jarvis/JarvisConsole.tsx` | inline | SSE stream |
| `src/components/FeedbackThumbs.tsx` | none | rating mutation |
| `src/components/internal/flags/FlagRolloutForm.tsx` | useForm | flags PATCH |
| `src/components/internal/audit-pack/MintPackForm.tsx` | useForm | audit-pack POST |

`LoginForm.tsx` does **not** use zod. The form trusts inline state + server-side validation. The CSRF header is added correctly.

**fix-recommend:** add a zod schema for `LoginForm` to fail-fast on malformed email locally.

### API wiring

35 raw `fetch(...)` call sites. The admin surface owns its own API routes under `/api/platform/...` which proxy to identity/budget/intelligence backends. Strong typing via `src/lib/internal/queries/*.ts`.

### Tests

`pnpm -F @borjie/admin-web test` → **147/147 passing**, 12 test files. Strong coverage on the sensorium, session-replay, genui, and ag-ui-client modules.

### a11y

55 `aria-label`, 16 `<main>`/`<nav>`, 0 `alt=` (no `<img>` tags). Strong baseline.

### i18n

351 lang-pack / t() references. Highest of the four surfaces.

### Persona binding

2 prose references to "Mr. Mwikila" in `src/app/layout.tsx` and `src/lib/sensorium/event-handlers/network-request.ts`. `@borjie/persona-runtime` is not imported.

**fix-recommend:** as with owner-web, bind persona via `persona-runtime` at root layout so admin operators see a typed, switchable active persona.

### Brand lock

Uses `@borjie/design-system` (11 references). One raw hex outside tokens: `themeColor: '#17100A'` in `src/app/layout.tsx:5` — same as owner-web (the brand dark earth tone). This is acceptable as a viewport meta but should also be exported from design-system as `BRAND_THEME_COLOR`.

### Tenant isolation

**Strong: 61 `tenantId` references** across the surface — types, query keys, and filter UIs are tenant-aware throughout `src/lib/internal/`. Spot-check of 5 query files (`slo.ts`, `decision-log.ts`, `corpus.ts`, etc.) all accept `tenantId?` filters.

---

## workforce-mobile (detail)

Package: `@borjie/workforce-mobile` · Expo SDK 51 · expo-router 3.5 · React Native 0.74

### Routes (59 screen files)

- `index.tsx`, `(tabs)/_layout.tsx`, `(tabs)/{ask,cash,decisions,docs,field,home,people,sites}.tsx`
- `onboarding/role.tsx`
- `owner/O-M-01.tsx` through `O-M-25.tsx` (25 screens — owner-on-mobile)
- `worker/W-M-01.tsx` through `W-M-22.tsx` (22 screens — worker)

**37 of 47 `O-M-*` / `W-M-*` files are placeholder shells under 30 lines** wrapping `<PlaceholderList>` and `<FingerprintPlaceholder>`. Sample, `app/owner/O-M-10.tsx:1-23` — entire screen is hardcoded placeholder rows ("Parcel 001 · 2.4 t Au", "Net USD 38,200"). Only 10 screens have meaningful logic (`O-M-01.tsx`, `O-M-02.tsx`, `O-M-09.tsx`, `O-M-21.tsx`, `W-M-04.tsx`, `W-M-07.tsx`, `W-M-09.tsx`, `W-M-11.tsx`, `W-M-14.tsx`, `W-M-19.tsx`).

**fix-recommend:** treat workforce-mobile as MVP-stub state — at launch, hide unimplemented screens behind a feature flag, surface only the 8 tab routes + ~10 functional `O-M-*`/`W-M-*` screens, mark the rest "Inakuja" (coming soon) explicitly in Swahili.

### Buttons

131 Pressable / TouchableOpacity / Button JSX usages. Many are inside placeholder shells with no handler.

**fix-recommend:** audit Pressable handlers in the 37 stub screens — most should be `disabled` until backed.

### Forms (7 form files using react-hook-form)

| File | Validation | Submit |
|---|---|---|
| `src/forms/shiftReportSteps.tsx` | `forms/schemas/shiftReport.ts` (zod) | offline-aware sync queue |
| `app/worker/W-M-04.tsx`, `W-M-07.tsx`, `W-M-09.tsx`, `W-M-11.tsx`, `W-M-14.tsx`, `W-M-19.tsx` | various | `miningApi.post(...)` |

22 `zodResolver` / `z.object` references inside `src/forms/schemas/`.

### API wiring

`src/api/client.ts:1-166` is canonical — exports `fieldApi`, `ownerApi`, `chatApi`, `miningApi` all backed by the same `request<T>` helper that adds `Authorization: Bearer <token>` and 5s timeout. **Does not set `X-Tenant-ID` or any tenant header explicitly** — relies on the gateway to derive tenant from the bearer JWT.

Only 4 raw `fetch()` call sites, mostly inside `api/client.ts` itself.

### Tests

**No `test` script in `apps/workforce-mobile/package.json`. Zero test files (`find apps/workforce-mobile -name "*.test.ts*"` returned 0).**

**fix-recommend:** add `"test": "jest"` and seed with React Native Testing Library tests for `useShiftReportForm`, sync-queue flush, and offline boundary.

### a11y

12 `accessibilityLabel`, 17 `accessibilityRole`, **0 `accessibilityHint`**. Concentrated in the 10 real screens; 37 stub screens lack accessibility props entirely.

**fix-recommend:** lint rule for accessibilityLabel-on-Pressable; backfill the real screens with hints.

### i18n

31 t() / lang-pack references. Far lower than buyer-mobile (209). Many Swahili strings are inline (`'Simu yako'`, `'Saini ya kuingia'`, `'Vifaa vya kuuza'` in placeholder screens).

**fix-recommend:** move inline Swahili out of placeholder screens into `@borjie/language-pack-sw`.

### Persona binding

`@borjie/persona-runtime` is **not** in `package.json` and not referenced anywhere. Persona presence is purely cosmetic.

**fix-recommend:** add `@borjie/persona-runtime` as a workspace dep, wire a `<PersonaProvider>` at the expo-router root.

### Brand lock

`@borjie/design-system` is **not** in `package.json` dependencies. The app uses a local `src/theme/colors.ts:6-26` with 21 raw hex values (earth/gold mining palette: `#1F1410`, `#D4A017`, etc.). These don't match owner-web's `themeColor: '#17100A'` exactly — small brand drift.

**fix-recommend:** publish `@borjie/design-system/mobile-tokens` exporting the same palette, replace `src/theme/colors.ts` with re-exports.

### Tenant isolation

Only 2 `tenantId` references — token-based isolation via the bearer JWT. No explicit tenant header.

**fix-recommend:** set `X-Tenant-ID` header in `buildHeaders()` (`src/api/client.ts:37-54`) from the session-cached tenantId for defense-in-depth.

---

## buyer-mobile (detail)

Package: `@borjie/buyer-mobile` · Expo SDK 51 · expo-router 3.5

### Routes (13 screen files)

- `index.tsx`, `(tabs)/_layout.tsx`
- Tabs: `(tabs)/bids/index`, `(tabs)/documents/index`, `(tabs)/kyc/index`, `(tabs)/marketplace/index`, `(tabs)/profile/index`
- Detail screens: `bids/[id].tsx`, `documents/[id].tsx`, `marketplace/[id].tsx`
- Other: `auth/login.tsx`, `chat/index.tsx`, `kyc/verify.tsx`, `profile/notifications.tsx`

All 13 screens are real (no placeholder shells detected). Tight scope, fully implemented buyer flow.

### Buttons

62 Pressable / TouchableOpacity / Button usages. PrimaryButton component used consistently.

### Forms (7)

| File | Validation | Submit |
|---|---|---|
| `app/auth/login.tsx` | `useForm + zodResolver(phoneSchema)` two-stage OTP | `requestOtp/verifyOtp` mutations |
| `src/kyc/steps/PersonalStep.tsx`, `CompanyStep.tsx`, `AmlStep.tsx`, `ReviewStep.tsx` | zod schemas under `src/schemas/kyc.ts` | KYC mutation pipeline |
| `app/(tabs)/kyc/index.tsx` | aggregates steps | submit on review |
| `src/components/PlaceBidSheet.tsx` | useForm | bid POST |

All wired correctly. Error/success surfaces via `useToast()`.

### API wiring

`src/api/client.ts:60-112` — clean `apiFetch<T>` wrapper with bearer token, 5s timeout (configurable), `Content-Type` auto-set. Service modules under `src/api/{auth,buyers,documents,marketplace}.ts`. Query client wired (`src/api/queryClient.ts`).

### Tests

**No `test` script in `apps/buyer-mobile/package.json`. Zero test files.**

**fix-recommend:** identical to workforce-mobile — add jest/RNTL and cover KYC happy path, login OTP, marketplace listing fetch.

### a11y

Only **3 `accessibilityLabel`** and **3 `accessibilityRole`** across the surface — worse than workforce-mobile in absolute terms.

**fix-recommend:** lint rule, then backfill — focus on PrimaryButton, FormField, marketplace cards.

### i18n

209 `t()` references via `useTranslation` hook. Strong pack coverage. Local pack files: `src/i18n/{en.json,sw.json,index.ts}`.

**fix-recommend:** confirm `src/i18n/en.json` and `src/i18n/sw.json` are kept in sync with `@borjie/language-pack-en/sw` — they should re-export, not duplicate.

### Persona binding

`@borjie/persona-runtime` not in `package.json`, no references. Persona presence is implicit through chat UI strings only.

### Brand lock

`@borjie/design-system` is **not** in `package.json`. Local `src/theme/colors.ts:6-27` with **22 raw hex values** (forest/gold palette: `#1B3A2F`, `#C9A14A`, etc.). The comments note "Aligned with sibling workforce-mobile (#3D2B1F earth tone)" — manual alignment, not enforced.

**fix-recommend:** same as workforce-mobile — both apps should consume the same `@borjie/design-system/mobile-tokens`.

### Tenant isolation

**0 `tenantId` references in the buyer-mobile codebase.** Tenant identity is implicit in the bearer token. Acceptable for a buyer-facing app (buyers are typically multi-tenant marketplace participants), but the api-gateway must enforce.

**fix-recommend:** document the threat model — "buyer-mobile relies on api-gateway to derive tenant from bearer JWT; client does not assert." If buyers cross-tenant, this is fine; if buyers are tenant-scoped, add the header.

---

## Aggregate gaps to close before launch

1. **Mobile test coverage is 0/0 on both apps.** No `test` script, no test files, no `__tests__/` directories. *Fix:* add `jest` + `@testing-library/react-native`, target ≥40% on the launched screens (per workforce-mobile MVP scope of 10 real screens + 13 buyer screens).

2. **`@borjie/persona-runtime` is not wired into any of the 4 apps.** The persona is referenced only in prose strings and screen labels — there's no typed binding, no kill-switch tool catalog, no scope-predicate enforcement on the client side. *Fix:* wire at root layout/providers in each app; depend on `packages/persona-runtime` from each app's `package.json`.

3. **Mobile apps don't depend on `@borjie/design-system`.** Both `apps/workforce-mobile/src/theme/colors.ts` and `apps/buyer-mobile/src/theme/colors.ts` hold ~22 raw hex palettes each. Brand drift risk is real. *Fix:* publish `mobile-tokens` from design-system; replace local theme files with re-exports.

4. **workforce-mobile has 37 placeholder screens shipping into production.** O-M-10, W-M-01, etc. render `<PlaceholderList>` rows with fake content. *Fix:* feature-flag gate the unimplemented screens, mark them "Inakuja" (coming soon) with disabled CTAs, hide from tab navigation pre-launch.

5. **Mobile a11y is thin** — buyer-mobile has only 3 accessibilityLabel occurrences total. *Fix:* enforce ESLint rule (`react-native/no-raw-pressable-without-a11y`) and backfill PrimaryButton, FormField, ListingCard, MessageBubble.

## Aggregate ready-for-launch checklist

- [ ] Mobile: add `test` scripts to both `package.json` files
- [ ] Mobile: minimum 20 tests per app covering login/KYC/marketplace/sync-queue
- [ ] All 4 surfaces: wire `@borjie/persona-runtime` at the root provider
- [ ] Mobile: replace local `theme/colors.ts` with `@borjie/design-system/mobile-tokens`
- [ ] workforce-mobile: feature-flag the 37 placeholder screens; ship only the 10 real screens + 8 tabs + onboarding
- [ ] Mobile: add `accessibilityLabel` + `accessibilityHint` to every Pressable
- [ ] owner-web: migrate `src/lib/api-client.ts` consumers onto `@borjie/api-sdk`
- [ ] owner-web: move map-feature hex colors into `@borjie/design-system/map-tokens`
- [ ] owner-web: consolidate `/licence` and `/licences` routes
- [ ] owner-web: tokenize the inline Swahili strings in `sign-in-form.tsx`
- [ ] admin-web: add zod schema to `LoginForm.tsx`
- [ ] admin-web: confirm/prune `/internal/tenants/detail` route
- [ ] All surfaces: confirm `X-Tenant-ID` header strategy (gateway-derived from JWT vs. client-asserted) and document in `Docs/SECURITY/TENANT_ISOLATION.md`
- [ ] All surfaces: confirm `themeColor` (`#17100A`) is exported from `@borjie/design-system` as `BRAND_THEME_COLOR`

## Evidence anchors

- Test runs: `pnpm -F @borjie/owner-web test` → 3/3; `pnpm -F @borjie/admin-web test` → 147/147; mobile apps have no test script.
- Typecheck: all 4 surfaces pass `tsc --noEmit`.
- Placeholder mobile screens: `apps/workforce-mobile/app/owner/O-M-10.tsx:1-23`, `apps/workforce-mobile/app/worker/W-M-01.tsx:1-22` (representative samples).
- Persona absence: `grep -rE "@borjie/persona-runtime" apps/ --include="*.ts*" | grep -v node_modules` → 0 matches.
- Design-system absence on mobile: `apps/workforce-mobile/package.json` and `apps/buyer-mobile/package.json` do not list `@borjie/design-system` as a dependency.
- Raw hex palettes: `apps/workforce-mobile/src/theme/colors.ts:6-26`, `apps/buyer-mobile/src/theme/colors.ts:6-27`.
- Tenant isolation evidence: `apps/admin-web/src/lib/internal/queries/slo.ts`, `decision-log.ts`, `corpus.ts` (61 refs); `apps/owner-web/src/lib/types/cockpit.ts` (1 ref); `apps/workforce-mobile/src/api/client.ts:37-54` (no tenant header set); `apps/buyer-mobile/src/api/client.ts:60-72` (no tenant header set).
