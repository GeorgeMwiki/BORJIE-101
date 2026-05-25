# Autonomy Governance Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/autonomy-governance/`
**Public entry:** `packages/autonomy-governance/src/index.ts`
**Tier scope:** cognitive core (Brain autonomy guardrails)

## Purpose

The autonomy-and-handoff governance layer for the Brain. Caps the
agent's action authority by tier (`caps/`), routes high-stakes
actions to human approval (`handoff/`), and tracks SLO budgets so
the Brain reduces autonomy when its eval scores drift
(`slo/`). Implements the EP-3 safety findings: deny-by-default for
unbounded actions, mandatory four-eye on tier-3 money paths,
graceful degradation when policies trip.

## Entry points

- `src/index.ts` — barrel.
- `src/caps/` — `autonomyCaps`, per-tier action allowlists.
- `src/handoff/` — handoff coordinator + state machine.
- `src/slo/` — SLO ledger + drift gates.
- `src/types.ts` — `AutonomyTier`, `HandoffReason`, `SloBudget`.

## Internal structure

- `caps/` — capability scoping per tier.
- `handoff/` — four-eye approval workflow.
- `slo/` — drift detection on online-judge scores.
- `__tests__/` — adversarial scenarios.

## Dependencies

- Upstream: `@borjie/domain-models`, `@borjie/observability`.
- Downstream: central-intelligence (kernel gates), api-gateway (handoff routes).

## Common workflows

- **Check authority** → `caps.allow(action, tier)`.
- **Request handoff** →
  `handoff.requestApproval({ action, reason, requester })`.
- **Resolve handoff** → human approves → state transitions.
- **Trip SLO** → drift detector flips tier down.

## Anti-patterns to avoid

- Never let the Brain bypass the caps check.
- Never auto-approve a handoff — humans only.
- Never disable SLO gates in production.
- Never persist secrets in handoff context.

## Related codemaps

- [central-intelligence.md](./central-intelligence.md) — gated by this
- [observability.md](./observability.md) — emits drift events
- [api-gateway.md](./api-gateway.md) — handoff routes
