# Model Card — Three-Agent Debate v1 (P-10)

**Model ID:** `three-agent-debate-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** Brain team
**Jurisdiction:** Tanzania (TZ pack)
**Stakes:** High (gates high-stakes decisions: eviction comms, large refunds, sensitive owner-portal exports, model promotions)
**Status:** Production

---

## Purpose

The Three-Agent Debate component invokes three independent LLM "agents" (with different system prompts and provider routes) to debate a candidate action at stakes ≥ high. Each agent argues for an outcome; a fourth "judge" agent reads all positions and produces a final decision plus reasoning trace. The component is the primary defence against single-model hallucination, prompt-injection success, and over-confident wrong answers at material-decision boundaries.

## Architecture

- **Agent A (Pro):** argues why the action should proceed
- **Agent B (Con):** argues why the action should be blocked or modified
- **Agent C (Neutral / process):** evaluates procedural compliance (policy, RLS, kill-switch state, audit-trail integrity)
- **Judge:** synthesises positions, produces `proceed | block | escalate-to-human` plus written reasoning

Implementation in `packages/ai-copilot/src/debate/`. Triggered automatically by the kernel when `stakes >= 'high'` (kernel tool metadata).

## Training data

**No training data.** All four LLMs are frozen foundation models (mix of Claude Sonnet and OpenAI GPT-4 to ensure provider diversity). No fine-tuning. System prompts versioned in `prompts/debate/*.md`.

## Inputs

- Candidate action description + structured parameters
- Relevant context (tenant ID, property ID, prior decisions if any)
- Policy excerpt relevant to the action class
- Kill-switch and feature-flag state
- Prior reasoning trace (if this is a retry)

## Outputs

- `decision`: `proceed | block | escalate-to-human`
- `confidence`: 0..1
- `reasoning_trace`: all three positions + judge synthesis (stored in audit log)
- `dissent_flag`: true if any agent strongly disagreed with judge

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Latency (full debate) | < 6 s p95 | TODO |
| Cost per debate | < USD 0.10 | TODO |
| Catch-rate on adversarial corpus | > 95% | TODO (cross-ref `online-judge-v1`) |
| False-block rate (legitimate action wrongly blocked) | < 2% | TODO |
| Dissent rate (informative — high dissent flags for human review) | tracked | TODO |

## Limitations

- Cost: each debate is 4 LLM calls, materially more expensive than single-agent path; reserved for stakes ≥ high only
- Latency: 4-6× single-agent latency; not used in sub-second UX paths
- Provider correlation: if both Claude and OpenAI share a vulnerability, debate may not catch it (mitigated by Agent C being rule-based-leaning)
- Judge model can still hallucinate; final decisions at stakes ≥ high require human review on `escalate-to-human` output

## Monitoring

- Every debate logged to audit chain with full reasoning trace
- Dissent-rate dashboard reviewed weekly by Brain team + Model Risk Manager
- Daily kill-switch verification: ensure component still gated by kernel policy
- Adversarial corpus (online-judge-v1) replayed weekly

## Privacy

- PII is scrubbed before LLM calls by `pii-scrubber-v1`
- Reasoning trace retained in audit log (encrypted at rest)
- DPIA includes risk of PII leak to LLM providers (mitigated by SCCs + DPAs + scrubber)

## Safety

- All four LLMs run with constrained-output (JSON schema) to prevent prompt-injection escape
- Judge cannot invoke tools — output is decision only; downstream effector invokes tools after policy check
- Kill-switch in `services/api-gateway/src/composition/debate-wiring.ts`

## Implementation

| Component | Source-of-truth (path:line) |
|---|---|
| Debate orchestration | `packages/central-intelligence/src/` (see `__tests__/debate.test.ts` for exemplar) |
| Provider routing (Claude + OpenAI mix) | `packages/ai-copilot/src/providers/` |
| Voice-bridge handoff | `packages/central-intelligence/src/__tests__/voice-bridge.test.ts` |
| Kill-switch wiring | `services/api-gateway/src/composition/brain-kernel-wiring.ts` + `voice-agent-wiring.ts` |
| Decision logging | `packages/database/src/schemas/sovereign-action-ledger.schema.ts` |
| Tier-gate enforcement (stakes ≥ high) | `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Langfuse — debate traces | `https://langfuse.borjie.com/project/borjie-prod/traces?tag=debate` |
| Mission-Eval — debate catch-rate vs adversarial corpus | `https://mission-eval.borjie.com/project/borjie/dashboards/debate-catch-rate` |
| Grafana — debate latency and cost | `https://grafana.borjie.com/d/debate-perf/debate-latency-cost` |
| Grafana — dissent-rate | `https://grafana.borjie.com/d/debate-dissent/debate-dissent-rate` |

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (P-10 wave) | Brain Team Lead |
| 1.0.1 | 2026-05-22 | Implementation refs + dashboards (Wave-12) | Brain Team Lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-debate-v1.0` |
| Brain Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brain/model-card-debate-v1.0` |
| CRO | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/model-card-debate-v1.0` |

## Review cadence

- **Weekly** — Brain team reviews dissent-rate dashboard
- **Quarterly** — Model Risk Committee reviews catch-rate against refreshed adversarial corpus
- **Out-of-cycle** — any change to system prompts in `packages/central-intelligence/src/` debate path, provider mix change, or P0/P1 incident involving a high-stakes action

> TODO: insert weekly catch-rate report; insert sample dissent trace.
