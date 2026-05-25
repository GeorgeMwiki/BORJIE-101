# Model Card — Online Judge v1 (P-9)

**Model ID:** `online-judge-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** Eval team
**Jurisdiction:** Tanzania (TZ pack)
**Stakes:** Medium (meta — gates other models)
**Status:** Production

---

## Purpose

The Online Judge is the eval-on-traffic component that grades production AI outputs in real-time against an adversarial corpus and rubric set. It is the closed-loop self-improvement signal: outputs scored as low-quality or unsafe trigger automatic mitigations (rollback, kill-switch, retraining queue). It is also our **early-warning system for prompt-injection success and model drift**.

The judge complements the offline eval harness; together they implement an "eval-as-moat" closed loop (R-MOAT-6).

## Architecture

- Samples production traffic (configurable rate; default 5% of voice-agent + 10% of debate outputs)
- For each sampled output, runs a rubric-graded LLM judge (Claude Sonnet) against criteria: groundedness, helpfulness, safety, fairness, format-compliance
- Maintains a rolling **adversarial corpus** of red-team prompts (initial seed + new examples added on every red-team exercise + new examples mined from production failures)
- Replays the adversarial corpus against the current production stack hourly

Implementation in `packages/eval-online-judge/`.

## Training data

**No training data for the judge itself.** It is a frozen foundation model with a versioned rubric. The adversarial corpus is curated: initial seed of 250 examples covering known property-management prompt-injection patterns, biased-decision triggers, voice-agent jailbreak attempts, and tenant-rights-misinformation traps. Curated by red-team + DPO + CCO.

> Corpus path: `tests/adversarial/property-management-v1/`.

## Inputs

- Sampled production AI output (prompt + response + structured metadata)
- Rubric version
- Optional: ground truth (when available from delayed signal — e.g., did the tenant later complain?)

## Outputs

- Score per dimension (groundedness, helpfulness, safety, fairness, format) in 0..5
- Aggregate quality score
- Flag: `pass | warn | fail`
- Adversarial-corpus pass rate (rolling)

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Judge-human agreement (Spearman ρ on labeled sample) | > 0.7 | TODO |
| Adversarial-corpus pass rate | > 95% | TODO |
| Latency (per sample) | < 2 s p95 | TODO |
| False-fail rate (judge fails a correct production output) | < 5% | TODO |

## Limitations

- The judge is itself an LLM and can be wrong; daily human-spot-check of failed samples is mandatory
- Adversarial corpus quality bounds how much the judge can detect; corpus must be refreshed quarterly
- Sampling rate is a trade-off: too low misses incidents; too high adds cost. Currently tuned per-component.
- Cannot judge outputs that require ground truth not yet available (e.g., "was this prediction correct?" requires waiting)

## Monitoring

- Quality dashboards per production component (voice-agent, debate, predictive-interventions, etc.)
- Auto-rollback trigger if quality score drops > 5% over 24 h
- Weekly red-team review of failed samples
- Quarterly adversarial-corpus refresh + offline eval re-run

## Privacy

- Sampled traffic is replayed in a separate evaluation tenant; PII scrubbed before judge sees it
- Judge runs through same SCCs / DPAs as production LLMs (doc 09)
- Adversarial corpus stored without real-tenant identifiers (synthetic identities only)

## Safety

- Judge cannot invoke tools (read-only role)
- Cannot modify production output; only emits scores and flags
- Auto-actions (rollback / kill-switch) require co-trigger from drift-detection job (no single-point automation)

## Implementation

| Component | Source-of-truth (path:line) |
|---|---|
| Judge sampling + scoring path | `packages/central-intelligence/src/__tests__/self-grading-judge.test.ts` (exemplar) + judge invocation via `packages/ai-copilot/src/providers/` |
| Adversarial corpus replay | nightly cron; sleep-pass-3 updates rules at `packages/central-intelligence/src/kernel/reflexion/sleep/pass-3-update-guidelines.ts` |
| Auto-rollback orchestration | Mission-Eval webhook → model promotion API surface |
| Reflexion loop integration | `packages/central-intelligence/src/kernel/reflexion/` (recorder, writer, retriever, loader) |
| Cost-circuit-breaker | `packages/ai-copilot/src/security/cost-circuit-breaker.ts` |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Mission-Eval — quality-score per production component | `https://mission-eval.borjie.com/project/borjie/dashboards/quality-rollup` |
| Mission-Eval — adversarial corpus pass-rate trend | `https://mission-eval.borjie.com/project/borjie/dashboards/adversarial-pass-rate` |
| Langfuse — judge traces | `https://langfuse.borjie.com/project/borjie-prod/traces?tag=judge` |
| Grafana — judge-human agreement | `https://grafana.borjie.com/d/judge-agreement/judge-human-agreement` |

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (P-9 wave) | Eval Team Lead |
| 1.0.1 | 2026-05-22 | Implementation refs + dashboards (Wave-12) | Eval Team Lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-judge-v1.0` |
| Eval Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/eval/model-card-judge-v1.0` |
| DPO | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/model-card-judge-v1.0` |

## Review cadence

- **Weekly** — Eval team reviews failed-sample logs + judge-human agreement
- **Quarterly** — adversarial corpus refresh + offline eval re-run
- **Out-of-cycle** — rubric change or judge model upgrade

> TODO: insert weekly adversarial-corpus pass-rate chart; insert sample failure-mode report.
