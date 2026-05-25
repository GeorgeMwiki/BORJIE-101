# Model Card — Three-Agent Debate v1 (P-10) — Kenya

**Model ID:** `three-agent-debate-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** Brain team
**Jurisdiction:** Kenya (KE pack)
**Stakes:** High (gates high-stakes decisions: eviction comms under Landlord and Tenant Act / Rent Restriction Act, large refunds, sensitive owner-portal exports, model promotions)
**Status:** Production

---

## Purpose

The Three-Agent Debate component invokes three independent LLM agents (different system prompts + different provider routes) to debate any candidate action at stakes ≥ high. Each agent argues for an outcome; a fourth "judge" agent reads all positions and produces a final decision plus reasoning trace. The component is the primary defence against single-model hallucination, prompt-injection success, and over-confident wrong answers at material-decision boundaries.

**Kenya-specific overlay:** all output decisions on tenant-affecting actions feed into the DPA 2019 s.35 right-to-human-review pipeline (every "block" / "proceed" decision must be challengeable within 7 days).

## Architecture

- **Agent A (Pro):** argues for the action
- **Agent B (Con):** argues against
- **Agent C (Neutral / process):** procedural compliance — policy, RLS, kill-switches, audit-trail, **Landlord and Tenant Act + Rent Restriction Act notice-form requirements**
- **Judge:** synthesises positions, outputs `proceed | block | escalate-to-human`

Implementation: `packages/ai-copilot/src/debate/`. Triggered by kernel when `stakes >= 'high'`.

## Training data

**No training data.** Frozen foundation models (mix of Claude Sonnet + OpenAI GPT-4). No fine-tuning. System prompts versioned in `prompts/debate/*.md` (KE variants for tenancy-law context).

## Inputs

- Candidate action + structured parameters
- Tenant + property + lease context
- Relevant policy excerpt
- KE-specific tenancy-law excerpt where action involves notice / eviction / rent restriction
- Kill-switch and feature-flag state
- Prior reasoning trace (if retry)

## Outputs

- `decision`: `proceed | block | escalate-to-human`
- `confidence`: 0..1
- `reasoning_trace` (audit-logged)
- `dissent_flag`: true if any agent strongly disagreed with judge
- `s35_challenge_link`: pre-prepared challenge URL for tenant (KE-specific)

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Latency (full debate) | < 6 s p95 | TODO |
| Cost per debate | < USD 0.10 | TODO |
| Catch-rate on adversarial corpus | > 95% | TODO |
| False-block rate | < 2% | TODO |
| KE s.35 challenge sustain-rate (tenant won the review) | tracked; target < 10% (means original decisions sound) | TODO |

## Limitations

- 4× cost of single-agent path; reserved for stakes ≥ high
- 4-6× latency
- Provider correlation: both Claude + OpenAI sharing a vulnerability could pass debate
- Judge can still hallucinate; `escalate-to-human` output requires human review
- KE tenancy-law nuance (e.g., shop vs. residential tenancy Acts) may exceed model knowledge; legal counsel review escalation

## Monitoring

- Every debate logged to audit chain
- Dissent-rate dashboard reviewed weekly
- KE s.35 challenge log reviewed monthly by DPO
- Kill-switch verification daily
- Adversarial corpus (online-judge-v1) replayed weekly

## Privacy

- PII scrubbed by `pii-scrubber-v1`
- Reasoning trace retained in audit log (encrypted at rest)
- DPA s.48 compliance via EU SCCs for LLM calls (doc 09)
- Tenant has DPA s.35 right of challenge on every output affecting them

## Safety

- All four LLMs run with constrained-output (JSON schema)
- Judge cannot invoke tools — output is decision only; downstream effector invokes tools after policy check
- Kill-switch in `services/api-gateway/src/composition/debate-wiring.ts`

## Implementation

| Component | Source-of-truth (path:line) |
|---|---|
| Debate orchestration | `packages/central-intelligence/src/` (see `__tests__/debate.test.ts`) |
| KE-specific s.35 challenge linkage | `services/api-gateway/src/routes/gdpr.router.ts` |
| Kill-switch | `services/api-gateway/src/composition/brain-kernel-wiring.ts` + `voice-agent-wiring.ts` |
| Decision logging | `packages/database/src/schemas/sovereign-action-ledger.schema.ts` |
| Tier-gate (stakes ≥ high) | `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Langfuse — KE debate traces | `https://langfuse.borjie.com/project/borjie-prod/traces?tag=debate&region=KE` |
| Mission-Eval — KE debate catch-rate | `https://mission-eval.borjie.com/project/borjie/dashboards/debate-catch-rate?var-region=KE` |
| Grafana — s.35 sustain-rate post-debate | `https://grafana.borjie.com/d/s35-challenges/s35-sustain-rate?var-source=debate` |

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (P-10 wave) | Brain Team Lead |
| 1.0.1 | 2026-05-22 | KE implementation refs + dashboards (Wave-12) | Brain Team Lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-ke-debate-v1.0` |
| Brain Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brain/model-card-ke-debate-v1.0` |
| DPO (ODPC-registered) | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/model-card-ke-debate-v1.0` |
| KE Legal Counsel | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/legalke/model-card-ke-debate-v1.0` |

## Review cadence

- **Weekly** — Brain team reviews dissent-rate
- **Monthly** — DPO reviews s.35 challenge log
- **Quarterly** — Model Risk Committee reviews catch-rate against refreshed KE adversarial corpus
- **Out-of-cycle** — prompt change, provider mix change, P0/P1 incident involving high-stakes action

> TODO: insert weekly catch-rate report; insert sample dissent trace; insert s.35 challenge log summary.
