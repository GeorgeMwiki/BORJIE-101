# Model Card — Online Judge v1 (P-9) — Kenya

**Model ID:** `online-judge-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** Eval team
**Jurisdiction:** Kenya (KE pack)
**Stakes:** Medium (meta — gates other models)
**Status:** Production

---

## Purpose

The Online Judge is the eval-on-traffic component grading production AI outputs in real-time against an adversarial corpus and rubric set. Low-quality / unsafe outputs trigger automatic mitigations (rollback, kill-switch, retraining queue). Early-warning system for prompt-injection success, model drift, and **dialect-coverage gaps that disproportionately affect KE Sheng / coastal Kiswahili users**.

The judge complements the offline eval harness. Together they implement an "eval-as-moat" closed loop (R-MOAT-6).

## Architecture

- Samples production traffic (configurable rate; default 5% of voice-agent + 10% of debate outputs)
- For each sample, runs rubric-graded LLM judge (Claude Sonnet) against criteria: groundedness, helpfulness, safety, **KE fairness** (slice across language, region, income), format-compliance
- Maintains rolling **KE adversarial corpus**: 250 seed examples covering KE property-management prompt-injection patterns, biased-decision triggers, voice-agent jailbreak, tenancy-law-misinformation traps (Sheng / coastal Kiswahili examples included)
- Replays corpus hourly

Implementation: `packages/eval-online-judge/`. KE corpus at `tests/adversarial/property-management-ke-v1/`.

## Training data

**No training data for the judge itself.** Frozen foundation model + versioned rubric. KE adversarial corpus curated by red-team + DPO + CCO + local KE counsel.

## Inputs

- Sampled production AI output (prompt + response + metadata)
- Rubric version
- Optional: ground truth (delayed signal where available)

## Outputs

- Score per dimension (groundedness, helpfulness, safety, fairness, format) 0..5
- Aggregate quality score
- Flag: `pass | warn | fail`
- Adversarial-corpus pass rate (rolling)

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Judge-human agreement (Spearman ρ) | > 0.7 | TODO |
| Adversarial-corpus pass rate (KE) | > 95% | TODO |
| Latency (per sample) | < 2 s p95 | TODO |
| False-fail rate | < 5% | TODO |
| Dialect-coverage failure detection rate | > 90% | TODO |

## Limitations

- The judge is itself an LLM and can be wrong; daily human-spot-check of failed samples is mandatory
- KE corpus quality bounds detection; refreshed quarterly with input from KE-region red-team
- Sampling-rate trade-off (cost vs. coverage)
- Some outputs require ground truth not yet available (delayed-signal eval)

## Monitoring

- Quality dashboards per production component
- Auto-rollback if quality score drops > 5% over 24 h
- Weekly red-team review of failed samples (KE-region red-team monthly contribution)
- Quarterly KE adversarial-corpus refresh

## Privacy

- Sampled traffic replayed in separate evaluation tenant; PII scrubbed before judge sees it
- Judge runs through same EU SCCs / DPAs as production LLMs (doc 09)
- Adversarial corpus stored with synthetic identities only (no real KE tenants)
- DPA 2019 s.48 cross-border transfer compliant

## Safety

- Judge cannot invoke tools (read-only)
- Cannot modify production output; emits scores + flags only
- Auto-actions (rollback / kill-switch) require co-trigger from drift-detection job

## Implementation

| Component | Source-of-truth (path:line) |
|---|---|
| Judge sampling + scoring | `packages/central-intelligence/src/__tests__/self-grading-judge.test.ts` (exemplar) + provider routing `packages/ai-copilot/src/providers/` |
| Adversarial-corpus replay | nightly cron; sleep-pass-3 guideline updates `packages/central-intelligence/src/kernel/reflexion/sleep/pass-3-update-guidelines.ts` |
| Auto-rollback orchestration | Mission-Eval webhook → model promotion API |
| Cost-circuit-breaker | `packages/ai-copilot/src/security/cost-circuit-breaker.ts` |
| KE adversarial corpus | `tests/adversarial/property-management-ke-v1/` |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Mission-Eval — KE quality-score per component | `https://mission-eval.borjie.com/project/borjie/dashboards/quality-rollup-ke` |
| Mission-Eval — KE adversarial pass-rate | `https://mission-eval.borjie.com/project/borjie/dashboards/adversarial-pass-rate-ke` |
| Langfuse — KE judge traces | `https://langfuse.borjie.com/project/borjie-prod/traces?tag=judge&region=KE` |
| Grafana — KE dialect-coverage detection | `https://grafana.borjie.com/d/dialect/dialect-coverage?var-region=KE` |

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (P-9 wave) | Eval Team Lead |
| 1.0.1 | 2026-05-22 | KE implementation refs + dashboards (Wave-12) | Eval Team Lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-ke-judge-v1.0` |
| Eval Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/eval/model-card-ke-judge-v1.0` |
| DPO (ODPC-registered) | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/model-card-ke-judge-v1.0` |

## Review cadence

- **Weekly** — Eval team reviews failed-sample logs
- **Monthly** — KE-region red-team contributes new adversarial examples
- **Quarterly** — KE adversarial corpus refresh + offline eval re-run
- **Out-of-cycle** — rubric change, judge model upgrade, or KE dialect-coverage gap incident

> TODO: insert weekly KE adversarial-corpus pass-rate chart; insert KE-specific failure-mode report.
