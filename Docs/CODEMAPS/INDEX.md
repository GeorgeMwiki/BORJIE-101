# Borjie Codemaps — Index

**Last Updated:** 2026-05-22
**Wave:** Wave 28+ (wave-4 perf indexes + real provider adapters + memory layer + UI-1..5 + P-6..10 + F4 every-package coverage)

This directory contains module-level architectural maps for the Borjie
multi-tenant property-management SaaS. Each codemap is a one-page reference
describing the public surface, internal structure, dependencies, and common
workflows of one package or app.

## How to read these maps

Each codemap follows the same shape:

1. Purpose (1-2 sentences) + tier scope
2. Entry points (public exports + key paths)
3. Internal structure (subdirs / key files)
4. Dependencies (upstream + downstream)
5. Common workflows (file:line pointers)
6. Anti-patterns to avoid
7. Related codemaps

Codemaps are written from source. When source moves, update the codemap.

## Codemaps

### Cognitive core (the Brain)

| Codemap | Module | Purpose |
|---------|--------|---------|
| [central-intelligence.md](./central-intelligence.md) | `packages/central-intelligence/` | 12-agent embodied-agent kernel — sensors, persona, policy gate, theory-of-mind, debate, LATS, four-eye |
| [ai-copilot.md](./ai-copilot.md) | `packages/ai-copilot/` | Personas, prompts, knowledge, security, copilot workflows |
| [persona-runtime.md](./persona-runtime.md) | `packages/persona-runtime/` | Piece D — title→tier hierarchy, persona bindings, tool catalogue, scope predicates |
| [conversation-threads.md](./conversation-threads.md) | `packages/conversation-threads/` | Piece F — MD-tier projects + threads with hash-chained messages and versioned artifacts |
| [observability.md](./observability.md) | `packages/observability/` + `evals/` | OTel + audit + online-judge + decision-trace + red-team corpora |
| [forecasting.md](./forecasting.md) | `packages/forecasting/` | Probabilistic forecasting + split conformal intervals |
| [forecasting-engine.md](./forecasting-engine.md) | `packages/forecasting-engine/` | Orchestrator, scenarios, sandbox, world-model, feedback, scoring |
| [market-intelligence.md](./market-intelligence.md) | `packages/market-intelligence/` | External market data + comparables + seasonality |
| [marketing-brain.md](./marketing-brain.md) | `packages/marketing-brain/` | Lead capture, qualifier, pricing advisor, blog engine |
| [autonomy-governance.md](./autonomy-governance.md) | `packages/autonomy-governance/` | Caps + handoff + SLO autonomy gates |
| [browser-perception.md](./browser-perception.md) | `packages/browser-perception/` | A11y-tree perception + legacy-portal driver |
| [graph-sync.md](./graph-sync.md) | `packages/graph-sync/` | Tenant-scoped Neo4j projector |
| [graph-privacy.md](./graph-privacy.md) | `packages/graph-privacy/` | Differential-privacy aggregator budget |
| [aop-compiler.md](./aop-compiler.md) | `packages/aop-compiler/` | Agent-Oriented Programming DSL → kernel plan |
| [consolidation-worker.md](./consolidation-worker.md) | `services/consolidation-worker/` | Four-pass sleep consolidation |
| [workforce-orchestrator.md](./workforce-orchestrator.md) | `packages/workforce-orchestrator/` | Piece M — agentic workforce management (assign / follow-up / check-in / perf / advisory) |
| [long-horizon-agent.md](./long-horizon-agent.md) | `packages/long-horizon-agent/` | Piece Q — multi-day mission lifecycle (plan, dispatch, checkpoint, drift, replan, outcome) |

### Platform spine

| Codemap | Module | Purpose |
|---------|--------|---------|
| [api-gateway.md](./api-gateway.md) | `services/api-gateway/` | Hono BFF + composition root |
| [database.md](./database.md) | `packages/database/` | Drizzle schemas, migrations, RLS, pgvector |
| [core-entity.md](./core-entity.md) | `packages/database/src/schemas/core-entity/` | Piece A — universal asset & entity model (polymorphic root + thin per-type extensions + tenant custom fields) |
| [payments-ledger.md](./payments-ledger.md) | `services/payments-ledger/` | Drizzle double-entry ledger |
| [payments-service.md](./payments-service.md) | `services/payments/` | M-Pesa STK + reconciliation channel |
| [agent-platform.md](./agent-platform.md) | `packages/agent-platform/` | Agent auth, idempotency, A2A errors |
| [authz-policy.md](./authz-policy.md) | `packages/authz-policy/` | RBAC + ABAC + JWT |
| [config.md](./config.md) | `packages/config/` | Env schema + Redis factory |
| [compliance-plugins.md](./compliance-plugins.md) | `packages/compliance-plugins/` | Per-country compliance plug-ins |
| [domain-services.md](./domain-services.md) | `services/domain-services/` | Core business logic + repositories |
| [identity.md](./identity.md) | `services/identity/` | Universal tenant identity + multi-org |
| [notifications-service.md](./notifications-service.md) | `services/notifications/` | WhatsApp / SMS / email / push / in-app |
| [webhooks-service.md](./webhooks-service.md) | `services/webhooks/` | Outbound webhook delivery |
| [outbox-processor.md](./outbox-processor.md) | `services/outbox-processor/` | Standalone outbox drainer |
| [document-intelligence.md](./document-intelligence.md) | `services/document-intelligence/` | OCR + fraud + evidence packs |
| [document-analysis.md](./document-analysis.md) | `packages/document-analysis/` | Piece K pipeline: ingest → OCR → extract → resolve → route |
| [file-ingest.md](./file-ingest.md) | `packages/file-ingest/` | Conversational ingest pipeline |
| [geo-parcels.md](./geo-parcels.md) | `packages/geo-parcels/` | Walk-and-capture land + map subdivide + cross-tenant marketplace (Piece N) |
| [enterprise-hardening.md](./enterprise-hardening.md) | `packages/enterprise-hardening/` | SOC2 + circuit breaker + DR + FinOps |
| [connectors.md](./connectors.md) | `packages/connectors/` | External-system adapter framework |
| [lpms-connector.md](./lpms-connector.md) | `packages/lpms-connector/` | Legacy LPMS CSV/JSON/XML adapters |
| [mcp-server.md](./mcp-server.md) | `packages/mcp-server/` | MCP base server + tool registry |
| [mcp-servers.md](./mcp-servers.md) | `services/mcp-server-*/` | Per-integration MCP servers |
| [svc-reports.md](./svc-reports.md) | `services/reports/` | PDF / Excel / CSV + scheduler |
| [report-engine.md](./report-engine.md) | `packages/report-engine/` | Piece H — templated PDF/DOCX/PPTX in tenant brand |
| [presentation-engine.md](./presentation-engine.md) | `packages/presentation-engine/` | Piece H — themed slide decks (5 built-in themes) |
| [tutoring-skill-pack.md](./tutoring-skill-pack.md) | `packages/tutoring-skill-pack/` | Piece H — Socratic tutor with data-grounded examples |

### User surface

| Codemap | Module | Purpose |
|---------|--------|---------|
| [dynamic-sections.md](./dynamic-sections.md) | `packages/dynamic-sections/` | Adaptive layout engine (UI-1) |
| [tab-need-detector.md](./tab-need-detector.md) | `packages/tab-need-detector/` | Piece O — need detection + tab spawning + per-user personalisation |
| [chat-ui.md](./chat-ui.md) | `packages/chat-ui/` | ProactiveHint, MasteryGate, blackboard, voice |
| [design-system.md](./design-system.md) | `packages/design-system/` | shadcn + Tailwind v4 + OKLCH primitives |
| [api-client.md](./api-client.md) | `packages/api-client/` | Browser HTTP client + React Query hooks |
| [api-sdk.md](./api-sdk.md) | `packages/api-sdk/` | Server / Jarvis typed SDK |
| [genui.md](./genui.md) | `packages/genui/` | Generative-UI renderer registry |
| [spotlight.md](./spotlight.md) | `packages/spotlight/` | Cmd+K palette + entity resolver |
| [realtime-rooms.md](./realtime-rooms.md) | `packages/realtime-rooms/` | Yjs collaboration + Brain peer |

### Apps

| Codemap | Module | Purpose |
|---------|--------|---------|
| [customer-app.md](./customer-app.md) | `apps/customer-app/` | Next.js tenant portal (port 3002) |
| [estate-manager-app.md](./estate-manager-app.md) | `apps/estate-manager-app/` | Next.js estate-manager workspace (port 3003) |
| [owner-portal.md](./owner-portal.md) | `apps/owner-portal/` | Vite owner SPA (port 3001) |
| [admin-platform-portal.md](./admin-platform-portal.md) | `apps/admin-platform-portal/` | Next.js operator command-deck (port 3020) |
| [admin-portal.md](./admin-portal.md) | `apps/admin-portal/` | Deprecated Vite admin SPA |
| [marketing.md](./marketing.md) | `apps/marketing/` | Public marketing site (port 3010) |
| [borjie-mobile.md](./borjie-mobile.md) | `apps/borjie_app/` | Flutter iOS/Android/Web client |

### Domain models

| Codemap | Module | Purpose |
|---------|--------|---------|
| [domain-models.md](./domain-models.md) | `packages/domain-models/` | Shared enums, schemas, types — zero-dep leaf |

### Cross-cutting

| Codemap | Purpose |
|---------|---------|
| [DEPENDENCY-GRAPH.md](./DEPENDENCY-GRAPH.md) | Module dependency graph (Mermaid + top-30 edges) |

## Reading order for new engineers

1. [`Docs/MEMORY.md`](../MEMORY.md) — long-lived assistant context
2. [`Docs/ARCHITECTURE.md`](../ARCHITECTURE.md) — synthesis
3. [`Docs/MODULAR_MONOLITH.md`](../MODULAR_MONOLITH.md) — package boundaries
4. [api-gateway.md](./api-gateway.md) — request lifecycle + composition root
5. [database.md](./database.md) — RLS, GUC, migration discipline
6. [central-intelligence.md](./central-intelligence.md) — kernel pipeline (14 steps)
7. [payments-ledger.md](./payments-ledger.md) — money path (CRITICAL)
8. [DEPENDENCY-GRAPH.md](./DEPENDENCY-GRAPH.md) — see the whole picture
9. Remaining codemaps as feature work demands

## ADRs

Architecture decisions live in [`Docs/ADR/`](../ADR/README.md).
Recent ADRs of note:
- ADR-0010 — Fail-loud currency (payments-ledger Wave 12)
- ADR-0011 — Three-agent debate at stakes≥high (P-10)
- ADR-0012 — Adaptive UI persistence (BL5 / UI-1)
- ADR-0013 — LITFIN-style architecture-imports lint (Wave 13)

## Related documents

- [`Docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`Docs/MODULAR_MONOLITH.md`](../MODULAR_MONOLITH.md)
- [`Docs/DATA_FLOWS.md`](../DATA_FLOWS.md)
- [`Docs/SECURITY.md`](../SECURITY.md)
- [`CHANGELOG.md`](../../CHANGELOG.md)
- [`Docs/MEMORY.md`](../MEMORY.md) — session-load file for LLM assistants
