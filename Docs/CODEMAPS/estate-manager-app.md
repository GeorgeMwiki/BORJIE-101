# Estate-Manager-App Codemap

**Last Updated:** 2026-05-22
**Module:** `apps/estate-manager-app/`
**Port:** 3003
**Tier scope:** org (estate-manager + org-admin personas)

## Purpose

Next.js (App Router) workspace for the estate manager — the operator
running properties day-to-day for an organisation. Owns property
operations (units, leases, inspections, work-orders, vendors), tenant
relationship management (customers, messaging, negotiations,
complaints, SLA), analytics (graph, reports, ask), AI brain surfaces
(brain, briefing, jarvis, ask, coworker), and back-office (payments,
collections, schedule, calendar, tenders).

## Entry points

- `src/app/layout.tsx` — auth + brain sensors + i18n.
- `src/app/page.tsx` — home dashboard.
- `src/app/api/` — Next route handlers (proxy to api-gateway).
- `src/screens/` — `OnboardingPage` + persona-specific screen
  modules.
- `src/features/` — feature-sliced modules (work-orders, inspections,
  arrears, etc.).
- `src/providers/` — query client, brain context, i18n provider.

## Internal structure (route groups under `src/app/`)

- Operations: `properties/`, `units/`, `leases/`, `inspections/`,
  `work-orders/`, `vendors/`, `maintenance/`, `tenders/`.
- Customers: `customers/`, `messaging/`, `negotiations/`,
  `announcements/`, `notifications/`.
- Finance: `payments/`, `collections/`, `documents/`.
- AI surfaces: `brain/`, `briefing/`, `jarvis/`, `ask/`, `coworker/`.
- Analytics: `graph/`, `reports/`, `sla/`.
- Schedule: `schedule/`, `calendar/`.
- Settings: `settings/`, `utilities/`.

## Dependencies

- Upstream: api-gateway + SSE for brain surfaces.
- Downstream: `packages/chat-ui`, `packages/dynamic-sections`,
  `packages/design-system`, `packages/api-client`,
  `packages/ai-copilot` (typed contracts only — no provider calls in
  client code), `packages/genui` (ui_block renderer).

## Common workflows

- **Daily morning briefing** → `briefing/` → calls api-gateway
  `/api/brain/briefing` → SSE stream with prioritised tasks.
- **Triage a maintenance request** → `maintenance/` or `work-
  orders/` → ai-copilot triage proposes vendor + ETA.
- **Negotiate with tenant** → `negotiations/` → brain proposes offer
  + counteroffer flow; every step writes an audit event.
- **Inspect a unit** → `inspections/` → photo upload + signature →
  signed PDF report stored via document-intelligence.
- **Generate report** → `reports/` → renders via reports service;
  cross-portal subscribe for live updates.

## Anti-patterns to avoid

- Never call ai-copilot providers from client — proxy via api-gateway
  so audit + cost-ledger + autonomy guards apply.
- Never hard-code property domain logic — use `domain-models`.
- Multi-currency: read tenant `currencyCode`, never assume KES.
- Voice surfaces require `data-brain-sense` opt-in on input fields;
  default is no-capture (privacy by default).
- Server actions must not bypass api-gateway auth.

## Related codemaps

- [api-gateway.md](./api-gateway.md)
- [central-intelligence.md](./central-intelligence.md)
- [ai-copilot.md](./ai-copilot.md)
- [chat-ui.md](./chat-ui.md)
- [dynamic-sections.md](./dynamic-sections.md)
