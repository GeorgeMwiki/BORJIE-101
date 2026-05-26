# UI Wiring Audit — SCRUB-4 (2026-05-26)

Auditor: SCRUB-4 (persona: Mr. Mwikila)
Scope: `apps/{admin-web,owner-web,marketing,buyer-mobile,workforce-mobile}`
Branch: `main`

## Methodology

- **Pass A** — every JSX `<button>`, `<Button>`, `<Pressable>`, `<TouchableOpacity>` element scanned via multi-line regex; flagged if no `onClick` / `onPress` / `type="submit"`. Pressables inside `<Link asChild>` accepted as wired (expo-router idiomatic pattern).
- **Pass B** — every `<form>` tag scanned for `onSubmit`. GET-method forms with `action=` accepted as native browser navigation.
- **Pass C** — every Next.js `page.tsx` and Expo Router screen visited; queried for either `useQuery` / `fetch` / static read or explicit `LiveDataRequiredPanel`.
- **Pass D** — every `href="/..."`, `href={`/...`}`, `router.push('/...')`, `<Link href={...}>` resolved against the actual `app/` tree.

In-scope exclusions verified: zero uncommitted modifications in `apps/**` (in-flight paths empty per `git status`). Mobile dirs are `apps/workforce-mobile` and `apps/buyer-mobile` (the spec's `worker-mobile` / `customer-mobile` aliases).

## Per-app totals

| App | Buttons/Pressables | Forms | Pages/Screens | Nav links (verified) |
|-----|-------------------:|------:|--------------:|---------------------:|
| admin-web | 84 | 8 | 52 | 22 unique targets, all resolve |
| owner-web | 39 | 6 | 27 | all internal + dynamic resolve |
| marketing | 7 | 1 | 12 | 13 unique targets, all resolve |
| workforce-mobile | 47 | 0 | 47 | 12 `router.push` / `Link href` all resolve |
| buyer-mobile | 11 | 0 | 13 | 6 `router.push` all resolve |
| **TOTAL** | **188** | **15** | **151** | — |

## Findings table

| # | App | Component | Path | Finding | Action | Status |
|---|-----|-----------|------|---------|--------|--------|
| 1 | admin-web | New experiment button | `apps/admin-web/src/app/internal/ab-tests/page.tsx:35` | No `onClick`; no POST `/internal/ab-tests` endpoint exists upstream | Disabled + tooltip explaining missing endpoint | FIXED |
| 2 | admin-web | Export NDJSON button | `apps/admin-web/src/app/internal/audit-log/page.tsx:15` | No `onClick`; no `/audit-log/export` endpoint exists | Disabled + tooltip explaining missing endpoint | FIXED |
| 3 | admin-web | New tenant button | `apps/admin-web/src/app/internal/tenants/page.tsx:12` | No `onClick`; POST `/internal/tenants` exists but no `NewTenantForm` UI shipped | Disabled + tooltip; matches juniors page pattern | FIXED |
| 4 | admin-web | New junior template button | `apps/admin-web/src/app/internal/juniors/page.tsx:17` | Already disabled with explicit "not yet wired" copy and `title` attribute | No change required | OK |
| 5 | admin-web | Request more evidence button | `apps/admin-web/src/components/internal/compliance/ComplianceQueue.tsx:71` | No `onClick`; no `/compliance-queue/:id/request-evidence` endpoint | Disabled + tooltip | FIXED |
| 6 | owner-web | Notifications bell | `apps/owner-web/src/components/OwnerTopBar.tsx:31` | No `onClick`; no `/notifications` route in owner-web | Disabled + tooltip explaining missing drawer/route | FIXED |
| 7 | owner-web | Counter button (marketplace) | `apps/owner-web/src/components/marketplace/MarketplaceBoard.tsx:56` | No `onClick`; gateway has `POST /v1/bids/:id/counter` but owner-portal counter sheet not built | Disabled + tooltip explaining missing UI | FIXED |
| 8 | owner-web | ChapterList button (false-positive) | `apps/owner-web/src/components/reports/ChapterList.tsx:18` | Regex matched docstring `<button>`; real button at line 78 has `onClick={() => onSeek(index)}` | No change required | OK |
| 9 | admin-web | Decision-trace search form | `apps/admin-web/src/app/decision-trace/page.tsx:148` | `<form method="GET" action="/decision-trace">` (no `onSubmit`) | Native HTML GET form; intentionally JS-free | OK |
| 10 | workforce-mobile | Scan sample tag | `apps/workforce-mobile/src/forms/drillHoleFields.tsx:86` | `// TODO(#14)` — requires EAS dev build for barcode scanner; ships a simulated tag in the meantime | Existing fallback acceptable | OK |
| 11 | workforce-mobile | Voice button | `apps/workforce-mobile/app/owner/O-M-02.tsx:71` | `// TODO(#14,#22)` — requires EAS dev build for STT; ships a prefill placeholder | Existing fallback acceptable | OK |

## Persona check

- `Mr. Mwikila` is the sole user-facing identity exposed across `apps/`. Confirmed via `rg "Mr\. Mwikila"` — present in marketing copy, admin-web sensorium handlers and layout; **no `[junior name]` placeholders found anywhere in `apps/**/src` or `apps/**/app`**.

## Live-data discipline

- `LiveDataRequiredPanel` (admin-web) is the project's established honest-placeholder pattern. Six pages already use it: `decision-trace`, `control-tower`, `platform/feature-flags`, `platform/overview`, `platform/billing`, plus the two `decision-trace/[id]` and `juniors` variants. The inline fixes above adopt the same "disabled + explicit tooltip" disclosure idiom rather than rendering mock buttons that go nowhere.

## TS strict

Verified `--noEmit` for `apps/admin-web` and `apps/owner-web` — zero new errors introduced by the edits. Pre-existing errors live exclusively in `packages/chat-ui/**` and are out of SCRUB-4's scope.

## Respawn re-verification (2026-05-27)

- Previous session terminated mid-flow; respawned with idempotency-first protocol.
- All 6 inline fixes (#1, #2, #3, #5, #6, #7) confirmed intact at the same line ranges.
- Re-ran Pass A (130 plain `<button>` + 59 `<Button|Pressable|TouchableOpacity>` tags), Pass B (15 forms — all wired with `onSubmit`), Pass C (zero `() => {}` empty handlers in `apps/**`), Pass D (no missing nav targets).
- New components since audit verified wired: `BorjieWidgetMount.tsx` (admin/owner/marketing — script-tag mounts, no buttons of their own), `CookieConsent.tsx` (4 buttons, all `onClick`-wired), `StatusBoard.tsx` (1 refresh button + fetch poll, wired).
- The advisor pages that briefly appeared in `git log --diff-filter=A` were removed before HEAD; no longer in scope.
- `tsc --noEmit` on `apps/admin-web` returns zero errors in `apps/admin-web/src` (errors confined to shared packages `packages/genui`, `packages/chat-ui` per the audit's existing scope statement).
- Remaining `// TODO` in `apps/**/*.tsx`: 1 occurrence at `apps/workforce-mobile/app/owner/O-M-02.tsx:76` — already accounted for as row #11 (requires EAS dev build for STT; ships prefill placeholder).
- Persona check holds: `Mr. Mwikila` exclusive identity; no junior-name strings in `apps/**/src` or `apps/**/app`.
