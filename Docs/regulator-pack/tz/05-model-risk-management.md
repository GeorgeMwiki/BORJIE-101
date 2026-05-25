# 05 — Model Risk Management (Tanzania)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** Model Risk Manager (reports to CRO)
**Jurisdiction:** Tanzania (mapping reused for KE pack)
**Frameworks:**
- US Federal Reserve / OCC Supervisory Letter SR 11-7, "Guidance on Model Risk Management" (2011, reaffirmed in OCC 2011-12)
- ISO/IEC 23894:2023 — AI risk management
- NIST AI Risk Management Framework 1.0 (AI RMF)
- EU AI Act (Reg. 2024/1689) — used as forward-looking reference even where not yet binding
- BoT Risk Management Guidelines, 2010 — model risk treated as sub-category of operational risk

> **SR 11-7 source:** `https://www.federalreserve.gov/supervisionreg/srletters/sr1107.htm`. SR 11-7 defines a "model" as "a quantitative method, system, or approach that applies statistical, economic, financial, or mathematical theories, techniques, and assumptions" to produce decision-relevant outputs. Borjie treats this definition expansively to include rule-based decision systems and LLM-driven assistants that influence customer outcomes.

---

## 1. SR 11-7 — section-by-section mapping

SR 11-7 sets out three core areas: (A) model development, implementation and use; (B) model validation; (C) governance, policies and controls.

### A. Model development, implementation and use

| SR 11-7 expectation | Borjie control |
|---|---|
| Sound design with documented purpose, conceptual basis, choice of methodology | Every registered model has a model card (`Docs/regulator-pack/tz/model-cards/*.md`) covering identification, intended use, training data, methodology |
| Robust data including data integrity, lineage, transformations | Training-dataset hash recorded in model card; features documented with source and direction |
| Testing prior to use — back-testing, sensitivity analysis, out-of-sample testing | Pre-deploy gate: held-out evaluation set + adversarial corpus (doc 09 model-card on online-judge) |
| Pilot / shadow before production | New scoring / pricing models run as **challenger** alongside production **champion** for ≥ 30 days |
| Implementation: code review, version control, change management | All model code reviewed via PR; signed commits; model registry stores immutable version pointers |
| Use: communicate strengths/limitations to users, training | Model card §Limitations shown to property managers via tooltip in the workbench; mandatory annual training |

### B. Model validation

| SR 11-7 expectation | Borjie control |
|---|---|
| Independence of validation from development | Model Risk Manager reports to CRO; not part of model-development team |
| Conceptual soundness | Validation report covers methodology, feature selection rationale, alternatives considered |
| Ongoing monitoring — performance, drift, stability | Live monitoring job emits `model_metric_event` daily; eval-on-traffic online judge (P-9, model card in this folder) flags regressions |
| Outcomes analysis | Quarterly back-test where ground truth is available |
| Effective challenge | Quarterly Model Risk Committee reviews exception logs, override patterns, challenger performance |

### C. Governance, policies, and controls

| SR 11-7 expectation | Borjie control |
|---|---|
| Board / senior-management approval of policy | This document approved by CRO; ratified by board annually |
| Roles and responsibilities | RACI: Developer (R), Validator (R), Model Risk Manager (A), CRO (A on production), Property-mgr (C), DPO (C on PII features) |
| Model inventory | `model_registry` table; one row per registered model with version, status, approver chain |
| Lifecycle (request → develop → validate → approve → deploy → monitor → retire) | Documented as state machine |
| Documentation | Model cards generated per version; archived 10 years |

## 2. Model inventory (current snapshot)

| Model ID | Family | Purpose | Status | Stake | Owner | Source-of-truth (path:line) |
|---|---|---|---|---|---|---|
| `voice-agent-mrmwikila-v1` | LLM / agent | Tenant-facing voice assistant; routes intents to tools | Production | Medium-high | Voice team | `services/api-gateway/src/composition/voice-agent-wiring.ts` + persona DNA `packages/ai-copilot/src/voice-persona-dna/` |
| `monthly-close-orchestrator-v1` | LLM / agent | Owner monthly-close run orchestration | Production | Medium | Finance team | `services/api-gateway/src/composition/monthly-close-wiring.ts` + `services/api-gateway/src/services/monthly-close/` + ledger `packages/database/src/schemas/monthly-close-runs.schema.ts` |
| `market-rate-surveillance-v1` | rules + LLM | Detect off-market rent (under / over) per neighbourhood | Production | Medium | Intelligence team | `services/api-gateway/src/composition/market-surveillance-wiring.ts` + `services/api-gateway/src/adapters/market-rate/` + snapshots `packages/database/src/schemas/market-rate-snapshots.schema.ts` |
| `predictive-interventions-v1` | ML | Predict tenant payment-arrears risk; surface opportunities | Production | **High** (touches credit-like outputs) | Intelligence team | `services/api-gateway/src/composition/predictive-interventions-wiring.ts` + `packages/ai-copilot/src/proactive-insights/` + arrears infra `services/api-gateway/src/composition/arrears-infrastructure.ts` |
| `adaptive-layout-engine-v1` | rules + LLM | Rearrange UI based on tenant behaviour (UI-1) | Production | Low | UX team | `packages/dynamic-sections/` + `packages/genui/` + persistence `packages/database/src/schemas/section-layouts.schema.ts` |
| `three-agent-debate-v1` | LLM ensemble | Multi-agent debate at stakes ≥ high (P-10) | Production | High (gates high-stakes decisions) | Brain team | Debate path in `packages/central-intelligence/src/` (see `__tests__/debate.test.ts` for exemplar); voice-bridge handoff in `__tests__/voice-bridge.test.ts` |
| `online-judge-v1` | LLM | Eval-on-traffic + adversarial corpus (P-9) | Production | Medium (meta — gates other models) | Eval team | `packages/central-intelligence/src/__tests__/self-grading-judge.test.ts` + sleep-pass-3 guideline updates `packages/central-intelligence/src/kernel/reflexion/sleep/pass-3-update-guidelines.ts` |
| `pii-scrubber-v1` | rules + classifier | Strip PII from LLM inputs | Production | High (privacy guarantee) | Security team | `packages/ai-copilot/src/security/pii-scrubber.ts` (511 lines) |
| `tree-of-thoughts-planner-v1` | LLM | Search-based planning for multi-step tasks (P-6) | Production | Medium-high | Brain team | `packages/central-intelligence/src/kernel/orchestrator/search-planner.ts` |
| `mmr-memory-retriever-v1` | embeddings + rerank | Smart memory retrieval (P-7) | Production | Medium | Brain team | `packages/ai-copilot/src/memory/` + DP-memory at `packages/ai-copilot/src/dp-memory/` |
| `tier-policy-resolver-v1` (F2) | rules | Constitution-v2 tier-policy gate for high-risk tools | Production | High | Brain / Safety team | `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) + `policy-gate/assertions.ts` + `policy-gate/high-risk-literal-only.ts` |
| `lats-search-v1` (F9) | LLM / tree search | LATS alternative planner for high-branching tasks | Production | High | Brain team | `packages/central-intelligence/src/kernel/orchestrator/lats-search.ts` (719 lines) + `lats-types.ts` |
| `reflexion-sleep-v1` (F11) | LLM / rules | Reflexion buffer + 4-pass nightly consolidation | Production | High (memory governance) | Brain team | `packages/central-intelligence/src/kernel/reflexion/` (recorder, writer, retriever, loader) + sleep at `kernel/reflexion/sleep/nightly-sleep.ts` (230 lines) + pass 1-4 files; storage `packages/database/src/schemas/reflexion-buffer.schema.ts` |

Model cards for each live model live in `Docs/regulator-pack/tz/model-cards/<model-id>-v<version>.md`. Six cards are scaffolded in this pack (UI-1, P-10, P-9, F2, F9, F11); the remainder are TODO.

### Model-monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Langfuse — kernel trace explorer | `https://langfuse.borjie.com/project/borjie-prod/traces` |
| Langfuse — per-model cost + latency | `https://langfuse.borjie.com/project/borjie-prod/dashboards/cost-latency-per-model` |
| Mission-Eval — quality scores | `https://mission-eval.borjie.com/project/borjie/dashboards/quality-rollup` |
| Mission-Eval — adversarial corpus pass-rate | `https://mission-eval.borjie.com/project/borjie/dashboards/adversarial-pass-rate` |
| Grafana — model drift | `https://grafana.borjie.com/d/model-drift/model-drift-overview` |
| Grafana — fairness slice violations | `https://grafana.borjie.com/d/fairness/fairness-violations-by-model` |
| Grafana — kill-switch state | `https://grafana.borjie.com/d/kill-switches/kill-switch-state-changes` |

## 3. Model lifecycle

```
   ┌────────┐     ┌─────────┐     ┌──────────┐     ┌──────────┐     ┌─────────┐     ┌──────────┐     ┌─────────┐
   │ Intake │ ──→ │ Develop │ ──→ │ Validate │ ──→ │ Approve  │ ──→ │ Deploy  │ ──→ │ Monitor  │ ──→ │ Retire  │
   └────────┘     └─────────┘     └──────────┘     └──────────┘     └─────────┘     └──────────┘     └─────────┘
       │              │                │                 │                │                │                 │
       └──────────────┴────────────────┴─────────────────┴────────────────┴────────────────┴─────────────────┘
                                              audit log (doc 10)
```

| Stage | Gate | Sign-off |
|---|---|---|
| Intake | Business case + DPIA pre-screen | Product owner |
| Develop | Code review + unit tests | Eng lead |
| Validate | Held-out eval + adversarial + fairness slice (doc 06) | Model Risk Manager |
| Approve | Pre-deploy review + DPIA (if PII) | CRO + DPO (if PII) |
| Deploy | Canary / shadow → 100% | Eng on-call |
| Monitor | Drift + fairness + cost dashboards | Model Risk Manager |
| Retire | Decommission + archive | Model Risk Manager |

## 4. AI-specific risks

| Risk | Mitigation |
|---|---|
| Hallucination (voice agent inventing facts) | Grounding to property + lease database; refuse-if-uncertain prompt; eval-on-traffic online judge |
| Prompt injection (tenant attempts to escalate) | Layered system prompt + intent verifier + tool ACLs (kernel safety layer) |
| Drift (model performance decays as user behaviour shifts) | Daily drift detection job; rollback to last-known-good champion on > 5% regression |
| Bias (e.g., dispatch slower in low-income neighbourhoods) | Quarterly fairness audit (doc 06); slice-level monitoring |
| Cost runaway (LLM bill spike) | Per-tenant budget caps; Haiku-first cascade (P-8); circuit breaker on cost-per-session |
| Insecure tool invocation (agent triggers refund / eviction) | Kill-switches per route + per agent (`services/api-gateway/src/composition/cross-portal-killswitch-fanout.ts`); four-eyes on irreversible actions via `approval-grant-repository.ts` + `approval-request-repository.ts`; agent policy engine deny-by-default (`packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts`); sovereign ledger `packages/database/src/schemas/sovereign-action-ledger.schema.ts` records consequential agent actions |

## 5. Cross-references

- Adversarial corpus + online-judge: see `model-cards/online-judge-v1.md`
- Multi-agent debate at high stakes: see `model-cards/three-agent-debate-v1.md`
- Adaptive layout engine: see `model-cards/adaptive-layout-engine-v1.md`
- Tier-policy resolver (F2 — constitution v2): see `model-cards/tier-policy-resolver-v1.md`
- LATS tree-search planner (F9): see `model-cards/lats-search-v1.md`
- Reflexion + sleep consolidation (F11): see `model-cards/reflexion-sleep-v1.md`

> TODO: insert most recent Model Risk Committee minutes + champion / challenger snapshot.

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/regulator-pack-tz-05-v1.0` |
| CRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/regulator-pack-tz-05-v1.0` |
| DPO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-tz-05-v1.0` |
| Brain Team Lead | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brain/regulator-pack-tz-05-v1.0` |
| Board Risk Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brc/regulator-pack-tz-05-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | Model Risk Manager |
| 1.1.0 | 2026-05-22 | 3 new model cards (tier-policy, LATS, reflexion-sleep) + path:line refs + Langfuse / Mission-Eval dashboards (Wave-12) | Model Risk Manager |

## Appendix C — Review Cadence

- **Quarterly** — Model Risk Committee reviews inventory, exception logs, challenger performance, fairness slices, kill-switch toggles
- **Out-of-cycle** — triggered by any new model promotion, regulator AI guidance update, or P0/P1 model-failure incident
- **Annual** — Board ratifies policy; external audit reviews methodology + sample of model cards
