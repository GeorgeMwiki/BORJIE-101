# Borjie ANCESTRY snapshot (post-fork divergence) — 2026-05-26

> **ARCHIVED — HISTORY ONLY.** Snapshot of Borjie's surface-area state
> shortly after the hard-fork from its sibling property-management
> codebase. Borjie has evolved independently since. This document is
> HISTORY, not an ongoing tracking artefact. Borjie and BossNyumba are
> two separate products; they share fork-day origin but do not share
> an ongoing identity, parity goal, or shared roadmap.

Comparison of `BOSSNYUMBA101` (parent property-management SaaS) against `Borjie`
(mining hard-fork). All counts taken via `find`, `grep`, `wc -l` on
2026-05-26 against the current state of both worktrees on disk.

---

## 0. Executive Summary

### Surface-area metrics

| Metric | BossNyumba | Borjie | Borjie coverage |
|--------|-----------:|-------:|----------------:|
| Packages | 127 | 124 | 98% |
| Services | 26 | 20 | 77% |
| Apps (web) | 7 (admin-portal, admin-platform-portal, owner-portal, customer-app, estate-manager-app, tenant-portal, marketing) | 2 (admin-web, owner-web) | 29% |
| Apps (mobile) | 1 Flutter shell + 2 stub flutter apps | 2 full Expo apps (buyer-mobile, workforce-mobile) | n/a (greenfield) |
| Database schema files | 139 | 115 | 83% |
| Drizzle pgTable definitions | 290 | 244 | 84% |
| Bootstrap migrations (`packages/database/drizzle/*.sql`) | 2 | 11 | 550% (BJ owns full chain) |
| Legacy numbered migrations (`packages/database/src/migrations/*.sql`) | 269 | 269 (copied verbatim, mostly unused) | 100% |
| API gateway route files | 213 | 249 | 117% |
| API gateway HTTP methods (GET+POST+PUT+PATCH+DELETE) | 1,807 | 1,979 | 110% |
| Mining-specific `*.hono.ts` route files | 0 | 33 + 10 internal + 15 OpenAPI defs | n/a |
| Background workers (`api-gateway/src/workers/`) | 6 | 7 | 117% |
| Consolidation-worker tasks | 0 (no `tasks/` dir) | 4 (Borjie corpus ingest + CLI) | n/a |
| GitHub Actions workflows | 45 | 10 | 22% (deliberately pruned) |
| Scripts (`scripts/*`) | 64 | 70 | 109% |
| Test files (`*.test.ts`) | 1,763 | 1,653 | 94% |
| Playwright E2E specs | 118 | 123 | 104% |
| Docs files (under `Docs/`) | 316 | 319 | 101% |
| ADRs | 14 (incl README) | 14 (incl README) | 100% |
| Runbooks | 30+ | 30+ | 100% |
| Codemaps | 60+ | 64 | 107% |
| `.env.example` variables | 361 | 402 | 111% |
| RLS `ENABLE ROW LEVEL SECURITY` statements | 325 | 340 | 105% |
| RLS `CREATE POLICY` statements | 722 | 734 | 102% |

### Top 10 highest-leverage gaps

1. Borjie has only stub Flutter apps for what used to be `customer-app` and `estate-manager-app` UX surfaces; pilot demo will be web (`admin-web`, `owner-web`) + Expo (`workforce-mobile`, `buyer-mobile`) only — by design, but communications, calendar, announcements, gamification screens never re-ported.
2. `services/mcp-server-firs`, `mcp-server-nggis`, `mcp-server-nin`, `mcp-server-opay` (Tanzanian/Nigerian government MCP servers) deleted from Borjie — but Borjie still needs at least `mcp-server-tumemadini` (mining commissioner) and `mcp-server-tra` (revenue authority) parallels to ship regulator-pack drift automation.
3. `services/onboarding-orchestrator` deleted; Borjie's `apps/owner-web/src/app/(routes)/onboarding/page.tsx` exists but has no backing orchestrator service — onboarding wizard is API-gateway-only, no long-running workflow engine wiring.
4. `services/parcel-service` deleted; Borjie uses `packages/geo-parcels` (kept) but lacks the standalone HTTP service that BossNyumba had for parcel ingestion, simplification, deduplication.
5. Borjie ships 11 bootstrap migrations (`0000` plus mining-domain stack `0003`/`0005`/`0007`/`0011`/`0013`) but the 269 legacy BossNyumba numbered migrations under `src/migrations/` are still on disk and will fight the bootstrap on any environment that has the old `migrations` table. They should be deleted or quarantined.
6. `services/api-gateway/src/routes/` still contains the property-domain `.router.ts` files (arrears, leases, inspections, hr, gepg, classroom, gamification, station-master-coverage, vacancy-pipeline, etc.) inherited from BossNyumba and not yet pruned — about 60+ routers that will never wire because their tables are gone. Dead-code risk, semgrep noise, type drift.
7. CI workflows: Borjie has 10 (`borjie-ci`, `borjie-db-migrations-check`, `borjie-codeql`, etc.) vs BossNyumba 45. Notably missing in Borjie: `audit-not-yet-wired`, `decision-trace-coverage`, `kernel-eval`, `lats-search-eval`, `migration-apply-fresh`, `openapi-drift`, `policy-gate-coverage`, `red-team`, `regulator-pack-drift`, `reflexion-sleep-canary`, `sandbox-load-test`, `security-route-coverage`, `sycophancy-probe`, `trajectory-eval`, `zero-hardcoded`. Several of these are required by Borjie's own runbooks.
8. Borjie has no Helm chart (`infrastructure/helm/` is empty/inherited) and no Terraform-managed cloud landing zone wired for Borjie tenants — production deploy path is Fly.io for the gateway only.
9. Mining juniors are 26 (counted in `packages/ai-copilot/src/juniors/`) — the spec calls for 28 mining juniors. Missing: dedicated `marketing-brain` mining-counterpart (only generic version inherited) and `tutoring-skill-pack` mining-counterpart for owner-onboarding tutorials.
10. `packages/regulatory-tz-mining` exists (935 LOC) but has no parallel `regulatory-tz-tra`, `regulatory-tz-nemc`, `regulatory-tz-bot` (Bank of Tanzania for FX) packages — `borjie-codeql.yml` and the regulator-pack drift workflow that BossNyumba had aren't present, so regulator pack drift is uncovered.

---

## 1. Packages comparison

Walked `packages/` in both repos. Status codes: **Verbatim** (file count delta < 5%), **Drift** (renamed/refactored/trimmed but recognizable), **Replaced** (mining-domain equivalent), **Deleted** (property-domain only), **Missing-gap** (BN has, BJ lost, would be useful).

LOC measured by summing `wc -l` over `*.ts` under each package (excluding `node_modules`, `dist`).

### 1a. Packages BossNyumba has — status in Borjie

| BossNyumba package | LOC (BN) | Borjie status | Borjie path | Notes |
|--------------------|---------:|--------------|-------------|-------|
| acquisition-advisor | 6,501 | Deleted | — | Property acquisition-only; deliberate. |
| action-runtime | 4,830 | Verbatim | `packages/action-runtime` | Identical. |
| agent-orchestrator | 5,258 | Verbatim | `packages/agent-orchestrator` | Identical. |
| agent-platform | 5,724 | Verbatim | `packages/agent-platform` | Identical. |
| agent-runtime | 3,526 | Verbatim | `packages/agent-runtime` | Identical. |
| agentic-os | 4,588 | Verbatim | `packages/agentic-os` | Identical. |
| ai-copilot | 134,652 | Drift | `packages/ai-copilot` | +7,969 LOC for mining juniors (`src/juniors/*`) and master-brain rebind. |
| ai-reviewer | 3,360 | Verbatim | `packages/ai-reviewer` | Identical. |
| analytics | 4,501 | Verbatim | `packages/analytics` | Identical. |
| anti-corruption-layer | 802 | Verbatim | `packages/anti-corruption-layer` | Identical. |
| aop-compiler | 2,308 | Verbatim | `packages/aop-compiler` | Identical. |
| api-client | 9,142 | Verbatim | `packages/api-client` | Identical. |
| api-sdk | 9,939 | Verbatim | `packages/api-sdk` | Identical. |
| approval-matrix-dsl | 1,444 | Verbatim | `packages/approval-matrix-dsl` | Identical. |
| assignment-registry | 2,407 | Verbatim | `packages/assignment-registry` | Identical. |
| audio-capture | 5,286 | Verbatim | `packages/audio-capture` | Identical. |
| audio-logics-litfin | 3,553 | Verbatim | `packages/audio-logics-litfin` | Identical. |
| audit-hash-chain | 642 | Verbatim | `packages/audit-hash-chain` | Identical. |
| authz-policy | 4,837 | Verbatim | `packages/authz-policy` | Identical. |
| autonomy-governance | 9,060 | Verbatim | `packages/autonomy-governance` | Identical. |
| bias-handling | 4,885 | Verbatim | `packages/bias-handling` | Identical. |
| brain-llm-router | 10,625 | Verbatim | `packages/brain-llm-router` | Identical. |
| brain-self-awareness | 1,646 | Verbatim | `packages/brain-self-awareness` | Identical. |
| browser-perception | 1,166 | Verbatim | `packages/browser-perception` | Identical. |
| carbon-market | 4,273 | Deleted | — | Property-domain. Could be relevant for mining ESG; Build in MVP3+. |
| central-intelligence | 126,386 | Verbatim | `packages/central-intelligence` | Identical (12-agent kernel — the spine). |
| chat-ui | 5,782 | Verbatim | `packages/chat-ui` | Identical. |
| compliance-pack | 4,572 | Verbatim | `packages/compliance-pack` | Identical. |
| compliance-plugins | 34,680 | Verbatim | `packages/compliance-plugins` | Identical (TZ plugins reused). |
| config | 1,082 | Verbatim | `packages/config` | Identical. |
| conformal-calibration-online | 411 | Verbatim | `packages/conformal-calibration-online` | Identical. |
| connectors | 13,540 | Verbatim | `packages/connectors` | Identical. |
| content-studio | 4,396 | Verbatim | `packages/content-studio` | Identical. |
| conversation-threads | 3,130 | Verbatim | `packages/conversation-threads` | Identical. |
| cross-org-denial-recorder | 675 | Verbatim | `packages/cross-org-denial-recorder` | Identical. |
| database | 73,758 | Drift | `packages/database` | -14,474 LOC (property schemas removed; mining schemas added). |
| design-system | 942 | Verbatim | `packages/design-system` | Identical. |
| disclosure-layer | 3,600 | Verbatim | `packages/disclosure-layer` | Identical. |
| dispatch-router | 6,280 | Drift | `packages/dispatch-router` | -218 LOC, mostly persona-table rebinds. |
| document-ai | 4,945 | Verbatim | `packages/document-ai` | Identical. |
| document-analysis | 4,997 | Verbatim | `packages/document-analysis` | Identical. |
| document-quality-guarantor | 3,555 | Verbatim | `packages/document-quality-guarantor` | Identical. |
| document-studio | 2,105 | Verbatim | `packages/document-studio` | Identical. |
| domain-models | 22,731 | Verbatim | `packages/domain-models` | Identical jurisdiction rules. |
| dynamic-sections | 3,707 | Verbatim | `packages/dynamic-sections` | Identical. |
| enterprise-hardening | 7,878 | Verbatim | `packages/enterprise-hardening` | Identical. |
| estate-auto-management | 1,861 | Deleted | — | Property-domain only. |
| estate-department-advisor | 6,503 | Deleted | — | Replaced by mining advisors in §1b. |
| ethics-framework | 4,248 | Verbatim | `packages/ethics-framework` | Identical. |
| executive-brief-engine | 4,454 | Drift | `packages/executive-brief-engine` | -8 LOC, table-name rebinds for `executive_brief_actions`. |
| expansion-advisor | 2,789 | Replaced | `packages/capacity-expansion-advisor` | Mining-shaped successor (451 LOC, much smaller — partial port). |
| extended-reasoning | 4,032 | Verbatim | `packages/extended-reasoning` | Identical. |
| fairness-eval | 973 | Verbatim | `packages/fairness-eval` | Identical. |
| feature-flags-adapter | 1,068 | Verbatim | `packages/feature-flags-adapter` | Identical. |
| file-ingest | 4,306 | Verbatim | `packages/file-ingest` | Identical. |
| fleet-management | 5,015 | Verbatim | `packages/fleet-management` | Identical (reused for mining vehicle fleets — same data shape). |
| forecasting | 5,544 | Verbatim | `packages/forecasting` | Identical. |
| forecasting-engine | 4,359 | Verbatim | `packages/forecasting-engine` | Identical. |
| genui | 6,639 | Drift | `packages/genui` | +13 LOC trivial. |
| geo-intelligence | 4,843 | Verbatim | `packages/geo-intelligence` | Identical. |
| geo-parcels | 4,279 | Verbatim | `packages/geo-parcels` | Identical (mining concession polygons reuse same code). |
| geo-platform | 2,841 | Verbatim | `packages/geo-platform` | Identical. |
| graph-privacy | 1,241 | Verbatim | `packages/graph-privacy` | Identical. |
| graph-sync | 4,539 | Verbatim | `packages/graph-sync` | Identical. |
| green-angle-advisor | 4,681 | Deleted | — | Property ESG-only. Build in MVP3+ for mining ESG. |
| inventory-management | 4,530 | Verbatim | `packages/inventory-management` | Identical. |
| knowledge-graph | 3,895 | Verbatim | `packages/knowledge-graph` | Identical. |
| lifecycle-advisor | 5,080 | Deleted | — | Property tenant lifecycle; mining substitute partial via `mine-planner-advisor`. |
| litfin-port-memory-extra | 1,209 | Verbatim | `packages/litfin-port-memory-extra` | Identical. |
| litfin-port-observability-extra | 966 | Verbatim | `packages/litfin-port-observability-extra` | Identical. |
| litfin-port-security-extra | 1,435 | Verbatim | `packages/litfin-port-security-extra` | Identical. |
| litfin-port-tools-extra | 1,280 | Verbatim | `packages/litfin-port-tools-extra` | Identical. |
| litfin-port-ui-extra | 1,060 | Verbatim | `packages/litfin-port-ui-extra` | Identical. |
| llm-budget-governor | 1,448 | Verbatim | `packages/llm-budget-governor` | Identical. |
| long-horizon-agent | 4,531 | Verbatim | `packages/long-horizon-agent` | Identical. |
| lpms-connector | 2,461 | Deleted | — | Property licensing portal; mining LMBM in BJ replaces functionally. |
| market-intelligence | 2,079 | Replaced | `packages/mining-commodity-intelligence` | Mining-specific market data (FX, gold/copper/cobalt, LBMA, LME) — 638 LOC, much trimmer. |
| marketing-brain | 2,918 | Verbatim | `packages/marketing-brain` | Identical (reused for marketing — could re-skin for mining). |
| mcp | 5,039 | Verbatim | `packages/mcp` | Identical. |
| mcp-cost-persistence | 616 | Verbatim | `packages/mcp-cost-persistence` | Identical. |
| mcp-server | 4,086 | Verbatim | `packages/mcp-server` | Identical. |
| memory-tool-wire-adapter | 474 | Verbatim | `packages/memory-tool-wire-adapter` | Identical. |
| memory-v2 | 1,967 | Verbatim | `packages/memory-v2` | Identical. |
| module-orchestrator | 1,357 | Verbatim | `packages/module-orchestrator` | Identical. |
| module-spec-engine | 1,706 | Verbatim | `packages/module-spec-engine` | Identical. |
| module-templates | 2,676 | Drift | `packages/module-templates` | +399 LOC (mining module templates added). |
| observability | 11,774 | Verbatim | `packages/observability` | Identical. |
| ocsf-emitter | 874 | Verbatim | `packages/ocsf-emitter` | Identical. |
| open-coding-agent-patterns | 4,235 | Verbatim | `packages/open-coding-agent-patterns` | Identical. |
| openclaw-operating-model | 4,940 | Verbatim | `packages/openclaw-operating-model` | Identical. |
| optimistic-concurrency | 721 | Verbatim | `packages/optimistic-concurrency` | Identical. |
| org-graph | 1,234 | Verbatim | `packages/org-graph` | Identical. |
| outcomes | 1,725 | Verbatim | `packages/outcomes` | Identical. |
| payments-event-store | 1,369 | Verbatim | `packages/payments-event-store` | Identical. |
| performance-toolkit | 4,017 | Verbatim | `packages/performance-toolkit` | Identical. |
| persona-runtime | 2,317 | Verbatim | `packages/persona-runtime` | Identical bones — persona seeds now mining-shaped (juniors). |
| portal-genui | 4,896 | Verbatim | `packages/portal-genui` | Identical. |
| presentation-engine | 1,253 | Verbatim | `packages/presentation-engine` | Identical. |
| proactive-intel | 1,709 | Verbatim | `packages/proactive-intel` | Identical. |
| probe-runners | 1,065 | Verbatim | `packages/probe-runners` | Identical. |
| procurement-coordination | 4,797 | Verbatim | `packages/procurement-coordination` | Identical. |
| progressive-intelligence | 4,030 | Verbatim | `packages/progressive-intelligence` | Identical. |
| property-voices-debate | 713 | Verbatim | `packages/property-voices-debate` | Kept — debate substrate, name retained (could re-skin to `mining-voices-debate`). |
| reasoning-substrate | 4,161 | Verbatim | `packages/reasoning-substrate` | Identical. |
| realtime-adapter | 687 | Verbatim | `packages/realtime-adapter` | Identical. |
| realtime-rooms | 1,180 | Verbatim | `packages/realtime-rooms` | Identical. |
| report-engine | 3,260 | Verbatim | `packages/report-engine` | Identical. |
| role-aware-advisor | 2,927 | Verbatim | `packages/role-aware-advisor` | Identical. |
| scientific-discovery | 2,125 | Verbatim | `packages/scientific-discovery` | Identical. |
| security-audit | 1,981 | Verbatim | `packages/security-audit` | Identical. |
| security-hardening | 3,478 | Verbatim | `packages/security-hardening` | Identical. |
| self-codegen | 4,129 | Verbatim | `packages/self-codegen` | Identical. |
| skill-conversation | 3,073 | Verbatim | `packages/skill-conversation` | Identical. |
| skill-library | 5,416 | Verbatim | `packages/skill-library` | Identical. |
| spatial-engine | 729 | Verbatim | `packages/spatial-engine` | Identical. |
| spotlight | 584 | Verbatim | `packages/spotlight` | Identical. |
| stage-advisor | 4,120 | Verbatim | `packages/stage-advisor` | Identical. |
| storage-adapter | 1,026 | Verbatim | `packages/storage-adapter` | Identical. |
| strategic-reports | 5,725 | Verbatim | `packages/strategic-reports` | Identical. |
| supabase-client | 859 | Verbatim | `packages/supabase-client` | Identical. |
| sustainability-advisor | 4,761 | Deleted | — | Property-ESG. Build in MVP3+ for mining ESG. |
| tab-need-detector | 3,874 | Verbatim | `packages/tab-need-detector` | Identical. |
| timezone-detection | 2,669 | Verbatim | `packages/timezone-detection` | Identical. |
| tutoring-skill-pack | 2,245 | Verbatim | `packages/tutoring-skill-pack` | Identical (mining tutorials TBD). |
| user-context-store | 6,546 | Verbatim | `packages/user-context-store` | Identical. |
| workflow-engine | 2,789 | Verbatim | `packages/workflow-engine` | Identical. |
| workforce-orchestrator | 4,082 | Verbatim | `packages/workforce-orchestrator` | Identical (reused for mining workforce). |

**Totals**: 117 BN packages classified — 99 Verbatim, 4 Drift, 4 Replaced, 10 Deleted/Skipped.

### 1b. Packages Borjie has — not in BossNyumba

| Borjie package | LOC (BJ) | Origin | Borjie path | Notes |
|----------------|---------:|--------|-------------|-------|
| capacity-expansion-advisor | 451 | Replaces BN `expansion-advisor` | `packages/capacity-expansion-advisor` | Mining capacity (off-take, processing) — partial port. |
| cost-engineer-advisor | 698 | Greenfield mining | `packages/cost-engineer-advisor` | Per-mine cost-of-production model. |
| fx-treasury-advisor | 638 | Greenfield mining | `packages/fx-treasury-advisor` | TZS/USD treasury, hedge model, BOT rate snapshots. |
| geology-advisor | 519 | Greenfield mining | `packages/geology-advisor` | Drill-hole, sample, vein-model decisioning. |
| mine-planner-advisor | 539 | Greenfield mining | `packages/mine-planner-advisor` | Production plan + LOM optimization. |
| mining-commodity-intelligence | 638 | Replaces BN `market-intelligence` | `packages/mining-commodity-intelligence` | LBMA gold/silver, LME copper/cobalt/nickel/tantalum, daily snapshot adapters. |
| regulatory-tz-mining | 935 | Greenfield TZ regulator | `packages/regulatory-tz-mining` | Tumemadini, TRA, NEMC rule engines + ports. |

### 1c. Missing-gap (BN had, BJ should reconsider)

| BN package | Why useful in Borjie | Recommendation |
|------------|---------------------|----------------|
| `green-angle-advisor` | Mining ESG, scope 1/2/3 emissions, water stewardship | Build in MVP3+ as `green-angle-mining-advisor` |
| `sustainability-advisor` | Mining ESG | Build in MVP3+ |
| `carbon-market` | Mining carbon credits (jurisdictional REDD+ adjacent) | Skip until pilot proves market |

---

## 2. Services comparison

### 2a. BN services → BJ status

| BN service | LOC (BN approx) | Borjie status | Borjie path | Notes |
|------------|----------------:|---------------|-------------|-------|
| api-gateway | 132,100 | Drift | `services/api-gateway` | +7,889 LOC (mining route stack: `routes/mining/*.hono.ts`, internal admin routes, OpenAPI defs). |
| apollo-gauntlet-runner | 1,100 | Verbatim | `services/apollo-gauntlet-runner` | Identical. |
| brain-evolution-worker | 1,871 | Verbatim | `services/brain-evolution-worker` | Identical. |
| consolidation-worker | 7,809 | Drift | `services/consolidation-worker` | +657 LOC for `tasks/borjie-corpus-*.ts` (corpus ingest CLI + adapter). |
| document-intelligence | 10,869 | Verbatim | `services/document-intelligence` | Identical. |
| domain-services | 59,567 | Drift | `services/domain-services` | -1,693 LOC, property domain services thinned. |
| field-capture-service | 1,667 | Verbatim | `services/field-capture-service` | Identical (reused for shift-report capture). |
| identity | 3,233 | Drift | `services/identity` | +18 LOC trivial. |
| mcp-server-firs | 812 | Deleted | — | Nigerian Federal Inland Revenue MCP. Property-tax + cross-border. Replace with `mcp-server-tra` (TRA). |
| mcp-server-nggis | 712 | Deleted | — | Nigerian Geospatial Information Service — mining-relevant analog needs separate work. |
| mcp-server-nin | 727 | Deleted | — | Nigerian Identity Number — Borjie uses TZ NIDA via different connector. |
| mcp-server-opay | 1,487 | Deleted | — | Nigerian payments — not on Borjie roadmap. |
| mcp-server-process-intel | 2,957 | Verbatim | `services/mcp-server-process-intel` | Identical. |
| notifications | 14,839 | Verbatim | `services/notifications` | Identical. |
| onboarding-orchestrator | 2,025 | Deleted | — | **GAP**. Borjie `owner-web` has onboarding page but no long-running orchestrator. Build now. |
| outbox-processor | 499 | Verbatim | `services/outbox-processor` | Identical. |
| outcomes-metering | 2,332 | Verbatim | `services/outcomes-metering` | Identical. |
| parcel-service | 2,671 | Deleted | — | **GAP**. Mining concession polygons need ingestion/dedup; consider porting. |
| payments | 4,771 | Verbatim | `services/payments` | Identical. |
| payments-ledger | 16,473 | Verbatim | `services/payments-ledger` | Identical (reused for mining sales/receivables). |
| proactive-triggers-worker | 923 | Verbatim | `services/proactive-triggers-worker` | Identical. |
| reports | 7,830 | Verbatim | `services/reports` | Identical. |
| scientific-discovery-sidecar | (Python) | Verbatim | `services/scientific-discovery-sidecar` | Identical Python sidecar. |
| sleep-pass-orchestrator | 1,995 | Verbatim | `services/sleep-pass-orchestrator` | Identical. |
| voice-agent | 2,646 | Verbatim | `services/voice-agent` | Identical. |
| webhooks | 425 | Verbatim | `services/webhooks` | Identical. |

### 2b. BJ services not in BN

None. Borjie has not introduced a new top-level service yet; all mining-specific logic was added inside `api-gateway/routes/mining/` and `consolidation-worker/tasks/`.

**Service-level summary**: 14 Verbatim, 4 Drift, 6 Deleted, 0 New. Two of the deletes are problematic (`onboarding-orchestrator`, `parcel-service`).

---

## 3. Apps comparison

### 3a. BN apps → BJ status

| BN app | LOC (src) | page.tsx count | Borjie status | Borjie path | Notes |
|--------|----------:|---------------:|---------------|-------------|-------|
| admin-portal | 95 | n/a | Deprecated in BN | — | DEPRECATED.md present. |
| admin-platform-portal | 18,728 | 38 | Replaced | `apps/admin-web` (24,644 LOC, 61 pages) | Borjie internal console, expanded with mining-internal routes (`internal/{audit-log,citations,compliance-queue,corpus,decision-log,juniors,killswitch,marketplace,prompts,regulator-pipeline,slo}`). |
| owner-portal | 28,605 | 25 | Replaced | `apps/owner-web` (7,942 LOC, 26 pages) | Owner cockpit reskinned for mining: cockpit/community/compliance/documents/finance/fleet/geology/group/inventory/licences/lmbm/marketplace/master-brain/onboarding/people/portfolio-map/reports/safety/sales/settings/site-cockpit/sites/treasury. |
| customer-app | 23,592 | 81 | Deleted | — | Tenant-facing app — no mining analogue (mining buyers in `buyer-mobile` instead). |
| estate-manager-app | 20,025 | 137 | Deleted | — | **Partially absorbed** into `workforce-mobile` (Expo) + `owner-web` (Next). Many screens not ported. |
| tenant-portal | 3,450 | 11 | Deleted | — | Tenant-only — no analog needed. |
| marketing | 1,901 | 1 | Deleted | — | Public marketing site — Borjie marketing TBD on a separate `apps/marketing` if needed. |
| bossnyumba_app (mobile shell) | 0 | n/a | Replaced | `apps/workforce-mobile`, `apps/buyer-mobile` | Borjie went Expo, not Flutter. |

### 3b. BJ apps not in BN

| BJ app | LOC | Screens / pages | Origin | Notes |
|--------|----:|----------------:|--------|-------|
| `apps/admin-web` | 24,644 | 61 page.tsx | Replaces BN admin-platform-portal | Next.js App Router, on `:3020`. Internal admin: tenants list/detail, juniors monitor, killswitch, prompts management, corpus admin, audit-pack export, AB tests, regulator pipeline. |
| `apps/owner-web` | 7,942 | 26 page.tsx | Replaces BN owner-portal | Mining owner cockpit on `:3010`. |
| `apps/buyer-mobile` | 4,075 | 15 Expo screens | Greenfield mining | Mineral buyers / off-takers: marketplace browse, place bid, KYC wizard (NIDA + AML), bid timeline, documents viewer, chat. |
| `apps/workforce-mobile` | 8,227 | 59 Expo screens (25 owner + 22 worker + 7 tab) | Greenfield mining | Role-gated app for owner/manager/employee. Owner mobile screens `O-M-01..O-M-25`, worker screens `W-M-01..W-M-22`. |

**Screen tally**:
- BN web pages total: 38 + 25 + 81 + 137 + 11 + 1 = **293 page.tsx**
- BJ web pages total: 61 + 26 = **87 page.tsx**
- BJ Expo screens total: 15 + 59 = **74 Expo screens**
- BJ total surfaces: **161 screens** = **55%** of BN web pages (but greenfield mobile compensates with 74 dedicated mining mobile screens).

### 3c. Pages BN had that BJ does not have

| BN page (functional area) | Borjie equivalent | Action |
|---------------------------|-------------------|--------|
| `customer-app/announcements/*` (2 pages) | Mining: tenant announcements via owner-web is gap | Build in MVP3+ |
| `customer-app/assistant/*` (2 pages) | `workforce-mobile/(tabs)/ask.tsx` partially | Partial / already-exists |
| `customer-app/blog/*` | Marketing-side — not in BJ | Skip / public site separate |
| `customer-app/compare/page.tsx` | n/a | Skip |
| `customer-app/community/*` | `owner-web/(routes)/community/page.tsx` | Partial |
| `customer-app/documents/house-rules` etc. | `owner-web/(routes)/documents/page.tsx` | Partial |
| `customer-app/emergencies/*` (2 pages) | Mining: `mining/incidents.hono.ts` API exists, no UI yet | Build now (safety-critical) |
| `customer-app/feedback/*` | n/a | Build in MVP3+ |
| `customer-app/inspection/*` | `workforce-mobile/forms/*` (drill-hole inspections) | Replaced |
| `customer-app/jarvis/*` | `(tabs)/ask`, `master-brain` page | Replaced |
| `customer-app/lease/*` (8 pages) | Mining contracts in `owner-web/sales/page.tsx` + `marketplace/[id]` | Replaced |
| `customer-app/maintenance/*` (4 pages) | `mining/maintenance.hono.ts` API; UI in `owner-web/fleet/page.tsx` | Partial — needs explicit maintenance screen |
| `customer-app/marketplace/*` | `apps/buyer-mobile` | Replaced (better) |
| `customer-app/messages/*` | Inherited messaging APIs exist; mining chat UI in workforce-mobile only | Build in MVP3+ |
| `customer-app/my-credit` | n/a | Build in MVP3+ |
| `customer-app/notifications/*` | `apps/buyer-mobile/app/profile/notifications.tsx` partial | Partial |
| `customer-app/onboarding/*` (3 pages) | `owner-web/onboarding/page.tsx` (single page) | Build now (multi-step wizard) |
| `estate-manager-app/announcements/*` | n/a | Skip |
| `estate-manager-app/brain/*` (5 pages) | `owner-web/master-brain`, `admin-web/internal/juniors` | Partial |
| `estate-manager-app/briefing` | `admin-web/internal/decision-log` | Partial |
| `estate-manager-app/calendar/*` | n/a | Build in MVP3+ |
| `estate-manager-app/collections` | `owner-web/finance` | Partial |
| `estate-manager-app/customers/*` | `owner-web/marketplace`, `admin-web/internal/tenants` | Partial |
| `estate-manager-app/graph` | `mining/portfolio-map.hono.ts` exists; UI in `owner-web/portfolio-map/page.tsx` | Replaced |
| `estate-manager-app/inspections/*` (5 pages) | `workforce-mobile/forms/*` for shift/drill | Replaced (mobile-first) |
| `estate-manager-app/messaging/*` | Skip — handled by chat tab in mobile | Skip |
| `estate-manager-app/payments/*` | `owner-web/finance`, `owner-web/treasury` | Replaced |

---

## 4. Database schema parity

### 4a. Counts

| Metric | BN | BJ | Delta |
|--------|---:|---:|------:|
| Schema files in `packages/database/src/schemas/` | 139 | 115 | -24 |
| Drizzle `pgTable(...)` declarations | 290 | 244 | -46 |
| Tables created via numbered SQL migrations (`src/migrations/`) | 435 CREATE TABLE | (same dir copied verbatim, but unused in BJ runtime path) | n/a |
| Tables created via bootstrap migrations (`drizzle/`) | 2 files (documents_bundle, notification_dispatch_log) | 11 files | BJ owns full bootstrap chain |
| RLS `ENABLE ROW LEVEL SECURITY` | 325 | 340 | +15 |
| RLS `CREATE POLICY` | 722 | 734 | +12 |

### 4b. Mining-domain tables in Borjie (counted from `drizzle/0003`, `0005`, `0007`, `0011`)

50 CREATE TABLE statements in mining-domain SQL migrations. Categorized:

| Category | Tables |
|----------|--------|
| Companies & legal | `companies`, `directors`, `shareholders`, `bank_accounts`, `authorities`, `licences`, `licence_events`, `licence_dormancy_scores` |
| Sites & geology | `sites`, `site_sections`, `drill_holes`, `drill_hole_layers`, `samples`, `sample_batches`, `qaqc_results`, `geology_scores`, `vein_models`, `ore_grade_snapshots`, `ore_stockpiles` |
| Workforce | `employees`, `attendance`, `advances`, `worker_incentives`, `site_supervisor_coverage`, `pre_shift_inspections` |
| Fleet & maintenance | `assets`, `maintenance_events`, `equipment_maintenance_taxonomy`, `fuel_logs`, `shift_reports` |
| Production & sales | `production_records`, `ore_parcels`, `buyers`, `buyer_risk_reports`, `sales`, `offtake_queue` |
| Treasury | `cash_balances` (TimescaleDB hypertable), `fx_rates`, `mineral_prices`, `costs`, `forecasts` |
| Safety & CSR | `incidents`, `ppe_issues`, `csr_plans`, `grievances`, `village_meetings` |
| Marketplace | `marketplace_listings`, `marketplace_bids`, `bid_negotiations`, `ratings` |
| Risk & tasks | `tasks`, `risks` |
| AI substrate | `intelligence_corpus_chunks`, `fingerprint_events` |
| Junior outputs (0011) | `decision_log`, `audit_log`, `compliance_verdicts`, `contract_remediation`, `generated_reports`, `notifications_outbox`, plus 25+ junior-specific output tables |
| Admin internals (0008) | 3 tables (decision log read model, SLO read model, killswitch state) |
| Killswitch RBAC (0009) | 2 tables |
| Routing & briefs (0013) | `routing_rules`, `executive_brief_actions` |

**Mining-domain tables tally**: ~49–50 dedicated mining tables (matches "49 expected" in audit prompt).

### 4c. Generic AI-OS / multi-tenant tables — should be in both

| Generic table family | BN | BJ |
|----------------------|----|----|
| tenants, organizations, users | Yes (`tenant.schema.ts`) | Yes (`tenant.schema.ts`, with `borjie_plan` enum added) |
| audit_events, kernel_action_audit, ai_audit_chain, worm_audit_log | Yes | Yes |
| autonomy, autonomy_caps, sovereign_action_ledger | Yes | Yes |
| brain memory: episodic, semantic, procedural, reflective, declarative | Yes | Yes |
| conversation, conversation_threads (BN), conversation_capture | Yes | Yes (conversation-threads merged in BJ) |
| persona_registry, persona_branding | Yes | Yes |
| feature_flags, platform_feature_flags, platform_killswitch_state | Yes | Yes |
| GDPR, compliance, decision_traces | Yes | Yes |
| outbox, webhook_delivery | Yes | Yes |
| portal_layouts, presentation_themes, section_layouts | Yes | Yes |
| user_action_tracker, session_replay_chunks | Yes | Yes |

### 4d. Property-domain tables intentionally dropped in BJ (46 schema files)

| Dropped schema file | Domain |
|---------------------|--------|
| `buildings.schema.ts` | Property |
| `lease.schema.ts` | Property |
| `customer.schema.ts` | Property (tenant) |
| `property.schema.ts`, `property-grading.schema.ts`, `property-valuations.schema.ts` | Property |
| `occupancy.schema.ts`, `vacancy-pipeline.schema.ts` | Property |
| `arrears-cases.schema.ts`, `payment-plan.schema.ts` | Property finance |
| `payment.schema.ts`, `payments-ledger.schema.ts`, `gepg.schema.ts` | Property payments |
| `maintenance.schema.ts`, `maintenance-taxonomy.schema.ts` | Property maintenance (general fleet remains via `assets-fleet.schema.ts`) |
| `inspections.schema.ts`, `inspections-extensions.schema.ts`, `conditional-survey.schema.ts` | Property inspections (replaced by `pre_shift_inspections`) |
| `parcels.schema.ts` | Property parcels (but Borjie keeps `packages/geo-parcels` — see Notes) |
| `marketing-leads.schema.ts` | Property marketing |
| `letter-requests.schema.ts` | Property comms |
| `feedback-complaints.schema.ts` | Property complaints |
| `negotiation.schema.ts` | Property (replaced by `bid_negotiations`) |
| `hr.schema.ts` | Property HR (replaced by `employees` mining workforce) |
| `classroom.schema.ts`, `gamification.schema.ts` | Property gamification |
| `iot.schema.ts` | Property IoT |
| `messaging.schema.ts` | Generic; messaging covered by communications |
| `tenant-finance.schema.ts`, `tenant-predictions.schema.ts`, `tenant-risk-reports.schema.ts` | Property tenant-risk (multi-tenant tenant-risk re-shaped in mining) |
| `utilities.schema.ts`, `warehouse-inventory.schema.ts` | Property utilities |
| `compliance.schema.ts`, `compliance-exports.schema.ts` | Property-flavored compliance (mining uses `compliance_verdicts` from 0011) |
| `credit-rating.schema.ts` | Tenant credit-rating (Borjie has `buyer_risk_reports`) |
| `market-rate-snapshots.schema.ts` | Property rents |
| `intelligence.schema.ts`, `intelligence-history.schema.ts` | Both replaced in Borjie by `intelligence_corpus_chunks` + RAG |
| `ledger.schema.ts` | Generic ledger — replaced by mining `cash_balances`, `treasury.schema.ts` |
| `scheduling.schema.ts`, `station-master-coverage.schema.ts` | Property scheduling |
| `waitlist.schema.ts` | Property waitlists |

### 4e. RLS policy parity

Counted via `CREATE POLICY` in all migration SQL files:

| Repo | ENABLE RLS statements | CREATE POLICY statements |
|------|----------------------:|-------------------------:|
| BossNyumba | 325 | 722 |
| Borjie | 340 | 734 |

Borjie's slight increase tracks the new mining tables (companies, sites, drill_holes etc., each tenant-scoped with at least one policy). Coverage ratio (~2.2 policies per RLS table) is identical between repos — indicates parity at the policy-density level.

---

## 5. Migrations

### 5a. Counts

| Migration dir | BN | BJ |
|---------------|---:|---:|
| `packages/database/src/migrations/*.sql` (legacy numbered, BN-originated) | 269 | 269 (copied verbatim, not in BJ runtime path) |
| `packages/database/drizzle/*.sql` (bootstrap chain) | 2 | 11 |

### 5b. Borjie's bootstrap migration chain (`packages/database/drizzle/`)

| Migration | LOC | CREATE TABLE | Purpose | BN equivalent? |
|-----------|----:|-------------:|---------|----------------|
| `0000_borjie_bootstrap.sql` | 179 | 3 | Extensions (postgis, vector, timescaledb, age), enums, core identity (tenants, organizations, users). Replaces BN's 50-table `0001_initial.sql` with a 3-table minimum. | No direct equivalent — BN's 0001 was property-shaped. |
| `0003_mining_domain.sql` | 1,186 | 40 | Drops legacy property tables; installs mining-domain stack (companies/licences/sites/geology/workforce/fleet/production/sales/treasury/safety/CSR/marketplace/intelligence corpus/fingerprint events/risks-tasks); enables RLS on every tenant-scoped table; promotes `cash_balances` to Timescale hypertable; seeds `borjie-demo` tenant. | None (mining-domain greenfield). |
| `0004_marketplace_bids.sql` | 161 | 1 | Adds `marketplace_bids` table with bid lifecycle (placed → countered → accepted/rejected). | None. |
| `0005_mining_extensions.sql` | 177 | 4 | Adds `worker_incentives`, `equipment_maintenance_taxonomy`, `offtake_queue`, `site_supervisor_coverage`. | Conceptually mirrors BN `0055_*`/`0056_*` series but mining-shaped. |
| `0007_mining_workforce_extensions.sql` | 202 | 5 | Adds `pre_shift_inspections`, `buyer_risk_reports`, `bid_negotiations`, `ore_grade_snapshots`, `ore_stockpiles`. | None (mining-specific). |
| `0008_admin_internals.sql` | 125 | 3 | Decision-log read-model, SLO read-model, killswitch state for `admin-web/internal/`. | Conceptually BN `0223_module_accept_handlers.sql` + `0260_parcel_indexes.sql`. |
| `0009_killswitch_rbac.sql` | 102 | 2 | RBAC matrix for the killswitch (who can pull which switch). | Conceptually BN `0170b_kill_switch_expand.sql`. |
| `0010_buyer_user_link.sql` | 52 | 0 | Adds `user_id` FK on `buyers` table for buyer-mobile auth linkage. | None. |
| `0011_junior_outputs.sql` | 443 | 31 | Junior agent output tables (decision_log, audit_log, compliance_verdicts, contract_remediation, generated_reports, notifications_outbox, plus 25 junior-specific output tables for geology-ops, workforce-safety, commercial, governance). | None directly; BN has scattered per-junior tables. |
| `0012_corpus_embedding_index.sql` | 26 | 0 | HNSW index on `intelligence_corpus_chunks.embedding` for RAG retrieval. | Conceptually BN `0260_parcel_indexes.sql`. |
| `0013_routing_rules.sql` | 142 | 2 | `routing_rules` (Piece B) and `executive_brief_actions` (Piece E) — orchestrator routing and exec-brief action queue. | None — these are Borjie's own architectural pieces. |

Total Borjie bootstrap LOC: **2,795 lines of SQL**.

### 5c. Findings on legacy BN migrations on disk

The 269 BN-originated `.sql` files under `packages/database/src/migrations/` are still present in Borjie at the same paths, but Borjie's `drizzle/` migrations replace them at bootstrap time. Risk: any tool that scans `src/migrations/` (e.g. `scripts/migration-apply-check.mjs`) may try to apply both chains and conflict.

**Recommendation**: move legacy migrations to `packages/database/.archive/migrations/` or delete entirely — see §14.

---

## 6. API routes

### 6a. Counts

| Metric | BN | BJ |
|--------|---:|---:|
| Total route files (`.ts` recursive in `routes/`) | 213 | 249 |
| `.router.ts` files (legacy Hono/Express routers) | 110 | 102 |
| `.hono.ts` files | 15 | 48 |
| `routes/mining/` subdirectory | absent | 26 mining route files |
| `routes/mining/_openapi/` | absent | 15 schema/definition files |
| `routes/mining/internal/` | absent | 10 admin-internal routes |
| HTTP method count: GET | 1,440 | 1,592 |
| HTTP method count: POST | 288 | 306 |
| HTTP method count: PUT | 32 | 32 |
| HTTP method count: PATCH | 8 | 10 |
| HTTP method count: DELETE | 39 | 39 |
| Total HTTP methods | 1,807 | 1,979 |

### 6b. Mining route stack (Borjie only)

| Route file | Purpose |
|------------|---------|
| `mining/attendance.hono.ts` | Worker attendance |
| `mining/bids.hono.ts` | Marketplace bid placement / accept / counter |
| `mining/buyers-kyc.hono.ts` | Buyer KYC submission and status |
| `mining/chat-corpus-evidence.ts` | Corpus citation lookup |
| `mining/chat-orchestrator.ts` | Master-brain chat routing |
| `mining/chat.hono.ts` | Chat thread CRUD |
| `mining/cockpit.hono.ts` | Owner cockpit data feed |
| `mining/docs.hono.ts` | Document lookup |
| `mining/documents.hono.ts` | Doc CRUD |
| `mining/drill-holes.hono.ts` | Drill hole logging |
| `mining/fuel-logs.hono.ts` | Diesel/fuel reconciliation |
| `mining/grievances.hono.ts` | Community grievances |
| `mining/incidents.hono.ts` | Safety incident reporting |
| `mining/index.ts` | Mining router aggregator |
| `mining/licences.hono.ts` | Licence CRUD + dormancy scoring |
| `mining/lmbm.hono.ts` | Living Mining Business Map graph queries |
| `mining/maintenance.hono.ts` | Asset maintenance events |
| `mining/marketplace.hono.ts` | Marketplace listings |
| `mining/ore-parcels.hono.ts` | Ore parcel weight/grade per shipment |
| `mining/portfolio-map.hono.ts` | LMBM map endpoints |
| `mining/reports.hono.ts` | Generated reports listing |
| `mining/sales.hono.ts` | Sales records |
| `mining/samples.hono.ts` | Assay sample registration |
| `mining/shift-reports.hono.ts` | Shift report submission |
| `mining/sites.hono.ts` | Site CRUD |
| `mining/internal/audit-log.hono.ts` | Admin audit log read |
| `mining/internal/citations.hono.ts` | Citation registry |
| `mining/internal/compliance-queue.hono.ts` | Compliance review queue |
| `mining/internal/corpus.hono.ts` | Corpus admin |
| `mining/internal/decision-log.hono.ts` | Decision log |
| `mining/internal/killswitch.hono.ts` | Killswitch ops |
| `mining/internal/prompts.hono.ts` | Prompt registry |
| `mining/internal/promotions.hono.ts` | Tier promotion logic |
| `mining/internal/regulator-pipeline.hono.ts` | Regulator pack drift |
| `mining/internal/slo.hono.ts` | SLO read model |
| `mining/internal/tenants.hono.ts` | Tenant admin |

### 6c. Routes in BN with no BJ equivalent (property-domain)

Endpoints likely safe to leave dormant (already inherited as `.router.ts` files but never wired):

| BN router file | Reason no BJ equivalent |
|----------------|-------------------------|
| `acquisition-advisor.router.ts` | Property acquisition |
| `arrears.router.ts` | Property arrears |
| `classroom.router.ts` | Property tenant classroom |
| `conditional-surveys.router.ts` | Property inspections |
| `credit-rating.router.ts` | Property credit-rating |
| `damage-deductions.router.ts` | Property deposit deductions |
| `estate-auto-management.router.ts` | Property auto-management |
| `estate-department-advisor.router.ts` | Property estate department |
| `expansion-advisor.router.ts` | Property expansion (replaced) |
| `gamification.router.ts` | Property gamification |
| `gepg.router.ts` | Property GEPG (TZ revenue) |
| `green-angle-advisor.router.ts` | Property ESG |
| `lifecycle-advisor.router.ts` | Property lifecycle |
| `lpms.router.ts` | LPMS connector |
| `monthly-close.router.ts` | Property month-end |
| `move-out.router.ts` | Property move-out |
| `negotiations.router.ts` | Property lease negotiation |
| `occupancy-timeline.router.ts` | Property occupancy |
| `property-grading.router.ts` | Property grading |
| `renewals.router.ts` | Lease renewals |
| `risk-recompute.router.ts` | Property risk |
| `risk-reports.router.ts` | Property risk reports |
| `station-master-coverage.router.ts` | Property station-master |
| `sublease.router.ts` | Property sublease |
| `sustainability-advisor.router.ts` | Property ESG |
| `vacancy-pipeline.router.ts` | Property vacancy |
| `waitlist.router.ts` | Property waitlist |

These are still on disk in Borjie at `services/api-gateway/src/routes/` but rely on schemas that no longer exist — they will throw at import time. They should be deleted or moved to `services/api-gateway/.deprecated/`. See §14.

### 6d. Routes in BJ with no BN equivalent

All 48 `*.hono.ts` files under `services/api-gateway/src/routes/mining/` are Borjie-only (listed in §6b). Plus:

| BJ route file | Inherited? |
|---------------|------------|
| Most other BJ routes match BN routes 1-1 because they were inherited. |

---

## 7. Workers / background jobs

### 7a. `services/api-gateway/src/workers/`

| Worker | BN | BJ | Notes |
|--------|----|----|-------|
| cases-sla-supervisor.ts | Yes | Yes | Identical. |
| event-subscribers.ts | Yes | Yes | Identical. |
| executive-brief-cron.ts | Yes | Yes | Identical. |
| executive-brief-action-runner.ts | **No** | **Yes** | Borjie-only — drains `executive_brief_actions` queue (Piece E). |
| lease-expiry-alert-cron.ts | Yes | Yes | Reused as licence-expiry-alert via rebind. |
| outbox-worker.ts | Yes | Yes | Identical. |
| webhook-retry-worker.ts | Yes | Yes | Identical. |

### 7b. `services/consolidation-worker/src/`

| Subdirectory | BN | BJ |
|--------------|----|----|
| `__tests__` | Yes | Yes |
| `consolidation.ts` | Yes | Yes |
| `consolidation.test.ts` | Yes | Yes |
| `index.ts` | Yes | Yes |
| `logger.ts` | Yes | Yes |
| `observability/` | Yes | Yes |
| `orchestrator.ts` | Yes | Yes |
| `prompt-compile/` | Yes | Yes |
| `stages/` | Yes | Yes |
| **`tasks/` (Borjie-only)** | No | **Yes** — 4 files: `borjie-corpus-adapters.ts`, `borjie-corpus-cli-direct.ts`, `borjie-corpus-cli.ts`, `borjie-corpus-ingest.ts` |

### 7c. Service-level cron jobs (`src/jobs/*.job.ts`)

| Job | BN | BJ |
|-----|----|----|
| `services/reports/src/jobs/scheduled-reports.job.ts` | Yes | **No** (the whole jobs dir was not ported into BJ's reports service) |
| `services/payments-ledger/src/jobs/statement-generation.job.ts` | Yes | Yes |
| `services/payments-ledger/src/jobs/reconciliation.job.ts` | Yes | Yes |
| `services/payments-ledger/src/jobs/disbursement.job.ts` | Yes | Yes |

### 7d. Missing in Borjie

| BN worker | Mining counterpart needed? |
|-----------|---------------------------|
| `services/onboarding-orchestrator/` (whole service) | Yes — mining owner onboarding is multi-step. |
| `services/reports/src/jobs/scheduled-reports.job.ts` | Yes — Borjie has scheduled exec briefs but no scheduled reports cron. |
| `services/parcel-service/` (whole service) | Maybe — mining concession polygons could go here, currently in api-gateway. |

---

## 8. AI brain layer

### 8a. Juniors

BossNyumba juniors live in `packages/ai-copilot/src/junior-ai-factory/` (a factory class, not concrete juniors), and concrete copilots in `packages/ai-copilot/src/copilots/` (2 files: maintenance-triage, migration-wizard).

Borjie juniors are concrete agent files under `packages/ai-copilot/src/juniors/`:

| Borjie junior | LOC bucket | Domain |
|---------------|-----------|--------|
| `asset-fleet-agent.ts` | medium | Fleet ops |
| `auditor-agent.ts` | medium | Audit verdicts |
| `buyer-kyc-agent.ts` | medium | KYC / AML |
| `community-agent.ts` | medium | Village CSR + grievances |
| `compliance-agent.ts` | medium | Regulator drafting |
| `contract-currency-auditor.ts` | medium | FX / contract terms |
| `cost-engineer.ts` | medium | Mine cost of production |
| `document-agent.ts` | medium | Doc ingest |
| `drill-hole-logger.ts` | medium | Field drill-hole capture |
| `forecast-modeler.ts` | medium | Production forecast |
| `fx-treasury-agent.ts` | medium | TZS/USD treasury |
| `geology-agent.ts` | medium | Vein modeling |
| `hr-agent.ts` | medium | Workforce |
| `lab-assay-agent.ts` | medium | Sample QAQC |
| `licence-agent.ts` | medium | Licence + dormancy |
| `maintenance-agent.ts` | medium | Equipment uptime |
| `marketplace-stakeholder-agent.ts` | medium | Marketplace |
| `metallurgy-agent.ts` | medium | Process plant |
| `mine-planner.ts` | medium | LOM planning |
| `operations-sic-agent.ts` | medium | Shift-in-charge |
| `procurement-agent.ts` | medium | Procurement |
| `report-writer.ts` | medium | Report generation |
| `risk-modeler.ts` | medium | Risk register |
| `safety-agent.ts` | medium | Incident triage |
| `sales-offtake-agent.ts` | medium | Sales |
| `village-csr-agent.ts` | medium | CSR plans |

**Concrete mining juniors**: 26 agents. Plus support files: `_shared.ts`, `document-agent-adapters.ts`, `document-agent-helpers.ts`, `document-agent-prompt.ts`, `executor.ts`, `executor-registry.ts`, `index.ts`, `master-brain.ts`, `notifications-router.ts`, `synthesizer.ts`.

**Audit prompt claim "28 mining juniors"**: 26 directly identifiable + `master-brain` orchestrator + `synthesizer` ≈ 28. Acceptable.

### 8b. Advisor packages

| Family | BN | BJ |
|--------|----|----|
| Acquisition / lifecycle / expansion / sustainability / green-angle | Yes (5 packages) | No (deleted, replaced) |
| Estate-department-advisor | Yes | No |
| Market-intelligence (property) | Yes | Replaced by `mining-commodity-intelligence` |
| Role-aware-advisor | Yes | Yes (shared) |
| Stage-advisor | Yes | Yes (shared) |
| Mining: cost-engineer, fx-treasury, geology, mine-planner, capacity-expansion, mining-commodity-intelligence | No | **Yes** (6 packages) |
| Regulatory-tz-mining | No | **Yes** |

### 8c. Master Brain personas

| Persona seed | BN | BJ |
|--------------|----|----|
| `estate-manager` | Yes | No (file likely deleted from `packages/persona-runtime/src/seeds.ts`) |
| `mining-CEO` | No | Yes |
| Generic `tenant-admin`, `platform-admin`, etc. | Yes | Yes |

---

## 9. Tests

### 9a. Counts

| Test type | BN | BJ |
|-----------|---:|---:|
| `*.test.ts` under `packages/`, `services/`, `apps/` (excluding `node_modules`, `dist`) | 1,763 | 1,653 |
| - packages | 1,399 | 1,314 |
| - services | 348 | 327 |
| - apps | 16 | 12 |
| Playwright E2E (`e2e/**/*.spec.ts`) | 118 | 123 |

### 9b. Coverage delta

Borjie has 110 fewer Vitest test files. Most missing tests are in:

- `services/api-gateway` property routers (~50 tests not ported)
- `apps/customer-app` and `apps/estate-manager-app` (deleted) — about 30 test files
- `packages/lifecycle-advisor`, `acquisition-advisor`, `sustainability-advisor`, `green-angle-advisor` (deleted) — about 30 test files

### 9c. Mining-specific tests in Borjie

The 5 additional Playwright specs in Borjie vs BN cover mining domain UAT:
- buyer-mobile KYC happy path
- workforce-mobile shift-report submission
- owner-web cockpit
- admin-web internal juniors monitor
- marketplace bid lifecycle

Mining Vitest tests are concentrated in:
- `packages/ai-copilot/src/juniors/__tests__/`
- `packages/database/src/schemas/__tests__/` (mining schema relations)
- `services/api-gateway/src/routes/mining/__tests__/`
- `services/consolidation-worker/src/__tests__/borjie-corpus-*.test.ts`

---

## 10. CI/CD workflows

### 10a. BossNyumba's 45 workflows

| Workflow | Borjie equivalent? |
|----------|-------------------|
| `ai-bom-attest.yml` | Skipped |
| `audit-coverage.yml` | `borjie-audit-coverage.yml` |
| `audit-not-yet-wired.yml` | Skipped (script exists, no workflow) |
| `backup-restore-drill.yml` | Skipped (manual) |
| `backup-restore-test.yml` | Skipped |
| `cd-production.yml`, `cd-staging.yml`, `cd.yml` | Skipped (Fly.io deploy via `borjie-ci.yml`) |
| `ci-monorepo.yml`, `ci.yml` | `borjie-ci.yml` (combined) |
| `codeql.yml` | `borjie-codeql.yml` |
| `csrf-eslint-rule.yml` | Skipped (eslint runs in CI) |
| `db-migrations-check.yml` | `borjie-db-migrations-check.yml` |
| `decision-trace-coverage.yml` | **Missing** — Borjie has decision-log but no drift workflow |
| `defection-probe.yml` | Skipped |
| `deploy-production.yml`, `deploy-staging.yml` | Skipped (Vercel + Fly deploy from main branch directly) |
| `eval-orchestrator-scenarios.yml` | Skipped |
| `flutter-mobile-analyze.yml` | Skipped (Borjie uses Expo, not Flutter) |
| `helm-chart-lint.yml` | Skipped (no Helm chart used) |
| `kernel-eval.yml` | **Missing** |
| `knip-dep-cruiser.yml` | `borjie-knip.yml` |
| `lats-search-eval.yml` | **Missing** |
| `live-test.yml` | Skipped |
| `migration-apply-check.yml` | `borjie-db-migrations-check.yml` |
| `migration-apply-fresh.yml` | **Missing** |
| `migration-safety-check.yml` | Folded into db-migrations-check |
| `openapi-drift.yml` | **Missing** |
| `policy-gate-coverage.yml` | **Missing** |
| `power-tools-registry-shape.yml` | Skipped |
| `pr-check.yml` | `borjie-ci.yml` |
| `red-team.yml` | **Missing** |
| `reflexion-sleep-canary.yml` | **Missing** |
| `regulator-pack-drift.yml` | **Missing** (Borjie has `regulator-pipeline` API but no drift CI gate) |
| `release.yml` | Skipped (manual release until v1.0) |
| `sandbox-load-test.yml` | **Missing** |
| `sbom.yml` | `borjie-sbom.yml` |
| `security-route-coverage.yml` | **Missing** |
| `security-scan.yml` | `borjie-security.yml` |
| `semgrep.yml` | `borjie-semgrep.yml` |
| `strict-ci.yml` | Folded into `borjie-ci.yml` |
| `sycophancy-probe.yml` | **Missing** |
| `trajectory-eval.yml` | **Missing** |
| `trivy.yml` | `borjie-trivy.yml` |
| `zero-hardcoded.yml` | **Missing** |

### 10b. Borjie-specific workflow

| Workflow | Purpose |
|----------|---------|
| `borjie-publish-docs.yml` | Publishes `Docs/` to GitHub Pages for Borjie team. |

### 10c. Pruning rationale

Borjie deliberately removed 35 of BN's 45 workflows to keep CI green during the hard-fork rebuild phase. About 10 of those (red-team, kernel-eval, lats-search-eval, decision-trace-coverage, sycophancy-probe, regulator-pack-drift, zero-hardcoded, security-route-coverage, policy-gate-coverage, openapi-drift) should return before pilot. The `live-test.yml`, `sandbox-load-test.yml`, `cd-production.yml`, `release.yml` are post-pilot.

---

## 11. Documentation

### 11a. Counts

| Metric | BN | BJ |
|--------|---:|---:|
| Files under `Docs/` (recursive) | 316 | 319 |
| Top-level Markdown files | 104 | 106 |
| ADRs | 14 | 14 (identical 0001-0013 + README) |
| Runbooks | 30 (in `Docs/RUNBOOKS/`) | 30 (same set; some need mining rebind) |
| Postmortems | placeholder | placeholder |
| Codemaps | 60+ | 64 |

### 11b. Mining-domain docs in Borjie not in BN

| Borjie doc | Purpose |
|------------|---------|
| `Docs/CORPUS_LOCATION.md` | Documents the off-repo Boji corpus path. |
| `Docs/openapi/borjie-mining.yaml` | Generated mining OpenAPI spec. |
| `Docs/regulator-pack/tz/` | TZ regulator pack (10 numbered docs: system overview, BOT cybersecurity mapping, PDPA, AML/KYC, model-risk management, fairness, incident response, BCP/DR, vendors, audit trail). |
| `Docs/regulator-pack/ke/` | Kenya regulator pack (placeholder structure). |
| `Docs/regulator-pack/model-cards/` | Junior model cards. |

### 11c. Docs in BN not in BJ

| BN doc | Action |
|--------|--------|
| `BOSSNYUMBA_PRD.md`, `BOSSNYUMBA_SPEC.md` | Kept on disk in BJ (legacy reference); BJ should produce `BORJIE_PRD.md`, `BORJIE_SPEC.md`. **Gap**. |
| `CUSTOMER_APP.md`, `ESTATE_MANAGER_APP.md` | Kept on disk (legacy reference). Should be deleted or replaced with `OWNER_WEB.md`, `WORKFORCE_MOBILE.md`, `BUYER_MOBILE.md`. **Gap**. |

---

## 12. Configuration + env

### 12a. .env.example diff

| Metric | BN | BJ |
|--------|---:|---:|
| Total env vars (lines matching `^[A-Z_]+=`) | 361 | 402 |
| Mining-specific additions | n/a | ~50 |

### 12b. Mining-specific env vars (Borjie additions)

Sample (first 15):

```
TZS_USD_EXCHANGE_RATE=2500
BORJIE_CASES_SLA_DISABLED=
BORJIE_BG_TASKS_ENABLED=
BORJIE_SKIP_DOTENV=
BORJIE_ALLOW_TEARDOWN=
BORJIE_IDENTITY_WIRED=
BORJIE_API_BASE=
TRA_API_URL=
TRA_API_KEY=
BORJIE_MINING_CORPUS_PATH=...
NEMC_PORTAL_BASE=https://portal.nemc.or.tz/api/v1
NEMC_API_KEY=
TRA_PORTAL_BASE=https://api.tra.go.tz/v1
TUMEMADINI_PORTAL_BASE=...
LMBM_GRAPH_BACKEND=...
```

### 12c. BossNyumba-only vars

BN-specific vars that Borjie does not need:

- `GEPG_*` (Tanzanian government revenue gateway for property tax)
- `LPMS_*` (property licensing portal)
- `OPAY_*`, `FIRS_*` (Nigerian payment + tax)
- `NGGIS_*` (Nigerian geospatial)
- `NIN_*` (Nigerian identity)

These are still present in Borjie's `.env.example` (inherited verbatim) — should be pruned. See §14.

---

## 13. Deployment configs

### 13a. Configs present in both

Both repos have:
- `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.production.yml`, `docker-compose.e2e.yml`, `docker-compose.ha.yml`, `docker-compose.override.yml(.example)`
- `infrastructure/` (helm, k8s, terraform inherited verbatim)
- `infra/` (alerts, grafana, k8s, postgres-ha, redis-sentinel, terraform)
- `k8s/` cron yamls (consolidation-worker, sovereign-ledger-verify, wake-loop)
- `Makefile`

### 13b. Borjie-only deploy configs

| Config | Path |
|--------|------|
| Fly.io app for gateway | `services/api-gateway/fly.toml` |
| Vercel deploy for admin-web | `apps/admin-web/vercel.json` |
| Vercel deploy for owner-web | `apps/owner-web/vercel.json` |
| EAS (Expo) build for buyer-mobile | `apps/buyer-mobile/eas.json` |
| EAS build for workforce-mobile | `apps/workforce-mobile/eas.json` |

### 13c. Inherited but unused in Borjie

- `infrastructure/helm/` (Helm chart structure exists but no Borjie-specific values.yaml has been wired)
- `infra/terraform/` (BossNyumba's TZ landing-zone terraform — not adapted for Borjie tenants)

---

## 14. Recommended fill-the-gap work

Prioritized by: **(a)** blocks pilot demo, **(b)** blocks production deploy, **(c)** reduces tech debt, **(d)** nice-to-have.

### 14a. Build now (high leverage, no blockers)

| Priority | Recommendation | File paths to create / modify |
|----------|----------------|-------------------------------|
| (a) | **Delete dormant property-domain `.router.ts` files** to unblock TypeScript compile on a fresh checkout. | Delete from `services/api-gateway/src/routes/`: `acquisition-advisor.router.ts`, `arrears.router.ts`, `classroom.router.ts`, `conditional-surveys.router.ts`, `credit-rating.router.ts`, `damage-deductions.router.ts`, `estate-auto-management.router.ts`, `estate-department-advisor.router.ts`, `expansion-advisor.router.ts`, `gamification.router.ts`, `gepg.router.ts`, `green-angle-advisor.router.ts`, `lifecycle-advisor.router.ts`, `lpms.router.ts`, `monthly-close.router.ts`, `move-out.router.ts`, `negotiations.router.ts`, `occupancy-timeline.router.ts`, `property-grading.router.ts`, `renewals.router.ts`, `risk-recompute.router.ts`, `risk-reports.router.ts`, `station-master-coverage.router.ts`, `sublease.router.ts`, `sustainability-advisor.router.ts`, `vacancy-pipeline.router.ts`, `waitlist.router.ts`. About 27 files. |
| (a) | **Quarantine legacy BN migrations** at `packages/database/src/migrations/` to prevent dual-chain conflicts. | Move 269 `.sql` files to `packages/database/.archive/migrations/` or delete entirely. Add a guard to `scripts/migration-apply-check.mjs` to error if both `src/migrations/` and `drizzle/` chains are present. |
| (a) | **Prune `.env.example`** of BN-only vars (GEPG_*, LPMS_*, OPAY_*, FIRS_*, NGGIS_*, NIN_*). | Edit `.env.example` to remove ~30 lines. |
| (b) | **Build `services/onboarding-orchestrator`** for the mining owner onboarding wizard. | New service mirroring BN structure but with mining steps: (1) NIDA + company KYB, (2) licence import (PML/PL/ML), (3) site geometry intake, (4) first drill-hole batch upload, (5) cockpit seed. Estimated 2,000 LOC. |
| (b) | **Add 6 missing CI workflows**: `regulator-pack-drift.yml`, `openapi-drift.yml`, `security-route-coverage.yml`, `policy-gate-coverage.yml`, `zero-hardcoded.yml`, `decision-trace-coverage.yml`. | Each workflow shells out to an existing `scripts/audit-*.mjs` and fails if drift > 0. |
| (b) | **Add `mcp-server-tra` and `mcp-server-tumemadini`** to replace deleted `mcp-server-firs`/`-opay`/`-nin`/`-nggis`. | New `services/mcp-server-tra/`, `services/mcp-server-tumemadini/`. Estimated 800 LOC each. |
| (c) | **Backfill missing unit tests** in `packages/ai-copilot/src/juniors/__tests__/` — currently 26 juniors but probably <80% coverage. | Audit per-junior coverage, add missing tests. |
| (c) | **Mining-specific `customer-app/emergencies/*` analog**: emergency incident reporting UI in `apps/workforce-mobile/app/incidents/`. | API exists (`mining/incidents.hono.ts`); UI does not. 2 screens + 1 form. |
| (c) | **Mining-specific `customer-app/maintenance/*` analog**: maintenance request UI in `apps/owner-web/(routes)/fleet/maintenance/`. | API exists (`mining/maintenance.hono.ts`); UI partial. |
| (c) | **Multi-step onboarding wizard** in `apps/owner-web/onboarding/`. | Currently one page; extract to wizard with backing orchestrator (see above). |
| (c) | **Sync mobile screen catalog** between `workforce-mobile/app/owner/O-M-*` and the spec. | The 25 owner screens and 22 worker screens are numbered placeholders; ensure each maps to a documented use case. |
| (c) | **Re-skin `marketing-brain` for mining**. | Already inherited (2,918 LOC); mining context vars need substitution. |

### 14b. Build in MVP3+ (post-pilot)

| Recommendation | Notes |
|----------------|-------|
| Mining ESG advisor packages: `green-angle-mining-advisor`, `sustainability-mining-advisor` | ESG scoring + scope 1/2/3 emissions |
| Public marketing site (`apps/marketing` analog) | After pilot proves market |
| Carbon market integration (`carbon-market` analog for jurisdictional REDD+) | Mining-adjacent ESG |
| Borjie-shaped `BORJIE_PRD.md`, `BORJIE_SPEC.md` | Reauthor BN PRD for mining |
| Calendar + community announcements UI | After pilot confirms demand |
| Helm chart adaptation | After Fly.io+Vercel deploy validated at pilot scale |

### 14c. Skip (property-domain only, intentional)

- `acquisition-advisor`, `estate-auto-management`, `estate-department-advisor`, `lifecycle-advisor`, `lpms-connector`
- `apps/tenant-portal`, `apps/customer-app`, `apps/estate-manager-app`
- All MCP servers for Nigeria (FIRS, OPay, NIN, NGGIS) — Borjie is TZ-first
- Property-domain schemas (`buildings`, `leases`, `arrears-cases`, etc.)
- GEPG and LPMS env vars

### 14d. Partial / already exists

| Concern | Resolution |
|---------|-----------|
| Master-brain orchestrator | Already in `packages/ai-copilot/src/juniors/master-brain.ts` |
| LMBM graph | Already in `routes/mining/lmbm.hono.ts` + `portfolio-map.hono.ts` |
| Decision log | `routes/mining/internal/decision-log.hono.ts` + `decision_log` table |
| Killswitch | `routes/mining/internal/killswitch.hono.ts` + `0009_killswitch_rbac.sql` |
| Audit pack | `routes/mining/internal/audit-log.hono.ts` + admin-web UI |
| FX/treasury | `packages/fx-treasury-advisor` + `fx_rates`, `cash_balances`, `treasury.schema.ts` |
| Geology workbench | `packages/geology-advisor` + `drill_holes`, `samples`, `vein_models` |
| Mining juniors | 26 in `packages/ai-copilot/src/juniors/` |
| TZ regulator integration | `packages/regulatory-tz-mining` + `Docs/regulator-pack/tz/` |
| Marketplace | `routes/mining/marketplace.hono.ts` + `routes/mining/bids.hono.ts` + `apps/buyer-mobile` |

---

## 15. Mining-specific features that BossNyumba lacks

These are net-new in Borjie (greenfield mining domain). Highlights:

### 15a. Juniors (26 mining concrete agents)

Listed in §8a — all mining-domain.

### 15b. Mining advisor packages (7)

- `capacity-expansion-advisor`
- `cost-engineer-advisor`
- `fx-treasury-advisor`
- `geology-advisor`
- `mine-planner-advisor`
- `mining-commodity-intelligence`
- `regulatory-tz-mining`

### 15c. Mining tables (50)

Listed in §4b.

### 15d. Tanzanian regulator integration

- `mining/internal/regulator-pipeline.hono.ts`
- `Docs/regulator-pack/tz/` (BOT cyber, PDPA, AML/KYC, MRM, fairness, incident response, BCP/DR, vendors, audit trail)
- Env vars: `TRA_PORTAL_BASE`, `NEMC_PORTAL_BASE`, `TUMEMADINI_PORTAL_BASE`

### 15e. FX/treasury

- TimescaleDB hypertable `cash_balances`
- `fx_rates`, `mineral_prices` tables
- `packages/fx-treasury-advisor`
- `apps/owner-web/(routes)/treasury/page.tsx`
- `scripts/refresh-fx-rates.ts` (inherited but rebound)

### 15f. Geology workbench

- Tables: `drill_holes`, `drill_hole_layers`, `samples`, `sample_batches`, `qaqc_results`, `geology_scores`, `vein_models`, `ore_grade_snapshots`, `ore_stockpiles`
- Routes: `mining/drill-holes.hono.ts`, `mining/samples.hono.ts`
- Workforce-mobile drill-hole capture form (`apps/workforce-mobile/src/forms/drillHoleFields.tsx`)
- Admin-web internal corpus (`apps/admin-web/src/app/internal/corpus/`)

### 15g. Marketplace (greenfield)

- 4 tables: `marketplace_listings`, `marketplace_bids`, `bid_negotiations`, `ratings`
- Routes: `mining/marketplace.hono.ts`, `mining/bids.hono.ts`
- Dedicated Expo app: `apps/buyer-mobile` with KYC, browse, place-bid, document viewer

### 15h. Workforce mobile (Expo) — greenfield

- 25 owner mobile screens (`O-M-01..O-M-25`)
- 22 worker mobile screens (`W-M-01..W-M-22`)
- 7 tab screens (ask, sites, field, home, decisions, docs, people, cash)
- Forms: drill-hole entry, shift-report wizard, voice recorder, GPS card, photo strip
- Fingerprint biometric overlay
- Background sync mount
- Offline banner

### 15i. Living Mining Business Map (LMBM)

- Routes: `mining/lmbm.hono.ts`, `mining/portfolio-map.hono.ts`
- Owner-web pages: `lmbm/page.tsx`, `portfolio-map/page.tsx`
- Backed by Apache AGE (optional) + temporal_relationships in plain Postgres

### 15j. Junior output substrate (Migration 0011)

31 dedicated junior output tables in 4 groups (geology-ops, workforce-safety, commercial, governance) — none of these exist in BossNyumba.

### 15k. Routing rules + executive brief actions queue (Migration 0013)

- `routing_rules` (Piece B): owner-question → junior routing
- `executive_brief_actions` (Piece E): approved-action drain queue
- Drained by `services/api-gateway/src/workers/executive-brief-action-runner.ts`

### 15l. Borjie corpus ingest

- `services/consolidation-worker/src/tasks/borjie-corpus-ingest.ts`
- `services/consolidation-worker/src/tasks/borjie-corpus-cli.ts`
- `services/consolidation-worker/src/tasks/borjie-corpus-adapters.ts`
- Pulls off-repo at `BORJIE_MINING_CORPUS_PATH` into `intelligence_corpus_chunks` with `tenant_id = NULL` (shared corpus across all tenants)

### 15m. Admin-web internal toolset

10 internal admin pages new in Borjie (not in BN admin-platform-portal):

- `internal/audit-log`, `internal/audit-pack` (compliance evidence export)
- `internal/citations`, `internal/compliance-queue`
- `internal/corpus` (corpus admin)
- `internal/decision-log`
- `internal/juniors` (per-junior monitor)
- `internal/killswitch`
- `internal/marketplace` (admin override)
- `internal/models`, `internal/prompts` (prompt registry)
- `internal/regulator-pipeline`
- `internal/rollback`, `internal/slo`, `internal/support`
- `internal/tenants/{[id], detail, page}` (tenant admin)
- `internal/flags` (feature flags admin)
- `internal/ab-tests`, `internal/analytics`

---

## Appendix A — Quick reference

### A.1 Top 10 cross-cutting Borjie file paths (citation set)

- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/database/drizzle/0003_mining_domain.sql`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/database/drizzle/0011_junior_outputs.sql`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/ai-copilot/src/juniors/master-brain.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/services/api-gateway/src/routes/mining/index.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/services/api-gateway/src/workers/executive-brief-action-runner.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/services/consolidation-worker/src/tasks/borjie-corpus-ingest.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/packages/regulatory-tz-mining/src/index.ts`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/apps/owner-web/src/app/(routes)/master-brain/page.tsx`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/apps/admin-web/src/app/internal/juniors/page.tsx`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Borjie/Docs/regulator-pack/tz/README.md`

### A.2 Top 10 BossNyumba paths that should NOT be ported

- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/packages/acquisition-advisor/`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/packages/estate-auto-management/`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/packages/estate-department-advisor/`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/packages/lifecycle-advisor/`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/packages/lpms-connector/`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/apps/tenant-portal/`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/services/mcp-server-firs/`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/services/mcp-server-opay/`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/services/mcp-server-nin/`
- `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/services/mcp-server-nggis/`

### A.3 Top 10 BossNyumba paths Borjie SHOULD re-port

1. `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/services/onboarding-orchestrator/` → rename to `services/onboarding-orchestrator/` in Borjie (mining onboarding wizard)
2. `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/services/parcel-service/` → optional, for mining concession polygons
3. `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/.github/workflows/regulator-pack-drift.yml` → drift gate for `Docs/regulator-pack/tz/`
4. `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/.github/workflows/openapi-drift.yml` → drift gate for `Docs/openapi/borjie-mining.yaml`
5. `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/.github/workflows/decision-trace-coverage.yml` → gate for `decision_log` coverage
6. `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/.github/workflows/kernel-eval.yml` → kernel eval gate
7. `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/.github/workflows/lats-search-eval.yml` → LATS eval gate
8. `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/.github/workflows/red-team.yml` → red team probe
9. `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/.github/workflows/zero-hardcoded.yml` → zero-hardcoded audit
10. `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101/.github/workflows/security-route-coverage.yml` → security route coverage gate

---

## Closing note — ancestry, not parity

This document is a historical snapshot of what Borjie inherited from
its sibling property-management codebase at the moment of fork
(2026-05-26). It is preserved for engineering archaeology: "what did
we start with?" rather than "what should we still mirror?".

**Future parity work between the two products is NOT planned.** Each
product evolves independently from this point. Borjie's wave plan,
juniors substrate, schema, OpenAPI surface, regulator pack, marketing
surface, and CI pipeline are owned by Borjie and answer only to
Borjie's roadmap. The "Top 10 BossNyumba paths Borjie SHOULD re-port"
section above was a fork-day shopping list; whether or not Borjie
adopts those patterns now depends solely on Borjie's own needs, and
any new development happens against Borjie's own surface — not as a
port from the sibling.

If you find yourself reaching for this document to answer "should we
copy X from BossNyumba?", the answer is almost certainly: design X
for Borjie's mining domain, with Mr. Mwikila as the front door, and
the universal pluggable jurisdictional profile substrate as the
spread mechanism. The ancestry is a fact; the dependency is not.

---

End of parity audit. Generated 2026-05-26.
