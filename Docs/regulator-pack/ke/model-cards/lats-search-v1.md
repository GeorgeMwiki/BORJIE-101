# Model Card — LATS Tree-Search Planner v1 (F9) — Kenya

**Model ID:** `lats-search-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** Brain team
**Jurisdiction:** Kenya (KE pack)
**Stakes:** High (and DPA s.35 review-right enabled on every plan that affects a KE tenant materially)
**Status:** Production (gated by feature-flag + tier-policy)

---

## Purpose

LATS is the alternative planner for high-branching, multi-step tasks where the simpler Tree-of-Thoughts planner (P-6) is insufficient. KE deployment-specific: every produced trajectory whose action set affects a tenant materially carries an s.35-challengeable footprint (sovereign-action ledger + tenant-facing Challenge CTA).

## Architecture

LLM-scored tree search:

1. Generate candidate actions per node (LLM call with constrained-output schema)
2. Score child nodes via learned heuristic + online judge (P-9 KE corpus)
3. Expand best-scoring branch with UCT-like budget
4. Backpropagate scores to update priors
5. Return best trajectory; full tree logged

Trajectory + scores written to sovereign-action ledger.

## Training data

None for the search algorithm. Scoring relies on the online judge rubric (versioned, KE-aware). LLM expansion uses frozen foundation models.

## Inputs

- Task description + context (tenant, property, lease, prior plans)
- Budget (max nodes, depth, wall-clock seconds)
- Tier from `tier-policy-resolver-v1`
- KE legal-context excerpt where action involves tenancy law

## Outputs

- Best trajectory
- Full search tree
- Confidence score
- `escalate-to-human` if below confidence threshold
- s.35-challengeable plan ID (KE-specific)

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Plan-success rate vs ToT (KE) | +15% | TODO |
| Wall-clock latency p95 | < 30 s | TODO |
| Cost per successful plan | < USD 0.50 | TODO |
| KE s.35 sustain-rate post-LATS plan | tracked | TODO |
| Escalate-to-human rate | tracked | TODO |

## Limitations

- Expensive: orders of magnitude more LLM calls than single-pass; reserved for high-stakes + high-branch
- Score signal lags real-world outcome by hours-days; reflexion loop closes this
- Score-hacking risk via task-description manipulation; mitigated by tier-policy + prompt-shield
- KE legal-context coverage bounded by training-set vintage; legal counsel review escalation

## Implementation

| Component | Path:line |
|---|---|
| Core LATS | `packages/central-intelligence/src/kernel/orchestrator/lats-search.ts` (719 lines) |
| Types | `packages/central-intelligence/src/kernel/orchestrator/lats-types.ts` |
| ToT baseline (P-6) | `packages/central-intelligence/src/kernel/orchestrator/search-planner.ts` |
| Trace persistence | `packages/database/src/schemas/sovereign-action-ledger.schema.ts` |
| Reflexion loop | `packages/central-intelligence/src/kernel/reflexion/` |
| KE s.35 challenge route | `services/api-gateway/src/routes/gdpr.router.ts` |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Langfuse — KE LATS traces | `https://langfuse.borjie.com/project/borjie-prod/traces?tag=lats&region=KE` |
| Grafana — KE LATS latency + cost | `https://grafana.borjie.com/d/lats-perf/lats-latency-cost?var-region=KE` |
| Mission-Eval — KE plan-success vs ToT | `https://mission-eval.borjie.com/project/borjie/dashboards/lats-vs-tot?var-region=KE` |
| Grafana — KE s.35 sustain-rate (LATS-sourced) | `https://grafana.borjie.com/d/s35-challenges/s35-sustain-rate?var-source=lats` |

## Privacy & Safety

- PII scrubbed via `packages/ai-copilot/src/security/pii-scrubber.ts` (511 lines)
- Tool calls gated by `tier-policy-resolver-v1`
- Kill-switch fail-closed
- KE s.35 right exposed via Challenge CTA + 7-day human-review SLA

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (F9 wave) — KE | Brain Team Lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-ke-lats-v1.0` |
| Brain Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brain/model-card-ke-lats-v1.0` |
| DPO (ODPC-registered) | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/model-card-ke-lats-v1.0` |
| CRO | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/model-card-ke-lats-v1.0` |

## Review cadence

- **Quarterly** — Brain team reviews KE plan-success rate
- **Monthly** — DPO reviews KE s.35 challenges originating from LATS plans
- **Out-of-cycle** — kernel routing change, scoring rubric update, cost-runaway, or any high-stakes failure attributable to LATS
