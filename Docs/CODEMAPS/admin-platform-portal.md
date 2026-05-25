# Admin Platform Portal Codemap

**Last Updated:** 2026-05-22
**Module:** `apps/admin-platform-portal/`
**Public entry:** `apps/admin-platform-portal/src/app/page.tsx`
**Port:** 3020 (Next.js)

## Purpose

The "Jarvis" admin surface — Anthropic-style command-deck for the
Borjie operator org. Houses the kernel debug + control views:
AI cost ledger, control tower, data-privacy, feature flags,
forecasts, industry view, insights, integrations, the Jarvis chat,
legacy migration, mission eval, persona drift, the radar,
session-replay, system-health, warehouse view, webhook DLQ.
Read-write privileges are gated to platform operators only.

## Entry points

- `src/app/page.tsx` — landing dashboard.
- `src/app/layout.tsx` — root layout.
- `src/middleware.ts` — Next middleware (auth + tier check).
- `src/app/<feature>/page.tsx` — per-feature route.

## Internal structure

Subroutes: `ai-costs`, `api`, `ask`, `control-tower`,
`data-privacy`, `feature-flags`, `forecasts`, `industry`,
`insights`, `integrations`, `jarvis`, `legacy-migration`, `login`,
`mission-eval`, `persona-drift`, `platform`, `radar`,
`session-replay`, `system-health`, `warehouse`, `webhook-dlq`.

- `src/components/` — feature-local components.
- `src/lib/` — feature-local utilities.

## Dependencies

- Upstream: `@borjie/design-system`, `@borjie/api-sdk`,
  `@borjie/central-intelligence`, `@borjie/chat-ui`,
  `@borjie/forecasting`, `@borjie/spotlight`.
- Downstream: api-gateway, mcp-server.

## Common workflows

- **Open Jarvis** → `/jarvis` route streams via api-sdk.
- **Review costs** → `/ai-costs` reads observability cost ledger.
- **Replay session** → `/session-replay` over decision-trace OTel.

## Anti-patterns to avoid

- Never embed tenant data in admin routes — show platform aggregates.
- Never use unauth'd routes — middleware enforces operator tier.
- Never call services directly from a page — go via api-sdk.

## Related codemaps

- [chat-ui.md](./chat-ui.md), [design-system.md](./design-system.md)
- [central-intelligence.md](./central-intelligence.md) — Jarvis backend
- [observability.md](./observability.md) — cost + replay
