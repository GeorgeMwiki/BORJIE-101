# Customer-App Codemap

**Last Updated:** 2026-05-22
**Module:** `apps/customer-app/`
**Port:** 3002
**Tier scope:** tenant (resident persona) + public marketing routes

## Purpose

Next.js (App Router) customer surface — the resident-facing experience
and the public marketing site. Three personas blend in one app:
prospective customer (marketing), authenticated tenant (lease,
payments, maintenance, documents), and "for-X" segment landing pages
(managers, owners, station masters, tenants).

## Entry points

- `src/app/layout.tsx` — root layout (i18n provider, brain sensors).
- `src/app/page.tsx` — landing.
- `src/app/api/` — Next route handlers (proxies to api-gateway).
- `src/middleware.ts` — Supabase auth + locale negotiation.
- `src/screens/` — `ChatPage`, `DocumentsPage`, `MaintenancePage`,
  `OnboardingPage`, `PaymentsPage` (reusable screen modules).

## Internal structure (route groups under `src/app/`)

- Authenticated tenant: `lease/`, `payments/`, `maintenance/`,
  `documents/`, `inspection/`, `requests/`, `messages/`,
  `notifications/`, `profile/`, `settings/`, `feedback/`, `support/`,
  `emergencies/`, `my-credit/`.
- Conversational: `assistant/`, `jarvis/`.
- Onboarding: `onboarding/`, `signup/`, `register/`, `auth/`.
- Community + marketing: `community/`, `marketplace/`, `compare/`,
  `pricing/`, `blog/`, `announcements/`, `how-it-works/`.
- Segment landing: `for-managers/`, `for-owners/`,
  `for-station-masters/`, `for-tenants/`.
- Utility: `utilities/`, `offline/`, `error.tsx`, `not-found.tsx`.
- `src/components/` — shared UI; `src/contexts/`, `src/i18n.ts`,
  `src/lib/`.

## Dependencies

- Upstream: api-gateway (REST + SSE for chat), `packages/chat-ui`
  (ProactiveHint, MasteryGate, DegradedBanner, blackboard, voice),
  `packages/dynamic-sections`, `packages/design-system`,
  `packages/api-client`.
- Downstream: Supabase Auth (session cookies), api-gateway,
  M-Pesa STK push (deep link).

## Common workflows

- **Tenant pays rent** → `payments/` page → M-Pesa STK CTA → status
  polled from api-gateway → success banner + ledger refresh.
- **Submit maintenance request** → `maintenance/` form → POST
  api-gateway → triage handled by ai-copilot.
- **Sign onboarding** → `onboarding/` → signature pad → KYC
  document upload → status webhook.
- **Chat with assistant** → `assistant/` or `jarvis/` → SSE from
  api-gateway → blackboard panel renders artifacts.
- **i18n** → `src/i18n.ts` + next-intl v4; en-TZ + sw-TZ defaults;
  locale negotiation in middleware.

## Anti-patterns to avoid

- Never bypass api-gateway — no direct Supabase queries from client.
- Never hard-code currency / locale — read from tenant context (135
  callsite thread completed for owner-portal; same pattern here).
- Never call payments providers directly — STK push request goes
  through api-gateway only.
- Public marketing pages must work without auth — gate carefully.
- Never `console.log` PII; use observability wrapper.

## Related codemaps

- [api-gateway.md](./api-gateway.md)
- [chat-ui.md](./chat-ui.md)
- [dynamic-sections.md](./dynamic-sections.md)
- [payments-ledger.md](./payments-ledger.md)
