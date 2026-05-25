# Docs Index

Master index of every document in `Docs/`, organized by category.

## Requirements + product spec

| File | Summary |
|------|---------|
| [BORJIE_PRD.md](./BORJIE_PRD.md) | Product requirements document — user stories, acceptance criteria, success metrics |
| [BORJIE_SPEC.md](./BORJIE_SPEC.md) | Functional spec — features per portal, workflows, edge cases |
| [CUSTOMER_APP.md](./CUSTOMER_APP.md) | Customer-app product spec |
| [ESTATE_MANAGER_APP.md](./ESTATE_MANAGER_APP.md) | Estate-manager-app product spec |
| [requirements/VOICE_MEMO_2026-04-18_questionnaire_analysis.md](./requirements/VOICE_MEMO_2026-04-18_questionnaire_analysis.md) | Analysis of stakeholder questionnaire responses (voice-memo source) |
| [Borjie Native AI Operating System_ Questionaire.docx](./Borjie%20Native%20AI%20Operating%20System_%20Questionaire.docx) | Raw questionnaire doc (Borjie) |
| [ESTATE- Native AI Operating System_ Questionaire.docx](./ESTATE-%20Native%20AI%20Operating%20System_%20Questionaire.docx) | Raw questionnaire doc (Estate-manager) |

## Architecture

| File | Summary |
|------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture — multi-tenant, services, data model |
| [ARCHITECTURE_CENTRAL_COMMAND.md](./ARCHITECTURE_CENTRAL_COMMAND.md) | Canonical Central Command architecture — phase status, kernel pipeline, sleep consolidation |
| [ARCHITECTURE_BRAIN.md](./ARCHITECTURE_BRAIN.md) | AI "Brain" architecture — personas, providers, deterministic gates |
| [CPG_ARCHITECTURE.md](./CPG_ARCHITECTURE.md) | Customer-property-graph architecture |
| [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) | Core domain entities and relationships |
| [DATA_FLOWS.md](./DATA_FLOWS.md) | Event-driven and synchronous request flows |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | UI design tokens, components, patterns |
| [ENTERPRISE_HARDENING.md](./ENTERPRISE_HARDENING.md) | Rate limiting, CSRF, audit logging, secret rotation |
| [ADR/README.md](./ADR/README.md) | Architecture Decision Records (ADRs) — chronological registry |

## API + contracts

| File | Summary |
|------|---------|
| [API.md](./API.md) | Human-readable API reference |
| [API_CONTRACTS.md](./API_CONTRACTS.md) | Request/response conventions and versioning |
| [API_SPEC.yaml](./API_SPEC.yaml) | Legacy top-level OpenAPI spec |
| [api/openapi.yaml](./api/openapi.yaml) | Current canonical OpenAPI spec |
| [api/cases.yaml](./api/cases.yaml) | Case management endpoints |
| [api/customers.yaml](./api/customers.yaml) | Customer endpoints |
| [api/documents.yaml](./api/documents.yaml) | Document endpoints |
| [api/leases.yaml](./api/leases.yaml) | Lease endpoints |
| [api/maintenance.yaml](./api/maintenance.yaml) | Maintenance endpoints |
| [api/payments.yaml](./api/payments.yaml) | Payments endpoints (M-Pesa, GePG) |
| [api/properties.yaml](./api/properties.yaml) | Property endpoints |
| [api/tenants.yaml](./api/tenants.yaml) | Tenant endpoints |

## Analysis + gaps

| File | Summary |
|------|---------|
| [analysis/DELTA_AND_ROADMAP.md](./analysis/DELTA_AND_ROADMAP.md) | Current delivery gaps, wave-5 status snapshot, Production Readiness Matrix, security blocker close-out |
| [analysis/GAP_docs_vs_code.md](./analysis/GAP_docs_vs_code.md) | Documentation-vs-code coverage gap |
| [analysis/GAP_voice_vs_docs.md](./analysis/GAP_voice_vs_docs.md) | Voice-memo requirements vs existing docs |
| [analysis/CONFLICT_RESOLUTIONS.md](./analysis/CONFLICT_RESOLUTIONS.md) | Decisions resolving spec conflicts |
| [analysis/MISSING_FEATURES_DESIGN.md](./analysis/MISSING_FEATURES_DESIGN.md) | Design for features identified as missing |
| [analysis/RESEARCH_ANSWERS.md](./analysis/RESEARCH_ANSWERS.md) | Answers to open research questions |
| [analysis/SCAFFOLDED_COMPLETION.md](./analysis/SCAFFOLDED_COMPLETION.md) | What's scaffolded vs fully wired |
| [analysis/SECURITY_REVIEW_WAVES_1-3.md](./analysis/SECURITY_REVIEW_WAVES_1-3.md) | Security review findings (C-1, C-2, H-1..H-6, M-*, L-*); all 5 production blockers now closed |
| [RESEARCH_REPORT_CPG.md](./RESEARCH_REPORT_CPG.md) | Research findings on customer-property-graph |
| [RISK_REGISTER.md](./RISK_REGISTER.md) | Known risks and mitigations |
| [TODO_BACKLOG.md](./TODO_BACKLOG.md) | Consolidated `TODO`/`FIXME` inventory for issue filing |

## Deployment + operations

| File | Summary |
|------|---------|
| [ENV.md](./ENV.md) | Environment variables reference |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Local + staging + production deploy guide; env-var reference (wave-5 additions); composition root degraded mode |
| [RUNBOOK.md](./RUNBOOK.md) | On-call runbook; standard operational procedures (migrations, seeds, health checks, API key rotation, 503 triage); incident playbooks |
| [RUNBOOKS/README.md](./RUNBOOKS/README.md) | Operational runbooks index (incident response, killswitch, encryption rotation, RTBF, cron debug) |
| [SUPABASE_LIVE_TEST.md](./SUPABASE_LIVE_TEST.md) | First-time production live-test against Supabase (REQUIRED reading before first deploy) |
| [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) | Pre-deployment checklist and known integration notes |
| [OPERATIONAL_SLA.md](./OPERATIONAL_SLA.md) | SLAs, escalation paths |
| [KPIS_AND_SLOS.md](./KPIS_AND_SLOS.md) | Key KPIs and service-level objectives |

## Compliance

| File | Summary |
|------|---------|
| [COMPLIANCE/SOC2_CONTROLS.md](./COMPLIANCE/SOC2_CONTROLS.md) | SOC 2 Type II Common Criteria (CC1-CC9) control mapping |
| [COMPLIANCE/TZ_PDPA_2022.md](./COMPLIANCE/TZ_PDPA_2022.md) | Tanzania Personal Data Protection Act 2022 (Articles 5-30) mapping |
| [COMPLIANCE/GDPR_ARTICLE_30.md](./COMPLIANCE/GDPR_ARTICLE_30.md) | GDPR Article 30 Record of Processing — controller + processor view |
| [COMPLIANCE/DPA_TEMPLATE.md](./COMPLIANCE/DPA_TEMPLATE.md) | Data Processing Agreement template for tenants |

## AI-native agents (composition + persistence)

The four AI-native agents currently wired into the api-gateway
composition root. Each is exposed as an optional `ServiceRegistry`
slot, persists state through a Drizzle service in
`packages/database/src/services/`, and degrades to a 503 envelope when
`DATABASE_URL` is unset.

| Agent | Registry slot | Wiring file | Persistence | Phase doc |
|-------|---------------|-------------|-------------|-----------|
| Monthly Close Orchestrator | `monthlyClose` | `services/api-gateway/src/composition/monthly-close-wiring.ts` | `monthly_close_runs` + `monthly_close_run_steps` (migration `0099`) | [PHASES_FINDINGS/phA2-monthly-close.md](./PHASES_FINDINGS/phA2-monthly-close.md) |
| Voice Agent (Mr. Mwikila) | `voiceAgent` | `services/api-gateway/src/composition/voice-agent-wiring.ts` | `voice_turns` (migration `0110`) | [PHASES_FINDINGS/phL-ai-deeper.md](./PHASES_FINDINGS/phL-ai-deeper.md) |
| Market-Rate Surveillance | `marketSurveillance` | `services/api-gateway/src/composition/market-surveillance-wiring.ts` | `market_rate_snapshots` (migration `0103`) | [PHASES_FINDINGS/phG-ai-native.md](./PHASES_FINDINGS/phG-ai-native.md) |
| Predictive Interventions | `predictiveInterventions` | `services/api-gateway/src/composition/predictive-interventions-wiring.ts` | `tenant_predictions` + `predictive_intervention_opportunities` (migration `0106`) | [PHASES_FINDINGS/phG-ai-native.md](./PHASES_FINDINGS/phG-ai-native.md) |

See [ARCHITECTURE.md](./ARCHITECTURE.md) §"AI-native agent wirings" for
the wired-vs-stubbed matrix and `.planning/RUNBOOK.md` §6.3 for
operational guidance (env-var gates for real adapters, run-state
inspection queries, manual monthly-close trigger).
