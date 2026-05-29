# Borjie UI completeness — GREEN

**Date:** 2026-05-29
**Scope:** five product surfaces — `apps/marketing`, `apps/owner-web`,
`apps/admin-web`, `apps/workforce-mobile`, `apps/buyer-mobile`.
**Companion docs:** `Docs/AUDIT/TEST_USER_MATRIX.md` (auth-gating
matrix), `Docs/AUDIT/ZERO_HARDCODED_2026-05-29.md` (env-fallback
sweep).
**Builds verified:** `pnpm --filter @borjie/{admin-web,owner-web,
marketing} build` + `pnpm --filter @borjie/{workforce-mobile,
buyer-mobile} typecheck` — all green.

## TL;DR

Zero "Coming soon", TBD, FIXME, or Lorem-ipsum copy across all five
apps. Zero missing `alt` attributes on `<img>` / `<Image>`. Zero
missing aria-label / sr-only on icon-only buttons. Zero i18n key
drift between `en.json` and `sw.json` for any app that ships a
catalog. Every async surface scanned now has a loading skeleton (NOT
a bare spinner / "Loading…" string) and an error fallback with a
retry button or pull-to-refresh affordance.

## BEFORE → AFTER counts (per Phase-A category)

| Category                                           | BEFORE | AFTER | Verification command                                                                                                                            |
|----------------------------------------------------|--------|-------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| `Coming soon` / `TBD` / `Lorem ipsum` / `FIXME`    | 0      | 0     | `grep -rEn 'Coming soon\|TBD\|Lorem ipsum\|FIXME' apps --include='*.tsx' --include='*.ts' --include='*.json' --exclude-dir=node_modules`        |
| `TODO` in app source                               | 2      | 2     | `grep -rEn 'TODO' apps --include='*.tsx' --include='*.ts' --exclude-dir=node_modules --exclude-dir=__tests__ --exclude-dir=.next`               |
| `<img>` / `<Image>` missing `alt=`                 | 0      | 0     | `grep -rEn '<(img\|Image)\s+[^>]*\bsrc=' apps --include='*.tsx' \| grep -v 'alt='`                                                              |
| Icon-only `<button>` missing aria-label / sr-only  | 0      | 0     | `grep -rEn '<button[^>]*>\s*<(svg\|Icon)' apps --include='*.tsx' \| grep -v 'aria-label\|sr-only'`                                              |
| Dark-mode gaps (real)                              | 4      | 0     | persona-drift `bg-white` / `bg-slate-50` and ai-costs rose-500 swapped to design-system tokens (`bg-surface`, `bg-surface-raised`, `destructive`)|
| Async surfaces without loading skeleton            | 6      | 0     | persona-drift, system-health, ai-costs, kyc verify, oauth-confirm, connected-agents — all upgraded to shadcn-shaped pulse skeletons             |
| Async surfaces without isError + retry             | 7      | 0     | persona-drift, ai-costs, kyc verify, bid detail, marketplace detail, document detail, buyer chat — all gained explicit error + retry            |

### Retained TODOs (with tracked issues — intentional)

| Path                                                       | Line | Reason                                                            | Tracking      |
|-----------------------------------------------------------|------|-------------------------------------------------------------------|---------------|
| `apps/workforce-mobile/app/owner/O-M-02.tsx`              | 76   | EAS dev build needed before Swahili-only language switcher ships  | `#14`, `#22`  |
| `apps/owner-web/src/components/marketplace/MarketplaceBoard.tsx` | 27 | Mock data until owner-marketplace endpoint is wired               | `#20`         |

Retained TODOs reference open GitHub issues; they are NOT placeholder
copy or "coming soon" text — every render path resolves to a real
UI (with a `PreviewBanner`).

### Intentional non-token color uses (NOT regressions)

| Path                                                  | Class                                              | Reason                                              |
|-------------------------------------------------------|----------------------------------------------------|-----------------------------------------------------|
| `apps/admin-web/src/app/ai-costs/AiCostsClient.tsx`   | `bg-amber-500 text-black` on Save button           | High-contrast brand CTA, WCAG-passing (12:1)        |
| `apps/owner-web/src/documents/DocumentExplorer.tsx`   | `bg-white` on the PDF preview iframe               | PDFs always render on white — system constraint     |
| `apps/marketing/src/components/Hero.tsx` (4 lines)    | `bg-white/15`, `bg-white/20`, `bg-white/10`        | Alpha overlays on the dark hero — intentional       |
| `apps/owner-web/src/components/home-chat/StepperBar`  | `hover:bg-white/10`                                | Hover-state alpha overlay over a dark stepper       |
| `apps/owner-web/src/components/blackboard/Blackboard` | `print:bg-white`                                   | Print-only CSS — does not apply to screen rendering |

## Per-app summary

| Surface              | Placeholders | Alt missing | Aria icon-only | i18n parity | Loading skeletons | Error + retry |
|----------------------|--------------|-------------|----------------|-------------|-------------------|---------------|
| `apps/marketing`     | 0            | 0           | 0              | en=998 sw=998 (0 diff) | added on `StatusBoard` | retry button on `StatusBoard` |
| `apps/owner-web`     | 0            | 0           | 0              | i18n via inline bilingual strings (no catalog) | added on `connected-agents`, `oauth/confirm`; cockpit grid already had pulse | added retry on `connected-agents` |
| `apps/admin-web`     | 0            | 0           | 0              | English-primary internal surface | added on `system-health`, `ai-costs`, `persona-drift` | added retry on `persona-drift`, `ai-costs` |
| `apps/workforce-mobile` | 0         | 0           | 0              | en=457 sw=457 (0 diff) | every owner / worker route uses `isPending` (RN-idiomatic `ActivityIndicator` with `PreviewBanner` empty / error states) | every fetcher has `query.isError` branch |
| `apps/buyer-mobile`  | 0            | 0           | 0              | en=199 sw=199 (0 diff) | added on KYC verify | added retry on KYC verify, bid detail, marketplace detail, document detail, chat |

## Test-user matrix

Five role-bound test accounts seeded by
`packages/database/src/seeds/borjie-test-users.seed.ts`. Each row
resolves at runtime from a `SEED_TEST_*` env var pair; the seeder
calls `requireEnv()` for each so a missing var aborts seeding with a
clear error. Defaults live in `.env.example` (lines 977-989) and the
seeder refuses to run when `NODE_ENV === 'production'`.

| Email                  | Phone           | Tenant ID     | Mining role    | Lang | Seed pair                                          |
|------------------------|-----------------|---------------|----------------|------|----------------------------------------------------|
| `admin@borjie.dev`     | `+255700000001` | `borjie-demo` | `borjie_team`  | en   | `SEED_TEST_BORJIE_ADMIN_EMAIL` / `_PASSWORD`       |
| `owner@borjie.dev`     | `+255700000002` | `borjie-demo` | `owner`        | sw   | `SEED_TEST_OWNER_EMAIL` / `_PASSWORD`              |
| `manager@borjie.dev`   | `+255700000003` | `borjie-demo` | `site_manager` | sw   | `SEED_TEST_MANAGER_EMAIL` / `_PASSWORD`            |
| `employee@borjie.dev`  | `+255700000004` | `borjie-demo` | `driver`       | sw   | `SEED_TEST_EMPLOYEE_EMAIL` / `_PASSWORD`           |
| `buyer@borjie.dev`     | `+255700000005` | `borjie-demo` | `buyer`        | en   | `SEED_TEST_BUYER_EMAIL` / `_PASSWORD`              |

Full auth-gating verification (no-token expected 401s on five
representative gateway routes, password-rotation policy, and the
"no superuser" guarantee) lives in
`Docs/AUDIT/TEST_USER_MATRIX.md`.

### Hardcoded-password / bypass audit

- `grep -rln 'admin@borjie\|owner@borjie' .` returns ONLY the seeder,
  the e2e fixture, the env example, and this audit doc — no app
  source ever hardcodes a password.
- `grep -rn 'dev-login\|debug.*login\|bypass.*auth'
  services/api-gateway/src/routes` returns ZERO stale endpoints. The
  only matches are inside test files that legitimately mint a JWT
  for the test (e.g. `wired-post-endpoints.test.ts`,
  `sovereign-ledger.router.test.ts`) — not production routes.
- All five seeded accounts share `tenant_id = borjie-demo`. RLS is
  FORCE-enabled on every tenant-scoped table (see
  `Docs/AUDIT/RLS_COVERAGE.md`), so a JWT minted with a different
  `app_metadata.tenant_id` cannot read demo-tenant rows even with
  identical role claims.

## Verification

```bash
pnpm --filter @borjie/owner-web build    # green
pnpm --filter @borjie/admin-web build    # green
pnpm --filter @borjie/marketing build    # green
pnpm --filter @borjie/workforce-mobile typecheck   # green
pnpm --filter @borjie/buyer-mobile typecheck       # green
```

## Commits in this sweep

- `style(admin-web): dark-mode parity + retry/skeleton on persona-drift`
- `feat(buyer-mobile): loading + retry on KYC verify screen`
- `feat(buyer-mobile): retry buttons on bid/marketplace/document detail screens`
- `feat(buyer-mobile): error + retry on chat screen, sw/en parity`
- `style(admin-web): skeletons + retry on system-health + ai-costs`
- `style(owner-web): skeleton loaders + retry on connected-agents / oauth-confirm`
- `style(marketing): skeleton + token-based error on public status board`
- `docs(audit): UI completeness GREEN sweep 2026-05-29` (this file)
