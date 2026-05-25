# 05 — Model Risk Management (Kenya)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** Model Risk Manager (reports to CRO)
**Jurisdiction:** Kenya
**Frameworks:**
- US Federal Reserve / OCC Supervisory Letter SR 11-7, "Guidance on Model Risk Management" (2011)
- ISO/IEC 23894:2023 — AI risk management
- NIST AI Risk Management Framework 1.0 (AI RMF)
- EU AI Act (Reg. 2024/1689) — forward-looking reference
- **Kenya DPA 2019 s.35** — right not to be subject to automated decision-making (a binding statutory constraint, distinguishing KE from TZ in this area)
- CBK Cybersecurity Guideline 2017 — model risk treated as operational + cyber sub-category

> SR 11-7 source: `https://www.federalreserve.gov/supervisionreg/srletters/sr1107.htm`. Borjie treats this definition expansively to include rule-based decision systems and LLM-driven assistants that influence customer outcomes.

---

## 1. SR 11-7 — section-by-section mapping

Same structure as TZ pack (see `tz/05-model-risk-management.md` §1). Kenya-specific overlay:

- DPA s.35 right means **every AI-influenced material decision affecting a tenant must support human review on request within 7 days**. This is encoded in the kernel policy at stakes ≥ medium (more conservative than TZ pack's stakes ≥ high).
- ODPC may, on enforcement, require disclosure of model logic — model cards in this pack are pre-prepared for that disclosure.

## 2. Model inventory (current snapshot)

Same inventory as TZ pack (single codebase). Difference: deployment to KE tenants is gated by:

- Region selection at tenant onboarding (KE region = stricter automated-decision policy)
- KES currency rendering throughout
- KE-resident vendor preference where available

| Model ID | Family | Stakes — KE | Notes |
|---|---|---|---|
| `voice-agent-mrmwikila-v1` | LLM | Medium-high | Voice "Mr. Mwikila" — supports Kiswahili + English (KE) + Sheng (lightweight) |
| `monthly-close-orchestrator-v1` | LLM | Medium | KE accounting outputs in iTax format |
| `market-rate-surveillance-v1` | rules + LLM | Medium | Rent reasonableness — informational only |
| `predictive-interventions-v1` | ML | **High** (s.35 review-right invoked at this stakes level) | All KE outputs include "Challenge" CTA |
| `adaptive-layout-engine-v1` | rules + LLM | Low | |
| `three-agent-debate-v1` | LLM ensemble | High | |
| `online-judge-v1` | LLM | Medium | |
| `pii-scrubber-v1` | rules + classifier | High | |
| `tree-of-thoughts-planner-v1` | LLM | Medium-high | |
| `mmr-memory-retriever-v1` | embeddings + rerank | Medium | |

Model cards in `Docs/regulator-pack/ke/model-cards/`.

## 3. Model lifecycle

Same as TZ pack. Kenya-specific gates:

- **Approve** stage: where the model processes KE-resident tenant data **and** influences a material decision, ODPC-aware DPIA must be signed by DPO before deploy.
- **Monitor** stage: KE-specific fairness slice (Kiswahili / English / Sheng users; Nairobi / Mombasa / rural; income-source informal / formal).

## 4. AI-specific risks

Same risk inventory as TZ pack. Kenya-specific differences:

| Risk | KE-specific overlay |
|---|---|
| Automated-decision-only (DPA s.35) | Every material decision exposed via "Challenge" button + human review SLA 7 days |
| Bias against informal-economy tenants | High prevalence in KE residential market; quarterly slice audit |
| Voice agent regional dialect coverage | Sheng + coastal Kiswahili tested in adversarial corpus |
| Cross-border LLM inference | Same SCC mechanics, but ODPC may require explicit s.48 notification on enforcement |

## 5. Cross-references

Model cards in this KE pack:

- UI-1 — `model-cards/adaptive-layout-engine-v1.md`
- P-10 — `model-cards/three-agent-debate-v1.md`
- P-9 — `model-cards/online-judge-v1.md`
- F2 — `model-cards/tier-policy-resolver-v1.md`
- F9 — `model-cards/lats-search-v1.md`
- F11 — `model-cards/reflexion-sleep-v1.md`

## 6. Source-of-truth (KE region overlay)

KE-specific overlays of the TZ-05 §2 inventory:

- Region gate via `packages/database/src/schemas/identity.schema.ts` (`tenants.region = 'KE'`)
- Stakes upgrade (medium → high for `predictive-interventions-v1`) enforced by `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts`
- s.35 "Challenge" CTA wiring through `services/api-gateway/src/routes/gdpr.router.ts`
- KE-specific fairness slice metrics emitted to `packages/database/src/schemas/audit-events.schema.ts` with `region = 'KE'`

## 7. Monitoring dashboards (KE)

| Dashboard | URL placeholder |
|---|---|
| Langfuse — kernel traces filtered to KE | `https://langfuse.borjie.com/project/borjie-prod/traces?region=KE` |
| Mission-Eval — quality scores per KE model | `https://mission-eval.borjie.com/project/borjie/dashboards/quality-rollup-ke` |
| Grafana — s.35 challenge throughput | `https://grafana.borjie.com/d/s35-challenges/s35-challenge-resolution` |
| Grafana — KE fairness violations | `https://grafana.borjie.com/d/fairness/fairness-violations-by-model?var-region=KE` |

> TODO: insert most recent KE-region Model Risk Committee minutes; collect KE-specific eval results.

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/regulator-pack-ke-05-v1.0` |
| CRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/regulator-pack-ke-05-v1.0` |
| DPO (ODPC-registered) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-ke-05-v1.0` |
| Brain Team Lead | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brain/regulator-pack-ke-05-v1.0` |
| Board Risk Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brc/regulator-pack-ke-05-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | Model Risk Manager |
| 1.1.0 | 2026-05-22 | 3 new model cards (F2 / F9 / F11) + KE overlays + dashboards (Wave-12) | Model Risk Manager |

## Appendix C — Review Cadence

- **Quarterly** — KE-region Model Risk Committee review
- **Out-of-cycle** — new ODPC AI guidance, s.35 enforcement notice, P0/P1 model failure
- **Annual** — board ratification
