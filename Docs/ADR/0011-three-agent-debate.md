# ADR 0011 — Three-agent debate at stakes ≥ high

- **Status:** Accepted
- **Date:** 2026-04 (P-10 + BL2)

## Context

The kernel runs at multiple autonomy tiers (low → high). For
high-stakes actions — terminating a lease, approving a disbursement
above threshold, escalating a regulatory case — single-LLM
reasoning is statistically too noisy to defend. EP-3 red-teaming
demonstrated that a single Sonnet call would, in adversarial
prompts, recommend irreversible actions ~3% of the time. The
literature on multi-agent debate (Du et al. 2023; LITFIN BL2
mirror) showed that adversarial deliberation between agents drops
that rate significantly.

Options considered:

| Option | Verdict |
|---|---|
| Single agent + temperature 0 | Noise still present in adversarial cases |
| Two-agent critic | Better but echo-chamber risk |
| Three-agent debate (prop / opp / judge) | Selected |
| Five-agent panel | Cost / latency too high for production |

## Decision

When the kernel detects `stakes >= high`, planner runs the
three-voice debate: **proposer**, **opposer**, **judge**. Each
agent gets the same context; proposer drafts an action, opposer
identifies risks + counter-arguments, judge picks (or returns
"insufficient" → human handoff). The debate transcript is stored
in the decision-trace.

## Consequences

**Positive:**

- Adversarial-action rate dropped on the internal red-team corpus.
- Decision traces show explicit risk reasoning, audit-friendly.
- Insufficient-confidence outcomes route to four-eye, not silently
  to action.
- Mirrors LITFIN BL2 pattern for cross-platform consistency.

**Negative:**

- 3x token cost on high-stakes paths. Mitigated by Haiku-first
  cascading (P-8) at lower tiers.
- Latency p95 increases by ~3s on debate paths.
- More prompts to maintain (three voices each).

## Alternatives considered

We tested a self-critique loop (one agent, multiple turns) — it
worked but lacked the role-asymmetry that produces the
strongest counter-arguments.

## References

- `packages/central-intelligence/src/agents/debate/` — debate impl
- P-10 (task 144) + BL2 (task 157)
- `Docs/CODEMAPS/central-intelligence.md`
- `evals/red-team/`
