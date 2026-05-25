# Model Card — LATS Tree-Search Planner v1 (F9)

**Model ID:** `lats-search-v1`
**Version:** 1.0
**Date:** 2026-05-22
**Owner:** Brain team
**Jurisdiction:** Tanzania (TZ pack)
**Stakes:** High (used on high-branching, multi-step planning where Tree-of-Thoughts is insufficient)
**Status:** Production (gated behind feature flag + tier-policy)

---

## Purpose

LATS — Language-Agent Tree Search — is an alternative planner for tasks where the action space is large and outcomes uncertain (e.g., complex maintenance triage with vendor-allocation trade-offs, multi-month financial reconciliation). It complements the simpler Tree-of-Thoughts planner (P-6) and the multi-agent debate component (P-10). LATS is selected by the kernel when (a) stakes are high, (b) the action graph has > 4 distinct branches, and (c) prior plans have failed the online judge.

## Architecture

Tree search with LLM-scored node expansion. The planner:

1. Generates candidate actions at each node via an LLM call (with constrained-output schema)
2. Scores each child node using a learned heuristic + the online judge (P-9)
3. Expands the best-scoring branch using a UCT-like budget
4. Backpropagates result scores to update branch priors
5. Returns the best completed trajectory, with the full search trace logged

Trajectory + scores written to the sovereign action ledger.

## Training data

**None for the search algorithm itself.** Scoring relies on the online judge's rubric, which is versioned (see `online-judge-v1`). LLM expansion uses frozen foundation models.

## Inputs

- Task description + relevant context (tenant, property, lease, prior plans)
- Budget (max nodes, max depth, max wall-clock seconds)
- Tier from `tier-policy-resolver-v1`

## Outputs

- Best trajectory (sequence of actions)
- Full search tree (for audit + reflexion)
- Confidence score
- `escalate-to-human` if best trajectory below confidence threshold

## Performance

| Metric | Target | Last measured |
|---|---|---|
| Plan-success rate vs. ToT baseline on adversarial corpus | +15% | TODO |
| Wall-clock latency p95 | < 30 s | TODO |
| Cost per successful plan | < USD 0.50 | TODO |
| Escalate-to-human rate (correctly identified hard cases) | tracked | TODO |

## Limitations

- Expensive: orders of magnitude more LLM calls than single-pass planning; reserved for high-stakes + high-branch cases
- Score signal lags real-world outcome by hours-days; reflexion loop closes this
- Vulnerable to score-hacking by an attacker controlling task description; mitigated by tier-policy + prompt-shield (`packages/ai-copilot/src/security/prompt-shield.ts`)

## Implementation

| Component | Path:line |
|---|---|
| Core LATS search | `packages/central-intelligence/src/kernel/orchestrator/lats-search.ts` (719 lines) |
| Types | `packages/central-intelligence/src/kernel/orchestrator/lats-types.ts` |
| Tree-of-Thoughts baseline (P-6) | `packages/central-intelligence/src/kernel/orchestrator/search-planner.ts` |
| Decision trace persistence | sovereign-action-ledger + `packages/database/src/schemas/sovereign-action-ledger.schema.ts` |
| Reflexion feedback loop | `packages/central-intelligence/src/kernel/reflexion/` |

## Monitoring dashboards

| Dashboard | URL placeholder |
|---|---|
| Langfuse — LATS trace explorer | `https://langfuse.borjie.com/project/borjie-prod/traces?tag=lats` |
| Grafana — LATS latency + cost per plan | `https://grafana.borjie.com/d/lats-perf/lats-latency-cost` |
| Mission-Eval — plan-success rate vs ToT | `https://mission-eval.borjie.com/project/borjie/dashboards/lats-vs-tot` |

## Privacy & Safety

- PII scrubbed via `packages/ai-copilot/src/security/pii-scrubber.ts` (511 lines) before any LLM expansion call
- All emitted tool calls gated by `tier-policy-resolver-v1`
- Kill-switch fail-closed; toggle in `services/api-gateway/src/composition/brain-kernel-wiring.ts`

## Version history

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial release (F9 wave) | Brain Team Lead |

## Sign-off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Model Risk Manager | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/mrm/model-card-lats-v1.0` |
| Brain Team Lead | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brain/model-card-lats-v1.0` |
| CRO | _TODO_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/model-card-lats-v1.0` |

## Review cadence

- **Quarterly** — Brain team reviews plan-success rate vs baseline
- **Out-of-cycle** — kernel routing change, scoring rubric update, cost-runaway incident, or any high-stakes failure attributable to LATS
