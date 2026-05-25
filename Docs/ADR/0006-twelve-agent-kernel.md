# ADR 0006 — Twelve-agent embodied kernel

- **Status:** Accepted
- **Date:** 2026-02 (kernel v3 land)

## Context

Borjie's central-intelligence kernel needs to compose many
cognitive concerns — perception, persona, theory-of-mind, planning,
debate, audit, governance — without collapsing into a single
prompt or a tangle of ad-hoc helpers. Monolithic agent designs
(one prompt, many tools) became brittle past ~30 capabilities:
prompt regressions in one capability silently broke unrelated ones.
The literature (EP-1, WR-1 research) converged on multi-agent
kernels with explicit role separation.

Options considered:

| Option | Verdict |
|---|---|
| Single prompt + tool catalogue | Broke at scale; loss of role boundary |
| LangGraph state-machine | Locked into one framework; vendor-thin |
| crewAI | Strong DX but lacks the safety primitives we need |
| AutoGen | Conversation-only; doesn't fit our typed pipeline |
| Custom twelve-agent kernel | Selected |

## Decision

Use a custom kernel with twelve specialised agents wired through
explicit typed pipelines: sensors, persona, policy gate,
theory-of-mind, planner (debate / LATS), executor, four-eye gate,
auditor, memory consolidator, drift watchdog, cost guard, and reply
formatter. Each agent owns a narrow contract; the kernel is the
composition root. See `packages/central-intelligence/src/kernel/`.

## Consequences

**Positive:**

- Each agent is independently testable, swappable, and ablation-friendly.
- Capability regressions are localised — one agent's prompt
  change cannot silently break another's.
- Safety primitives (policy gate, four-eye, drift watchdog) are
  first-class agents, not bolt-ons.
- Per-agent cost and trace land cleanly in observability.

**Negative:**

- Higher fixed token cost vs single-prompt baseline; offset by
  Haiku-first cascading (P-8).
- More code surface; the composition root is the source of complexity.
- Onboarding new contributors requires reading more code.

## Alternatives considered

A nine-agent variant collapsed memory + audit + drift into one
agent; the resulting prompt was too crowded and the eval scores
fell behind. Twelve agents with single-purpose contracts is the
sweet spot.

## References

- `packages/central-intelligence/src/kernel/` — kernel composition
- `Docs/ARCHITECTURE_BRAIN.md` — full kernel pipeline
- `Docs/CODEMAPS/central-intelligence.md`
- EP-1 / WR-1 research findings
